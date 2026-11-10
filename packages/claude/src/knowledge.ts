import { promises as fs } from 'node:fs';
import path from 'node:path';
import { AgentError, mcpKey, type ContextDefinition, type KnowledgeExtra, type KnowledgeKind, type KnowledgeRef, type KnowledgeVia, type SkillDefinition } from '@orquestador/core';
import type { ResolvedMcp } from './mcp';

/** Tope de caracteres de lo obligatorio que se incluye entero en el prompt de un intento [R36.7]. */
export const INLINE_BUDGET = 30_000;

/**
 * Cómo se trata cada elemento [R36.5–R36.8][R36.12]:
 * - `inline`: obligatorio, va entero en el prompt (no hace falta comprobar nada);
 * - `verify`: obligatorio que no se puede o no cabe incluir; se exige y se comprueba que se usó;
 * - `offer`: opcional; se ofrece y se registra si se usa, pero nunca se exige.
 */
export type KnowledgeMode = 'inline' | 'verify' | 'offer';

export interface KnowledgeItem {
  kind: KnowledgeKind;
  id: string;
  name: string;
  required: boolean;
  mode: KnowledgeMode;
  /** Contenido incluido en el prompt (solo `inline`). */
  content?: string;
  /** Dónde está: ruta (skill, archivo), URL o prefijo de herramientas (MCP). */
  where: string;
  /** Qué llamadas cuentan como usarlo [R36.10]. */
  detect: (tool: string, input: unknown) => KnowledgeVia | undefined;
}

export interface KnowledgePlan {
  items: KnowledgeItem[];
}

export const skillFolder = (id: string) => `.orquestador/skills/${id}`;

/** Ruta de `SKILL.md`, siempre absoluta: se lee desde cualquier carpeta de trabajo [R36.9][R92.1]. */
export function skillLocation(id: string, projectRoot: string, cwd?: string): string {
  void cwd;
  return path.join(path.resolve(projectRoot), '.orquestador', 'skills', id, 'SKILL.md');
}

const norm = (p: string) => p.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const FILE_TOOLS = new Set(['Read', 'Grep', 'Glob']);
const fileArgs = (input: unknown): string[] => {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  return [str(o.file_path), str(o.path), str(o.pattern)].filter((x): x is string => x !== undefined).map(norm);
};
const url = (u: string) => u.trim().replace(/#.*$/, '').replace(/\/+$/, '').toLowerCase();

const detectSkill = (id: string) => (tool: string, input: unknown): KnowledgeVia | undefined =>
  FILE_TOOLS.has(tool) && fileArgs(input).some((p) => p.includes(`${skillFolder(id).toLowerCase()}/`)) ? 'read' : undefined;
const detectFile = (value: string) => (tool: string, input: unknown): KnowledgeVia | undefined => {
  const v = norm(value);
  return FILE_TOOLS.has(tool) && fileArgs(input).some((p) => p === v || p.endsWith(`/${v}`)) ? 'read' : undefined;
};
const detectUrl = (value: string) => (tool: string, input: unknown): KnowledgeVia | undefined => {
  if (tool !== 'WebFetch') return undefined;
  const u = str((input as Record<string, unknown> | null)?.url);
  return u !== undefined && url(u) === url(value) ? 'tool' : undefined;
};
const detectMcp = (key: string) => (tool: string): KnowledgeVia | undefined => (tool.startsWith(`mcp__${key}__`) ? 'tool' : undefined);

export interface PlanArgs {
  known: KnowledgeExtra;
  contexts: ContextDefinition[];
  skills: SkillDefinition[];
  mcp: ResolvedMcp[];
  projectRoot: string;
  /** Directorio actual del agente (carpeta de trabajo o raíz del proyecto). */
  cwd: string;
}

const isTextFile = (s: string) => !s.includes('\u0000');

/** Lee un archivo de contexto dentro de `cwd`; `undefined` si no está, se sale de la carpeta o no es texto [R36.6]. */
async function readInside(cwd: string, rel: string): Promise<string | undefined> {
  const abs = path.resolve(cwd, rel);
  const within = path.relative(path.resolve(cwd), abs);
  if (within.startsWith('..') || path.isAbsolute(within)) return undefined;
  try {
    const text = await fs.readFile(abs, 'utf8');
    return isTextFile(text) ? text : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Decide cómo se entrega cada elemento de conocimiento [R36.5–R36.8]. Lanza un error no reintentable si algo
 * obligatorio ya no existe en el proyecto o es un MCP apagado: no se puede cumplir y reintentar no lo arregla.
 */
export async function planKnowledge(a: PlanArgs): Promise<KnowledgePlan> {
  const req = a.known.required ?? {};
  const isReq = (k: 'skillIds' | 'contextIds' | 'mcpIds', id: string) => (req[k] ?? []).includes(id);
  const gone: string[] = [];
  for (const [list, found, label] of [
    ['skillIds', a.skills.map((s) => s.id), 'skill'],
    ['contextIds', a.contexts.map((c) => c.id), 'contexto'],
    ['mcpIds', a.mcp.map((m) => m.def.id), 'MCP'],
  ] as const) {
    for (const id of req[list] ?? []) if (!found.includes(id)) gone.push(`${label} «${id}»`);
  }
  if (gone.length > 0) throw new AgentError(`Es obligatorio pero ya no existe en el proyecto: ${gone.join(', ')}. Quítalo del paso o créalo de nuevo.`, false);
  const off = a.mcp.filter((m) => !m.def.enabled && isReq('mcpIds', m.def.id));
  if (off.length > 0) throw new AgentError(`El MCP ${off.map((m) => `«${m.def.name}»`).join(', ')} es obligatorio pero está apagado. Actívalo en Conocimiento o quítalo del paso.`, false);

  const items: KnowledgeItem[] = [];
  let left = INLINE_BUDGET;
  // Los contextos de texto siempre van en el prompt; si son obligatorios gastan del tope.
  for (const c of a.contexts.filter((c) => c.kind === 'text')) {
    const required = isReq('contextIds', c.id);
    if (required) left -= c.value.length;
    items.push({ kind: 'context', id: c.id, name: c.name, required, mode: required ? 'inline' : 'offer', content: c.value, where: c.name, detect: () => undefined });
  }
  for (const s of a.skills) {
    const where = skillLocation(s.id, a.projectRoot, a.cwd);
    if (!isReq('skillIds', s.id)) {
      items.push({ kind: 'skill', id: s.id, name: s.name, required: false, mode: 'offer', where, detect: detectSkill(s.id) });
      continue;
    }
    const fits = s.body.length <= left;
    if (fits) left -= s.body.length;
    items.push({ kind: 'skill', id: s.id, name: s.name, required: true, mode: fits ? 'inline' : 'verify', ...(fits ? { content: s.body } : {}), where, detect: detectSkill(s.id) });
  }
  for (const c of a.contexts.filter((c) => c.kind !== 'text')) {
    const required = isReq('contextIds', c.id);
    if (c.kind === 'url') {
      items.push({ kind: 'context', id: c.id, name: c.name, required, mode: required ? 'verify' : 'offer', where: c.value, detect: detectUrl(c.value) });
      continue;
    }
    // Respecto a la carpeta del proyecto, con la ruta entera [R92.3].
    const text = required ? await readInside(a.projectRoot, c.value) : undefined;
    const fits = text !== undefined && text.length <= left;
    if (fits) left -= text.length;
    const where = path.resolve(a.projectRoot, c.value);
    items.push({ kind: 'context', id: c.id, name: c.name, required, mode: !required ? 'offer' : fits ? 'inline' : 'verify', ...(fits ? { content: text } : {}), where, detect: detectFile(c.value) });
  }
  for (const m of a.mcp) {
    const required = isReq('mcpIds', m.def.id);
    items.push({ kind: 'mcp', id: m.def.id, name: m.def.name, required, mode: required ? 'verify' : 'offer', where: `mcp__${mcpKey(m.def)}__*`, detect: detectMcp(mcpKey(m.def)) });
  }
  return { items };
}

/** Lleva la cuenta de lo usado durante un intento y dice qué obligatorio falta [R36.10][R36.11]. */
export class KnowledgeTracker {
  private readonly used = new Set<string>();
  constructor(private readonly items: readonly KnowledgeItem[]) {}
  private key = (i: KnowledgeRef) => `${i.kind}:${i.id}`;

  /** Lo que se incluyó en el prompt cuenta como usado desde el principio [R36.10]. */
  inlined(): { item: KnowledgeItem; via: KnowledgeVia }[] {
    return this.items.filter((i) => i.required && i.mode === 'inline').map((item) => (this.used.add(this.key(item)), { item, via: 'inline' as const }));
  }

  /** Usos nuevos que provoca una llamada a una herramienta; cada elemento se anuncia una sola vez. */
  observe(tool: string, input: unknown): { item: KnowledgeItem; via: KnowledgeVia }[] {
    const out: { item: KnowledgeItem; via: KnowledgeVia }[] = [];
    for (const item of this.items) {
      if (this.used.has(this.key(item))) continue;
      const via = item.detect(tool, input);
      if (via) {
        this.used.add(this.key(item));
        out.push({ item, via });
      }
    }
    return out;
  }

  /** Obligatorios «verificados» que no se han usado [R36.11]. */
  unmet(): KnowledgeItem[] {
    return this.items.filter((i) => i.required && i.mode === 'verify' && !this.used.has(this.key(i)));
  }
}

const KIND_LABEL: Record<KnowledgeKind, string> = { skill: 'skill', context: 'contexto', mcp: 'MCP' };
export const describeKnowledge = (items: readonly Pick<KnowledgeItem, 'kind' | 'name'>[]) => items.map((i) => `«${i.name}» (${KIND_LABEL[i.kind]})`).join(', ');
