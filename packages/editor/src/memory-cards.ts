import { memoryFromEvents, pathKey, type Id, type MemoryBlock, type RunEvent } from '@orquestador/core';

/** Una tarjeta de la memoria: su bloque, su paso, el texto, los ficheros y de dónde sale [R72.22]. */
export interface MemoryCard {
  block: Exclude<MemoryBlock, 'branch' | 'files'>;
  /** Clave del paso (`ruta/nodo`), para marcar las que tienen avisos. */
  key: string;
  label: string;
  text: string;
  files: string[];
  /** `events`: sale de los eventos; `supervisor`: de su revisión; `agent`: lo escribió un agente [R72.22]. */
  source: 'events' | 'supervisor' | 'agent';
  seq: number;
}

const one = (s: string) => s.replace(/\s+/g, ' ').trim();

/** La memoria completa de una ejecución como tarjetas, en orden de llegada, sin topes [R72.22]. */
export function memoryCards(events: readonly RunEvent[], labelOf: (id: Id, path: readonly Id[]) => string): MemoryCard[] {
  const m = memoryFromEvents(events);
  const filesOf = new Map<string, string[]>();
  for (const f of m.files) {
    const k = pathKey(f.path, f.nodeId);
    filesOf.set(k, [...(filesOf.get(k) ?? []), f.path_]);
  }
  const card = (block: MemoryCard['block'], nodeId: Id, path: readonly Id[], text: string, source: MemoryCard['source'], seq: number, files: string[] = []): MemoryCard => ({ block, key: pathKey(path, nodeId), label: labelOf(nodeId, path), text, files, source, seq });
  const out: MemoryCard[] = [
    ...m.decisions.map((d) => card('decisions', d.nodeId, d.path, d.kind === 'correction' ? `«${one(d.answer)}»` : `«${one(d.question)}» → «${one(d.answer)}»${d.auto ? ' (respondida sola)' : ''}`, 'events', d.seq)),
    ...m.agreements.map((a) => card('agreements', a.nodeId, a.path, [one(a.common), ...a.branches.map((b) => `${labelOf(b.to, a.path)}: ${b.files.join(', ')}`)].filter(Boolean).join(' · '), 'events', a.seq)),
    ...m.notes.map((n) => card('notes', n.nodeId, n.path, n.text, 'agent', n.seq)),
    ...m.alerts.map((a) => card('alerts', a.nodeId, a.path, a.detail, 'events', a.seq)),
    ...m.route.map((r) => card('route', r.nodeId, r.path, r.text, 'events', r.seq)),
    ...m.steps.map((s) => {
      const last = s.passes.at(-1)!;
      const earlier = s.passes.length > 1 ? ` (${s.passes.length} pasadas)` : '';
      const decided = last.decided.length > 0 ? ` Decidió: ${last.decided.join('; ')}.` : '';
      return card('steps', s.nodeId, s.path, `${last.summary}${earlier}${decided}`.trim(), last.reviewed ? 'supervisor' : 'events', last.seq, filesOf.get(pathKey(s.path, s.nodeId)) ?? []);
    }),
  ];
  // Lo anotado de un paso que aún no ha cerrado también se ve (la revisión llega antes de cerrar) [R72.22].
  const seen = new Set(out.filter((c) => c.block === 'steps').map((c) => c.key));
  const pending = new Map<string, MemoryCard>();
  for (const e of events) {
    if (e.type !== 'supervisor.note') continue;
    const path = e.nodePath ?? [];
    const key = pathKey(path, e.nodeId);
    if (seen.has(key)) continue;
    pending.set(key, { block: 'steps', key, label: labelOf(e.nodeId, path), text: e.text, files: [...e.files], source: e.reviewed ? 'supervisor' : 'events', seq: e.seq });
  }
  out.push(...pending.values());
  return out.sort((a, b) => a.seq - b.seq);
}
