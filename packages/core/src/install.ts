import { DEFAULT_MODEL, LIMITS, MODELS, slugify, validateAgent, type AgentDefinition } from './agents';
import { SKILL_LIMITS, parseFrontmatter, validateSkill, type SkillDefinition } from './skills';
import { containsSecrets } from './redact';
import { MCP_SCHEMA_VERSION, SECRET_NAME, type McpServerDefinition } from './mcp';

/** Archivo del paquete a instalar; `path` usa `/`, es relativo y no sube de nivel. */
export interface SourceFile {
  path: string;
  data: Uint8Array;
}
export interface SourceTree {
  files: SourceFile[];
}

export const IMPORT_LIMITS = { files: 500, total: 20 * 1024 * 1024, file: 2 * 1024 * 1024 } as const;

export type WarningCode = 'script' | 'tools' | 'secrets' | 'model' | 'missing-skill' | 'trimmed' | 'conflict';
export interface ImportWarning {
  code: WarningCode;
  message: string;
}

/** Elemento del informe de revisión [R25.4]. */
export interface ImportItem {
  key: string;
  kind: 'agent' | 'skill';
  name: string;
  /** Id con el que se instalaría; si había conflicto ya es uno libre. */
  id: string;
  description: string;
  /** Id original que chocaba con uno existente. */
  conflictWith?: string;
  /** Motivo por el que no se puede instalar. */
  blocked?: string;
  warnings: ImportWarning[];
  /** Archivos de una skill (sin `SKILL.md`). */
  files: { path: string; size: number }[];
  /** Agentes: claves de las skills del paquete que cita y que se le asignarán [R32.17]. */
  skills?: string[];
}
export interface ImportMcp {
  name: string;
  command?: string;
  /** Argumentos, dirección y nombres de variables o cabeceras (nunca sus valores) [R30.6]. */
  args?: string[];
  url?: string;
  secretNames?: string[];
}
export interface ImportReport {
  items: ImportItem[];
  mcp: ImportMcp[];
  ignored: number;
}

/** Lo que se instalará; se queda en el proceso principal. */
export interface ImportPlan {
  report: ImportReport;
  agents: Map<string, { agent: AgentDefinition; skillNames: string[] }>;
  skills: Map<string, { skill: SkillDefinition; names: string[]; files: SourceFile[] }>;
}
export interface ImportResult {
  agents: string[];
  skills: string[];
  failed: { key: string; message: string }[];
  notes: string[];
}

const SCRIPT_EXT = new Set(['sh', 'bash', 'zsh', 'ps1', 'psm1', 'bat', 'cmd', 'exe', 'dll', 'com', 'msi', 'js', 'mjs', 'cjs', 'ts', 'py', 'rb', 'pl', 'php', 'jar', 'vbs', 'scr']);
const TEXT_EXT = new Set(['md', 'json', 'txt', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'env', 'csv', 'xml', 'html']);
const SKIP_MD = new Set(['readme.md', 'license.md', 'changelog.md', 'contributing.md', 'code_of_conduct.md']);

const ext = (p: string) => (p.includes('.') ? p.slice(p.lastIndexOf('.') + 1).toLowerCase() : '');
const decode = (d: Uint8Array) => new TextDecoder('utf-8').decode(d);
const baseName = (p: string) => p.slice(p.lastIndexOf('/') + 1);
const isScript = (f: SourceFile) => SCRIPT_EXT.has(ext(f.path)) || (f.data.length > 2 && f.data[0] === 0x23 && f.data[1] === 0x21);

/** Comprueba una ruta de paquete: relativa, sin `..`, sin unidad ni caracteres nulos [R25.3]. */
export function isSafePackagePath(raw: string): boolean {
  const p = raw.replace(/\\/g, '/');
  if (p.length === 0 || p.includes('\0') || p.startsWith('/') || /^[A-Za-z]:/.test(p)) return false;
  return !p.split('/').some((seg) => seg === '..');
}

/** Quita la carpeta envolvente única y el prefijo `.claude/` para reconocer agentes y skills [R25.2]. */
function normalize(files: SourceFile[]): SourceFile[] {
  let out = files.map((f) => ({ path: f.path.replace(/\\/g, '/').replace(/^\.\//, ''), data: f.data }));
  const tops = new Set(out.map((f) => f.path.split('/')[0]));
  if (out.length > 0 && tops.size === 1 && out.every((f) => f.path.includes('/')) && !['agents', 'skills', '.claude'].includes([...tops][0]!)) {
    out = out.map((f) => ({ path: f.path.slice(f.path.indexOf('/') + 1), data: f.data }));
  }
  return out.map((f) => (f.path.startsWith('.claude/') ? { path: f.path.slice(8), data: f.data } : f));
}

function mapModel(raw: string | undefined): { model: string; warn?: string } {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === '' || v === 'inherit') return { model: DEFAULT_MODEL };
  const exact = MODELS.find((m) => m.id === v);
  if (exact) return { model: exact.id };
  for (const fam of ['opus', 'sonnet', 'haiku']) {
    if (v.includes(fam)) return { model: MODELS.find((m) => m.id.includes(fam))!.id };
  }
  return { model: DEFAULT_MODEL, warn: `Modelo desconocido «${raw}»: se usará el modelo por defecto` };
}

const names = (list: string[], max = 3) => list.slice(0, max).join(', ') + (list.length > max ? ` y ${list.length - max} más` : '');

/**
 * Analiza un paquete sin ejecutar nada [R25.2][R25.4][R25.5]. `existing` son los ids ya usados en el proyecto.
 * Devuelve el informe (para la pantalla de revisión) y el plan de instalación.
 */
export function analyzeImport(tree: SourceTree, existing: { agentIds: ReadonlySet<string>; skillIds: ReadonlySet<string> }): ImportPlan {
  const files = normalize(tree.files);
  const report: ImportReport = { items: [], mcp: [], ignored: 0 };
  const plan: ImportPlan = { report, agents: new Map(), skills: new Map() };
  const used = new Set<string>();
  const claimed = new Set<string>();

  // --- skills: carpetas con SKILL.md ---
  const skillDirs = new Set<string>();
  for (const f of files) {
    const m = /^(?:skills\/)?([^/]+)\/SKILL\.md$/i.exec(f.path);
    if (m) skillDirs.add(f.path.slice(0, f.path.length - '/SKILL.md'.length));
    else if (f.path.toLowerCase() === 'skill.md') skillDirs.add('');
  }
  const skillKeyByName = new Map<string, string>();
  for (const dir of [...skillDirs].sort()) {
    const prefix = dir === '' ? '' : `${dir}/`;
    claimed.add(`${prefix}SKILL.md`);
    const md = files.find((f) => f.path.toLowerCase() === `${prefix}skill.md`)!;
    const { data, body } = parseFrontmatter(decode(md.data));
    const folder = dir === '' ? '' : baseName(dir);
    const name = (data['name'] ?? folder) || 'skill';
    const own = files.filter((f) => f.path.startsWith(prefix) && f.path !== md.path && !(dir === '' && skillDirs.size > 1));
    own.forEach((f) => claimed.add(f.path));
    const warnings: ImportWarning[] = [];
    const scripts = own.filter(isScript).map((f) => f.path.slice(prefix.length));
    if (scripts.length > 0) warnings.push({ code: 'script', message: scripts.length === 1 ? `Incluye un script o ejecutable: ${names(scripts)}` : `Incluye ${scripts.length} scripts o ejecutables: ${names(scripts)}` });
    if (containsSecrets(decode(md.data)) || own.some((f) => TEXT_EXT.has(ext(f.path)) && containsSecrets(decode(f.data)))) {
      warnings.push({ code: 'secrets', message: 'Contiene algo que parece una clave o un token' });
    }
    const baseId = slugify(folder || name, new Set(), 'skill');
    const id = slugify(folder || name, new Set([...existing.skillIds, ...used]), 'skill');
    used.add(id);
    const conflictWith = id !== baseId ? baseId : undefined;
    if (conflictWith) warnings.push({ code: 'conflict', message: `Ya existe «${conflictWith}»; se instalaría como «${id}»` });
    const skill: SkillDefinition = { id, name: name.slice(0, LIMITS.name), description: (data['description'] ?? '').trim().slice(0, LIMITS.description), body: body.replace(/\s+$/, '') };
    if ((data['name'] ?? '').length > LIMITS.name || (data['description'] ?? '').trim().length > LIMITS.description) warnings.push({ code: 'trimmed', message: 'El nombre o la descripción se han recortado al límite' });
    const problems = validateSkill(skill);
    const blocked = problems.length > 0 ? problems[0]!.message : body.length > SKILL_LIMITS.body ? `El contenido supera ${SKILL_LIMITS.body} caracteres` : undefined;
    const key = `skill:${dir === '' ? id : dir}`;
    report.items.push({ key, kind: 'skill', name: skill.name, id, description: skill.description, ...(conflictWith ? { conflictWith } : {}), ...(blocked ? { blocked } : {}), warnings, files: own.map((f) => ({ path: f.path.slice(prefix.length), size: f.data.length })) });
    plan.skills.set(key, { skill, names: [name, folder, baseId].filter((x) => x !== ''), files: own.map((f) => ({ path: f.path.slice(prefix.length), data: f.data })) });
    for (const n of [name.toLowerCase(), folder.toLowerCase()]) if (n) skillKeyByName.set(n, key);
  }

  // --- agentes: .md en agents/ o en la raíz ---
  for (const f of files) {
    if (claimed.has(f.path)) continue;
    const m = /^(?:agents\/)?([^/]+)\.md$/i.exec(f.path);
    if (!m || SKIP_MD.has(baseName(f.path).toLowerCase())) continue;
    const { data, body } = parseFrontmatter(decode(f.data));
    if (!data['name'] && !f.path.toLowerCase().startsWith('agents/')) continue;
    claimed.add(f.path);
    const name = (data['name'] ?? m[1]!).trim() || m[1]!;
    const warnings: ImportWarning[] = [];
    const baseId = slugify(name, new Set(), 'agente');
    const id = slugify(name, new Set([...existing.agentIds, ...[...plan.agents.values()].map((a) => a.agent.id)]), 'agente');
    const conflictWith = id !== baseId ? baseId : undefined;
    if (conflictWith) warnings.push({ code: 'conflict', message: `Ya existe «${conflictWith}»; se instalaría como «${id}»` });
    const model = mapModel(data['model']);
    if (model.warn) warnings.push({ code: 'model', message: model.warn });
    const tools = (data['tools'] ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    if (tools.length > 0) warnings.push({ code: 'tools', message: `Pide las herramientas: ${names(tools, 6)}` });
    if (containsSecrets(decode(f.data))) warnings.push({ code: 'secrets', message: 'Contiene algo que parece una clave o un token' });
    const skillNames = (data['skills'] ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    const missing = skillNames.filter((s) => !skillKeyByName.has(s.toLowerCase()));
    if (missing.length > 0) warnings.push({ code: 'missing-skill', message: `Usa skills que no vienen en el paquete: ${names(missing)}` });
    const description = (data['description'] ?? '').trim();
    if (name.length > LIMITS.name || description.length > LIMITS.description) warnings.push({ code: 'trimmed', message: 'El nombre o la descripción se han recortado al límite' });
    const agent: AgentDefinition = { id, schemaVersion: 1, name: name.slice(0, LIMITS.name), description: description.slice(0, LIMITS.description), instructions: body.replace(/\s+$/, ''), model: model.model, contextIds: [], skillIds: [] };
    const problems = validateAgent(agent, { contextIds: new Set() });
    const key = `agent:${f.path}`;
    const skillKeys = skillNames.filter((s) => skillKeyByName.has(s.toLowerCase())).map((s) => skillKeyByName.get(s.toLowerCase())!);
    report.items.push({ key, kind: 'agent', name: agent.name, id, description: agent.description, ...(conflictWith ? { conflictWith } : {}), ...(problems.length > 0 ? { blocked: problems[0]!.message } : {}), warnings, files: [], ...(skillKeys.length > 0 ? { skills: skillKeys } : {}) });
    plan.agents.set(key, { agent, skillNames: skillKeys });
  }

  // --- MCP: solo informativo [R25.5] ---
  const mcp = files.find((f) => f.path === '.mcp.json');
  if (mcp) {
    claimed.add(mcp.path);
    try {
      const parsed = JSON.parse(decode(mcp.data)) as { mcpServers?: Record<string, Record<string, unknown>> };
      for (const [name, cfg] of Object.entries(parsed.mcpServers ?? {})) {
        const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
        const keys = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.keys(v) : []);
        const args = strs(cfg?.['args']);
        const secretNames = [...keys(cfg?.['env']), ...keys(cfg?.['headers'])];
        report.mcp.push({
          name,
          ...(typeof cfg?.['command'] === 'string' ? { command: cfg['command'] } : {}),
          ...(args.length > 0 ? { args } : {}),
          ...(typeof cfg?.['url'] === 'string' ? { url: cfg['url'] } : {}),
          ...(secretNames.length > 0 ? { secretNames } : {}),
        });
      }
    } catch {
      /* .mcp.json ilegible: se cuenta como ignorado */
      claimed.delete(mcp.path);
    }
  }
  report.ignored = files.filter((f) => !claimed.has(f.path)).length;
  return plan;
}

/** Lo que necesita la instalación del proyecto; `ProjectStore` y la versión en memoria lo cumplen. */
export interface InstallTarget {
  listAgents(): Promise<{ id: string }[]>;
  listSkillIds(): Promise<string[]>;
  saveSkill(skill: SkillDefinition): Promise<void>;
  writeSkillFile(id: string, rel: string, data: Uint8Array): Promise<void>;
  deleteSkill(id: string): Promise<boolean>;
  saveAgent(agent: AgentDefinition): Promise<void>;
}

const SAFE_CODES = new Set(['invalid', 'secrets', 'outside-root', 'exists', 'unavailable']);
const messageOf = (err: unknown): string =>
  err instanceof Error && SAFE_CODES.has((err as { code?: string }).code ?? '') ? err.message : 'No se pudo instalar';

/**
 * Instala solo los elementos marcados [R25.6][R25.7]. Las skills van primero para que los agentes puedan
 * referirlas. Si un id se ocupó desde el análisis se elige otro libre; un fallo no detiene el resto.
 */
export async function installImport(target: InstallTarget, plan: ImportPlan, keys: readonly string[]): Promise<ImportResult> {
  const chosen = new Set(keys);
  const result: ImportResult = { agents: [], skills: [], failed: [], notes: [] };
  for (const k of chosen) if (!plan.report.items.some((i) => i.key === k)) result.failed.push({ key: k, message: 'Ese elemento no está en el paquete' });
  const installedSkills = new Map<string, string>();
  const items = plan.report.items.filter((i) => chosen.has(i.key));
  for (const item of items.filter((i) => i.kind === 'skill')) {
    const entry = plan.skills.get(item.key)!;
    if (item.blocked) {
      result.failed.push({ key: item.key, message: item.blocked });
      continue;
    }
    const id = slugify(entry.skill.id, new Set(await target.listSkillIds()), 'skill');
    try {
      await target.saveSkill({ ...entry.skill, id });
      for (const f of entry.files) await target.writeSkillFile(id, f.path, f.data);
      installedSkills.set(item.key, id);
      result.skills.push(id);
      if (id !== entry.skill.id) result.notes.push(`La skill «${entry.skill.name}» se instaló como «${id}»`);
    } catch (err) {
      await target.deleteSkill(id).catch(() => undefined);
      result.failed.push({ key: item.key, message: messageOf(err) });
    }
  }
  for (const item of items.filter((i) => i.kind === 'agent')) {
    const entry = plan.agents.get(item.key)!;
    if (item.blocked) {
      result.failed.push({ key: item.key, message: item.blocked });
      continue;
    }
    const id = slugify(entry.agent.id, new Set((await target.listAgents()).map((a) => a.id)), 'agente');
    const skillIds = entry.skillNames.map((k) => installedSkills.get(k)).filter((x): x is string => x !== undefined);
    if (skillIds.length < entry.skillNames.length) result.notes.push(`El agente «${entry.agent.name}» usa skills que no se instalaron; se han quitado de su lista`);
    try {
      await target.saveAgent({ ...entry.agent, id, skillIds });
      result.agents.push(id);
      if (id !== entry.agent.id) result.notes.push(`El agente «${entry.agent.name}» se instaló como «${id}»`);
    } catch (err) {
      result.failed.push({ key: item.key, message: messageOf(err) });
    }
  }
  return result;
}

/** `true` si la ruta parece un script o ejecutable [R24.12][R25.4]. */
export const isScriptPath = (p: string): boolean => SCRIPT_EXT.has(ext(p));

const JUNK = new Set(['.ds_store', 'thumbs.db']);

export type SkillFilesPlan =
  | { ok: true; add: SourceFile[]; scripts: string[]; renamed: number }
  | { ok: false; message: string };

/**
 * Decide dónde se copian los archivos de referencia de una skill [R24.9][R24.10]: bajo `referencias/`,
 * sin sobrescribir (sufijo `-2`), contando lo que la skill ya tiene.
 */
export function planSkillFiles(existing: readonly { path: string; size: number }[], incoming: readonly SourceFile[], dir = 'referencias'): SkillFilesPlan {
  const files = incoming.filter((f) => !JUNK.has(baseName(f.path).toLowerCase()));
  if (files.length === 0) return { ok: false, message: 'No hay archivos que añadir' };
  if (files.some((f) => !isSafePackagePath(f.path))) return { ok: false, message: 'Hay archivos con rutas no permitidas (absolutas o que salen de la carpeta)' };
  const taken = new Set(existing.map((f) => f.path.toLowerCase()));
  const add: SourceFile[] = [];
  let renamed = 0;
  for (const f of files) {
    const clean = f.path.replace(/\\/g, '/').replace(/^\.\//, '');
    let target = `${dir}/${clean}`;
    if (taken.has(target.toLowerCase())) {
      const dot = target.lastIndexOf('.');
      const slash = target.lastIndexOf('/');
      const stem = dot > slash ? target.slice(0, dot) : target;
      const tail = dot > slash ? target.slice(dot) : '';
      let n = 2;
      while (taken.has(`${stem}-${n}${tail}`.toLowerCase())) n++;
      target = `${stem}-${n}${tail}`;
      renamed++;
    }
    taken.add(target.toLowerCase());
    add.push({ path: target, data: f.data });
  }
  const count = existing.length + add.length;
  const total = existing.reduce((n, f) => n + f.size, 0) + add.reduce((n, f) => n + f.data.length, 0);
  if (add.some((f) => f.data.length > IMPORT_LIMITS.file) || count > IMPORT_LIMITS.files || total > IMPORT_LIMITS.total) {
    return { ok: false, message: `No caben: máximo ${IMPORT_LIMITS.files} archivos, ${IMPORT_LIMITS.total / 1024 / 1024} MB en total y ${IMPORT_LIMITS.file / 1024 / 1024} MB por archivo, contando lo que la skill ya tiene` };
  }
  return { ok: true, add, scripts: add.filter(isScript).map((f) => f.path), renamed };
}

/** Servidor MCP del proyecto a partir de lo leído en `.mcp.json`: llega apagado y sin secretos [R30.6]. */
export function mcpFromImport(m: ImportMcp, taken: ReadonlySet<string>): McpServerDefinition {
  const base = slugify(m.name, taken, 'mcp');
  return {
    id: base,
    schemaVersion: MCP_SCHEMA_VERSION,
    name: m.name.slice(0, 60),
    description: '',
    transport: m.url && !m.command ? 'http' : 'stdio',
    ...(m.url && !m.command ? { url: m.url } : { command: m.command ?? '', args: m.args ?? [] }),
    ...(m.secretNames && m.secretNames.length > 0 ? { secretNames: m.secretNames.filter((n) => SECRET_NAME.test(n)).slice(0, 20) } : {}),
    enabled: false,
  };
}
