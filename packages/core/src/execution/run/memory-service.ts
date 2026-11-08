import type { Diagram } from '../../diagrams';
import type { Id } from '../../shared';
import { renderMemory, type MemoryStats } from '../memory/memory-render';
import { selectFor } from '../memory/memory-view';
import { memoryFromEvents } from '../memory/run-memory';
import { pathKey } from '../replay';
import type { RunEmitter } from './run-emitter';

/** La memoria que recibe cada paso, calculada desde los eventos al arrancarlo [R72.2][R72.9]. */
export class RunMemoryService {
  constructor(
    private readonly emitter: RunEmitter,
    private readonly labels: ReadonlyMap<string, string>,
    /** Diagrama de cada nivel, por su ruta [R72.7]. */
    readonly levels: Map<string, Diagram>,
    private readonly tokens: () => number | undefined,
  ) {}

  labelOf = (nodeId: Id, path: readonly Id[]): string => this.labels.get(pathKey(path, nodeId)) ?? nodeId;

  /** Lo que ve el paso ahora: debe llamarse justo después de su `node.started` [R72.9]. */
  forStep(nodeId: Id, path: readonly Id[]): { text: string | undefined; stats: MemoryStats } {
    const history = this.emitter.history();
    const key = pathKey(path, nodeId);
    let startSeq = Number.POSITIVE_INFINITY;
    let pass = 0;
    for (const e of history) {
      if (e.type === 'node.started' && pathKey(e.nodePath, e.nodeId) === key) {
        startSeq = e.seq;
        pass++;
      }
    }
    const memory = selectFor(memoryFromEvents(history), { nodeId, path, startSeq, pass: Math.max(1, pass) }, this.levels);
    const tokens = this.tokens();
    return renderMemory(memory, { labelOf: this.labelOf, ...(tokens !== undefined ? { tokens } : {}) });
  }
}
