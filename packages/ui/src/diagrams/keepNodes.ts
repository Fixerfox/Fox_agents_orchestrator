import type { CanvasNode } from './Canvas';

const sameValue = (a: unknown, b: unknown, sameFunctions: boolean): boolean => {
  if (Object.is(a, b)) return true;
  if (typeof a === 'function' || typeof b === 'function') return sameFunctions && typeof a === typeof b;
  return typeof a === 'object' && typeof b === 'object' && JSON.stringify(a) === JSON.stringify(b);
};

function sameNode(a: CanvasNode, b: CanvasNode, sameFunctions: boolean): boolean {
  if (a.type !== b.type || a.selected !== b.selected || a.position.x !== b.position.x || a.position.y !== b.position.y) return false;
  const left = a.data as Record<string, unknown>;
  const right = b.data as Record<string, unknown>;
  const keys = Object.keys(right);
  return keys.length === Object.keys(left).length && keys.every((k) => sameValue(left[k], right[k], sameFunctions));
}

/**
 * Pasa al lienzo los nodos recién calculados sin perder lo que React Flow sabe de ellos. Un nodo sin `measured` se
 * oculta hasta volver a medirse, y eso es el parpadeo. Con una ejecución (`live`) no se edita nada, así que el nodo
 * que no ha cambiado se reutiliza tal cual, aunque sus funciones sean otras [R15.15].
 */
export function keepNodes(prev: readonly CanvasNode[], next: readonly CanvasNode[], live: boolean): CanvasNode[] {
  const old = new Map(prev.map((n) => [n.id, n]));
  const merged = next.map((n) => {
    const was = old.get(n.id);
    if (!was) return n;
    const kept = { ...n, ...(was.measured ? { measured: was.measured } : {}), ...(was.selected ? { selected: true } : {}) };
    return live && sameNode(was, kept, true) ? was : kept;
  });
  return merged.length === prev.length && merged.every((n, i) => n === prev[i]) ? (prev as CanvasNode[]) : merged;
}
