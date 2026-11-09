import { forwardEdges, returnEdges, type Diagram } from '../../diagrams';
import type { Id } from '../../shared';
import { pathKey } from '../replay';
import type { Provenance, RunMemory } from './run-memory';

/** El paso que va a recibir la memoria [R72.7]. */
export interface MemoryReader {
  nodeId: Id;
  path: readonly Id[];
  /** `seq` de su `node.started` y su pasada [R72.8][R72.9]. */
  startSeq: number;
  pass: number;
}

/** Diagrama de cada nivel de la ejecución, por su ruta (`''` es el principal) [R72.7]. */
export type LevelDiagrams = ReadonlyMap<string, Diagram>;

/** Antecesores de cada nodo en un nivel, por aristas que no son de retorno [R72.7]. */
function ancestorsOf(d: Diagram): Map<Id, Set<Id>> {
  const forward = forwardEdges(d, returnEdges(d));
  const parents = new Map<Id, Id[]>();
  for (const e of forward) parents.set(e.to, [...(parents.get(e.to) ?? []), e.from]);
  const memo = new Map<Id, Set<Id>>();
  const visit = (id: Id): Set<Id> => {
    const hit = memo.get(id);
    if (hit) return hit;
    const out = new Set<Id>();
    memo.set(id, out);
    for (const p of parents.get(id) ?? []) {
      out.add(p);
      for (const a of visit(p)) out.add(a);
    }
    return out;
  };
  for (const n of d.nodes) visit(n.id);
  return memo;
}

const startsWith = (path: readonly Id[], prefix: readonly Id[]) => prefix.every((p, i) => path[i] === p);

/**
 * ¿Ve este paso esta entrada? [R72.7][R72.8]. Se mira de dentro afuera: en el nivel del paso y luego en el de cada
 * contenedor (bucle o subdiagrama), el nodo del que cuelga la entrada tiene que ser antecesor del paso o de su
 * contenedor. En el nivel del propio paso también se ve lo de pasadas anteriores (vueltas de bucle y retornos de
 * revisión), y nunca lo de una rama en paralelo de la misma vuelta.
 */
export function visibleTo(entry: Provenance, reader: MemoryReader, levels: LevelDiagrams): boolean {
  if (entry.seq >= reader.startSeq) return false;
  for (let i = reader.path.length; i >= 0; i--) {
    const level = reader.path.slice(0, i);
    if (!startsWith(entry.path, level)) continue;
    const ref = i === reader.path.length ? reader.nodeId : reader.path[i]!;
    const anchor = entry.path.length > i ? entry.path[i]! : entry.nodeId;
    if (ancestorsAt(levels, level).get(ref)?.has(anchor)) return true;
    // Lo que cuelga del propio contenedor (las vueltas de su bucle, por ejemplo) también se ve [R72.8].
    if (i < reader.path.length && anchor === ref && entry.path.length === i) return true;
    // En su propio nivel: solo lo de una vuelta anterior, que tiene una pasada menor [R72.8].
    return i === reader.path.length && entry.pass < reader.pass;
  }
  return false;
}

const ancestorCache = new WeakMap<Diagram, Map<Id, Set<Id>>>();
function ancestorsAt(levels: LevelDiagrams, level: readonly Id[]): Map<Id, Set<Id>> {
  const d = levels.get(level.join('/'));
  if (!d) return new Map();
  let a = ancestorCache.get(d);
  if (!a) {
    a = ancestorsOf(d);
    ancestorCache.set(d, a);
  }
  return a;
}

/** Lo que ve un paso: la rama y las decisiones son de todos; lo demás, por el grafo [R72.7]–[R72.9]. */
export function selectFor(m: RunMemory, reader: MemoryReader, levels: LevelDiagrams): RunMemory {
  const see = <T extends Provenance>(list: T[]) => list.filter((e) => visibleTo(e, reader, levels));
  const before = (e: Provenance) => e.seq < reader.startSeq;
  return {
    ...(m.branch ? { branch: m.branch } : {}),
    decisions: m.decisions.filter(before),
    agreements: see(m.agreements),
    notes: see(m.notes),
    alerts: see(m.alerts),
    route: see(m.route),
    steps: m.steps
      .map((s) => ({ ...s, passes: s.passes.filter((p) => visibleTo({ source: 'events', nodeId: s.nodeId, path: s.path, pass: p.pass, seq: p.seq }, reader, levels)) }))
      .filter((s) => s.passes.length > 0),
    files: see(m.files),
    starts: m.starts,
  };
}

/** Clave de un nivel en `LevelDiagrams`. */
export const levelKey = (path: readonly Id[]) => path.join('/');

/** Clave de un paso, como en el resto del motor. */
export { pathKey };
