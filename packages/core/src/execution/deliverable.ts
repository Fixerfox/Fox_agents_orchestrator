import type { DeliverableItem, DeliverableKind, DeliverableSpec } from '../diagrams';
import type { Id, Payload } from '../shared';
import type { RunEvent } from './events';

export const MAX_DELIVERABLE_FILES = 200;

export const MAX_DELIVERABLE_URLS = 50;

/** Tope del contexto que recibe Claude para componer [R46.6]. */
export const MAX_DELIVERABLE_CONTEXT = 30_000;

/** Intentos por elemento compuesto con Claude [R46.6]. */
export const DELIVERABLE_ATTEMPTS = 2;

/** Cómo se nombra cada elemento ante el agente [R46.4]. */
function itemPhrase(it: DeliverableItem): string {
  switch (it.kind) {
    case 'links':
      return 'la lista de archivos creados o modificados y los enlaces (URLs) que se generen';
    case 'summary':
      return `un resumen en Markdown de lo hecho${it.instructions?.trim() ? ` (${it.instructions.trim()})` : ''}`;
    case 'json':
      return `datos en JSON${it.schema?.trim() ? ' que cumplen un esquema' : ''}${it.instructions?.trim() ? ` (${it.instructions.trim()})` : ''}`;
    case 'custom':
      return `una sección «${it.title.trim()}»: ${it.instructions.trim()}`;
  }
}

/** Texto completo que reciben los pasos finales [R46.4]. */
export function deliverableBrief(spec: DeliverableSpec): string {
  return `Al terminar esta ejecución se entregará al usuario:\n${spec.items.map((it) => `- ${itemPhrase(it)}`).join('\n')}`;
}

/** Una sola línea con el objetivo final, para los demás agentes con «Todos» [R46.4]. */
export function deliverableGoal(spec: DeliverableSpec): string {
  return `Objetivo final de la ejecución: se entregará ${spec.items.map(itemPhrase).join('; ')}.`;
}

/** Título de la sección de cada elemento en el documento [R46.7]. */
export function itemTitle(it: DeliverableItem): string {
  switch (it.kind) {
    case 'links':
      return 'Enlaces';
    case 'summary':
      return 'Resumen';
    case 'json':
      return 'Datos (JSON)';
    case 'custom':
      return it.title.trim();
  }
}

export interface DeliverableLinks {
  files: { path: string; change?: 'created' | 'modified' }[];
  urls: string[];
}

const URL_RE = /https?:\/\/[^\s<>()[\]{}"'`]+/g;

/** Archivos tocados y URLs de las salidas de los agentes, a partir de los eventos [R46.6]. */
export function collectLinks(events: readonly RunEvent[], isAgent: (nodeId: Id, path: readonly Id[]) => boolean): DeliverableLinks {
  const files = new Map<string, 'created' | 'modified' | undefined>();
  const urls: string[] = [];
  const addFile = (p: string, change?: 'created' | 'modified') => {
    if (!files.has(p) && files.size >= MAX_DELIVERABLE_FILES) return;
    const prev = files.get(p);
    files.set(p, prev === 'created' || change === 'created' ? 'created' : (change ?? prev));
  };
  for (const e of events) {
    if (e.type === 'file.produced') addFile(e.path, e.change);
    if (e.type === 'node.finished' && e.status === 'succeeded' && e.output && isAgent(e.nodeId, e.nodePath ?? [])) {
      for (const f of e.output.files ?? []) addFile(f);
      for (const m of e.output.text.matchAll(URL_RE)) {
        const url = m[0].replace(/[.,;:!?*_]+$/, '');
        if (!urls.includes(url) && urls.length < MAX_DELIVERABLE_URLS) urls.push(url);
      }
    }
  }
  return { files: [...files].map(([path, change]) => ({ path, ...(change ? { change } : {}) })), urls };
}

/** Sección «Enlaces» en Markdown [R46.6]. */
export function linksMarkdown(links: DeliverableLinks): string {
  if (links.files.length === 0 && links.urls.length === 0) return 'No se crearon ni cambiaron archivos y no hay enlaces.';
  const lines: string[] = [];
  if (links.files.length > 0) {
    lines.push('Rutas relativas a la carpeta del proyecto:', '');
    for (const f of links.files) lines.push(`- \`${f.path}\`${f.change ? ` · ${f.change === 'created' ? 'creado' : 'modificado'}` : ''}`);
  }
  if (links.urls.length > 0) {
    if (lines.length > 0) lines.push('');
    for (const u of links.urls) lines.push(`- <${u}>`);
  }
  return lines.join('\n');
}

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max)}…` : s);

/** Lo que recibe Claude para escribir el resumen, el JSON o una sección propia [R46.6]. */
export function deliverableContext(args: {
  request: string;
  input: Payload;
  steps: { label: string; status: string; text: string }[];
  links: DeliverableLinks;
}): string {
  const parts = [
    `## Petición\n\n${clip(args.request.trim() || '(sin texto)', 4000)}`,
    `## Lo que llegó a la Salida\n\n${clip(args.input.text.trim() || '(sin texto)', 12_000)}`,
  ];
  if (args.steps.length > 0) parts.push(`## Pasos\n\n${args.steps.map((s) => `### ${s.label} (${s.status})\n\n${clip(s.text.trim() || '(sin salida)', 2000)}`).join('\n\n')}`);
  if (args.links.files.length > 0 || args.links.urls.length > 0) parts.push(`## Archivos y enlaces\n\n${linksMarkdown(args.links)}`);
  return clip(parts.join('\n\n'), MAX_DELIVERABLE_CONTEXT);
}

/** Instrucciones de cada elemento compuesto con Claude [R46.6]. */
export function deliverableInstructions(it: Exclude<DeliverableItem, { kind: 'links' }>): string {
  const extra = it.instructions?.trim();
  switch (it.kind) {
    case 'summary':
      return `Escribe para el usuario un resumen en Markdown de esta ejecución: qué se pidió, qué se hizo, las decisiones importantes y lo que queda pendiente. No pongas títulos de nivel 1 ni 2 (usa ### si hace falta).${extra ? ` Además: ${extra}` : ''}`;
    case 'custom':
      return `Escribe en Markdown el contenido de la sección «${it.title.trim()}» para el usuario, a partir de lo hecho en esta ejecución: ${it.instructions.trim()}. No repitas el título ni pongas títulos de nivel 1 ni 2.`;
    case 'json':
      return extra || 'Extrae en JSON los datos principales del resultado de esta ejecución.';
  }
}

/** Documento completo del entregable [R46.7]. */
export function deliverableMarkdown(sections: { title: string; body: string }[]): string {
  return [`# Entregable`, ...sections.map((s) => `## ${s.title}\n\n${s.body.trim()}`)].join('\n\n') + '\n';
}

/** Lo que dice cada elemento del entregable al terminar [R46.7]. */
export interface DeliverableItemResult {
  kind: DeliverableKind;
  /** Título de su sección («Enlaces», «Resumen»…) [R46.7]. */
  title: string;
  ok: boolean;
  error?: string;
  attempts: number;
  tokens?: number;
}
