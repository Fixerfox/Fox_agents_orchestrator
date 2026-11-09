import type { Id } from '../shared';
import { forwardEdges, returnEdges } from './graph';
import type { Diagram } from './model';

/** Una rama de un abanico: desde la arista que sale hasta antes del nodo que la junta [R73.1]. */
export interface ParallelBranch {
  /** Primer nodo de la rama (destino de la arista que sale del abanico). */
  entry: Id;
  /** Nodos de la rama, en el orden del diagrama. */
  nodes: Id[];
}

/** Un nodo del que salen ramas que corren a la vez, con sus ramas [R73.1]. */
export interface ParallelRegion {
  id: Id;
  branches: ParallelBranch[];
}

/** Nodos que eligen una salida: sus aristas no corren a la vez [R73.1]. */
const CHOOSERS = new Set(['router', 'review']);

/**
 * Ramas en paralelo de un nivel del diagrama [R73.1]: por cada nodo con dos o más salidas que corren a la vez, lo
 * alcanzable desde cada salida (sin aristas de retorno) que no se alcanza desde otra. Lo que se alcanza desde dos ramas
 * es lo que las junta y no es de ninguna. Solo cuentan los abanicos con al menos dos ramas con nodos.
 */
export function parallelRegions(d: Pick<Diagram, 'nodes' | 'edges'>): ParallelRegion[] {
  const forward = forwardEdges(d, returnEdges(d));
  const next = new Map<Id, Id[]>();
  for (const e of forward) next.set(e.from, [...(next.get(e.from) ?? []), e.to]);
  const reach = (start: Id): Set<Id> => {
    const seen = new Set<Id>([start]);
    const todo = [start];
    while (todo.length > 0) {
      for (const to of next.get(todo.pop()!) ?? []) {
        if (!seen.has(to)) {
          seen.add(to);
          todo.push(to);
        }
      }
    }
    return seen;
  };
  const order = new Map(d.nodes.map((n, i) => [n.id, i]));
  const out: ParallelRegion[] = [];
  for (const n of d.nodes) {
    if (CHOOSERS.has(n.kind)) continue;
    const targets = [...new Set(next.get(n.id) ?? [])];
    if (targets.length < 2) continue;
    const reached = targets.map((t) => ({ entry: t, set: reach(t) }));
    const branches = reached
      .map(({ entry, set }) => ({ entry, nodes: [...set].filter((id) => id !== n.id && reached.every((o) => o.entry === entry || !o.set.has(id))).sort((a, b) => order.get(a)! - order.get(b)!) }))
      .filter((b) => b.nodes.length > 0 && b.nodes.includes(b.entry));
    if (branches.length >= 2) out.push({ id: n.id, branches });
  }
  return out;
}
