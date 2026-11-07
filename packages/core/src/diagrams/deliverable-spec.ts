import { type Id, parseSchema } from '../shared';
import { returnEdges } from './graph';
import type { DeliverableKind, DeliverableSpec, Diagram } from './model';

/** Límites del entregable [R46.1]. */
export const MAX_DELIVERABLE_ITEMS = 6;

export const MAX_DELIVERABLE_TEXT = 20_000;

export const MAX_DELIVERABLE_TITLE = 80;

export const DEFAULT_DELIVERABLE_FILE = 'entregable';

const FILE_NAME = /^[a-z0-9][a-z0-9_-]{0,40}$/;

const KINDS: readonly DeliverableKind[] = ['links', 'summary', 'json', 'custom'];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const optText = (v: unknown, max = MAX_DELIVERABLE_TEXT) => v === undefined || (typeof v === 'string' && v.length <= max);

/** Problemas de un entregable; vacío si es válido [R46.1]. */
export function deliverableProblems(spec: unknown): { code: string; message: string }[] {
  const out: { code: string; message: string }[] = [];
  const bad = (message: string) => out.push({ code: 'deliverable-invalid', message });
  if (!isObj(spec)) return [{ code: 'deliverable-invalid', message: 'El entregable no es un objeto' }];
  for (const k of Object.keys(spec)) if (!['items', 'notify', 'onMissing', 'fileName'].includes(k)) bad(`Campo desconocido «${k}»`);
  const items = spec['items'];
  if (!Array.isArray(items) || items.length === 0) bad('El entregable necesita al menos un elemento');
  else if (items.length > MAX_DELIVERABLE_ITEMS) bad(`El entregable tiene como máximo ${MAX_DELIVERABLE_ITEMS} elementos`);
  else {
    const seen = new Set<string>();
    items.forEach((it: unknown, i) => {
      const n = i + 1;
      if (!isObj(it) || !KINDS.includes(it['kind'] as DeliverableKind)) return bad(`Elemento ${n}: tipo desconocido`);
      const kind = it['kind'] as DeliverableKind;
      if ((kind === 'links' || kind === 'summary') && seen.has(kind)) bad(`«${kind}» solo puede aparecer una vez`);
      seen.add(kind);
      const allowed: Record<DeliverableKind, string[]> = { links: [], summary: ['instructions'], json: ['schema', 'instructions'], custom: ['title', 'instructions'] };
      for (const k of Object.keys(it)) if (k !== 'kind' && !allowed[kind].includes(k)) bad(`Elemento ${n}: campo desconocido «${k}»`);
      if (!optText(it['instructions'])) bad(`Elemento ${n}: las instrucciones superan ${MAX_DELIVERABLE_TEXT} caracteres`);
      if (kind === 'json') {
        if (!optText(it['schema'])) bad(`Elemento ${n}: el esquema supera ${MAX_DELIVERABLE_TEXT} caracteres`);
        else if (typeof it['schema'] === 'string' && it['schema'].trim()) {
          const { error } = parseSchema(it['schema']);
          if (error) out.push({ code: 'deliverable-bad-schema', message: `Esquema del JSON: ${error}` });
        }
      }
      if (kind === 'custom') {
        const title = typeof it['title'] === 'string' ? it['title'].trim() : '';
        const ins = typeof it['instructions'] === 'string' ? it['instructions'].trim() : '';
        if (!title || !ins) out.push({ code: 'deliverable-empty', message: `Elemento ${n}: la sección propia necesita título e instrucciones` });
        else if (title.length > MAX_DELIVERABLE_TITLE) bad(`Elemento ${n}: el título supera ${MAX_DELIVERABLE_TITLE} caracteres`);
      }
    });
  }
  if (spec['notify'] !== undefined && !['final', 'all', 'none'].includes(spec['notify'] as string)) bad('«Avisar a» no es válido');
  if (spec['onMissing'] !== undefined && !['warn', 'fail'].includes(spec['onMissing'] as string)) bad('«Si no se cumple» no es válido');
  if (spec['fileName'] !== undefined && (typeof spec['fileName'] !== 'string' || !FILE_NAME.test(spec['fileName']))) {
    out.push({ code: 'deliverable-bad-name', message: 'El nombre del archivo solo admite minúsculas, números, - y _ (sin rutas)' });
  }
  return out;
}

export const deliverableFileName = (spec: DeliverableSpec): string => spec.fileName ?? DEFAULT_DELIVERABLE_FILE;

const STEP_KINDS = new Set(['agent', 'subdiagram']);

/**
 * Pasos finales: agentes y subdiagramas del nivel principal desde los que se llega a la Salida sin pasar por otro
 * de esos pasos. Routers, transformar y revisiones no cortan el camino; los retornos no cuentan [R46.2].
 */
export function finalSteps(diagram: Diagram): Id[] {
  const returns = returnEdges(diagram);
  const kind = new Map(diagram.nodes.map((n) => [n.id, n.kind]));
  const out = diagram.nodes.find((n) => n.kind === 'output');
  if (!out) return [];
  const found = new Set<Id>();
  const seen = new Set<Id>([out.id]);
  const queue: Id[] = [out.id];
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const e of diagram.edges) {
      if (e.to !== id || returns.has(e.id) || seen.has(e.from)) continue;
      seen.add(e.from);
      if (STEP_KINDS.has(kind.get(e.from) ?? '')) found.add(e.from);
      else queue.push(e.from);
    }
  }
  return diagram.nodes.filter((n) => found.has(n.id)).map((n) => n.id);
}
