import type { Diagram, DiagramNode } from '../../diagrams';
import type { Id } from '../../shared';
import type { RunEvent } from '../events';
import { renderMemory } from './memory-render';
import { memoryFromEvents, type RunMemory } from './run-memory';

/** Versión del formato de `memory.json` [R72.20]. */
export const MEMORY_FILE_VERSION = 1;

/** Etiqueta de un paso buscándolo en el diagrama y en los cuerpos de sus bucles; si no, su id. */
export function diagramLabelOf(diagram: Diagram | undefined): (nodeId: Id, path: readonly Id[]) => string {
  const find = (d: Diagram | undefined, path: readonly Id[], id: Id): DiagramNode | undefined => {
    if (!d) return undefined;
    if (path.length === 0) return d.nodes.find((n) => n.id === id);
    const container = d.nodes.find((n) => n.id === path[0]);
    return find(container?.loop?.body, path.slice(1), id);
  };
  return (nodeId, path) => find(diagram, path, nodeId)?.label ?? nodeId;
}

/** `memory.json` y `memory.md` de una ejecución, sacados de sus eventos [R72.20]. */
export function memoryFiles(events: readonly RunEvent[], labelOf: (nodeId: Id, path: readonly Id[]) => string): { json: string; markdown: string; memory: RunMemory } {
  const memory = memoryFromEvents(events);
  const { text } = renderMemory(memory, { labelOf, full: true });
  const json = `${JSON.stringify({ schemaVersion: MEMORY_FILE_VERSION, ...memory }, null, 2)}\n`;
  return { json, markdown: `# Memoria de la ejecución\n\n${text ?? '(vacía)'}\n`, memory };
}
