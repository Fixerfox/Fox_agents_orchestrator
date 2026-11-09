import { parallelRegions, type Diagram, type DiagramNode, type ParallelBranch, type ParallelRegion } from '../../diagrams';
import type { SpaceRef } from '../branch-spaces';
import type { Id } from '../../shared';
import type { RunServices } from '../nodes/handler';
import { errorMessage } from '../nodes/handler';
import { pathKey } from '../replay';
import type { NodeStatus } from '../run-types';
import { runMergeAgent } from './merge-agent';

/** Estado de una rama en paralelo de un nivel [R73.2]. */
interface Branch {
  region: ParallelRegion;
  branch: ParallelBranch;
  nodes: Set<Id>;
  parent?: Branch;
  state: 'none' | 'opening' | 'open' | 'shared' | 'merging' | 'merged' | 'discarded';
  space?: SpaceRef;
  opening?: Promise<SpaceRef | undefined>;
}

const TERMINAL = new Set<NodeStatus>(['succeeded', 'failed', 'cancelled', 'skipped']);
const BUSY = new Set<Branch['state']>(['opening', 'open', 'merging']);

/** Respuestas de la pregunta de conflicto [R73.14]. */
export const CONFLICT_AGENT = 'Que lo junte un agente';
export const CONFLICT_STOP = 'Parar la ejecución';
export const keepVersionOf = (label: string) => `Quedarme con la de ${label}`;

/** Clave de vista previa de las dos versiones de un conflicto, en `conflicts/` de la ejecución [R73.16]. */
export const CONFLICT_PREVIEW_KEY = 'orq.conflicts';

/** Los motivos de la ejecución parada por un conflicto. */
export const CONFLICT_HALT = 'Conflicto al juntar las ramas en paralelo sin resolver';

/**
 * Las ramas en paralelo de un nivel, cada una en su espacio [R73.1]–[R73.17]: se abren al arrancar su primer paso, se
 * fusionan en orden de llegada antes de que arranque lo que las junta y, si fallan, se guardan aparte.
 */
export class LevelIsolation {
  private readonly branches: Branch[] = [];

  private constructor(
    private readonly run: RunServices,
    private readonly diagram: Diagram,
    private readonly path: Id[],
    private readonly levelSpace: SpaceRef | undefined,
  ) {
    for (const region of parallelRegions(diagram)) {
      for (const branch of region.branches) this.branches.push({ region, branch, nodes: new Set(branch.nodes), state: 'none' });
    }
    // La rama que contiene el abanico de otra es su madre: se aísla a partir de ella [R73.3].
    for (const b of this.branches) b.parent = this.innermost(b.region.id, b);
  }

  /** Sin espacios (la app no aísla) o sin abanicos, no hace falta [R73.2]. */
  static for(run: RunServices, diagram: Diagram, path: Id[], levelSpace: SpaceRef | undefined): LevelIsolation | undefined {
    if (!run.spaces) return undefined;
    const iso = new LevelIsolation(run, diagram, path, levelSpace);
    return iso.branches.length > 0 ? iso : undefined;
  }

  private innermost(id: Id, not?: Branch): Branch | undefined {
    let best: Branch | undefined;
    for (const b of this.branches) if (b !== not && b.nodes.has(id) && (!best || b.nodes.size < best.nodes.size)) best = b;
    return best;
  }

  private label(id: Id): string {
    return this.run.labels.get(pathKey(this.path, id)) ?? this.diagram.nodes.find((n) => n.id === id)?.label ?? id;
  }

  private node(id: Id): DiagramNode | undefined {
    return this.diagram.nodes.find((n) => n.id === id);
  }

  /** Si la rama tiene algo que puede escribir: un agente que no es de solo lectura, un bucle o un subdiagrama [R73.2]. */
  private async writes(b: Branch): Promise<boolean> {
    for (const id of b.nodes) {
      const n = this.node(id);
      if (!n) continue;
      if (n.kind === 'loop' || n.kind === 'subdiagram') return true;
      if (n.kind === 'agent' && n.agentId && (await Promise.resolve(this.run.canWrite?.(n.agentId) ?? true).catch(() => true))) return true;
    }
    return false;
  }

  private destOf(b: Branch): Promise<SpaceRef | undefined> {
    return b.parent ? this.ensure(b.parent) : Promise.resolve(this.levelSpace);
  }

  private ensure(b: Branch): Promise<SpaceRef | undefined> {
    if (b.state === 'open' || b.state === 'merging') return Promise.resolve(b.space);
    if (b.state === 'opening') return b.opening!;
    if (b.state !== 'none') return this.destOf(b);
    b.state = 'opening';
    b.opening = (async () => {
      const dest = await this.destOf(b);
      if (!(await this.writes(b))) {
        b.state = 'shared';
        return dest;
      }
      try {
        const { space, strategy, warning } = await this.run.spaces!.open({ regionId: b.region.id, label: this.label(b.branch.entry), ...(dest ? { parent: dest } : {}) });
        b.space = space;
        b.state = 'open';
        this.run.emitter.emit({ type: 'workspace.opened', regionId: b.region.id, branchNodeIds: [...b.nodes], strategy, ...(warning ? { warning } : {}) }, this.path);
        return space;
      } catch (err) {
        // Sin espacio, la rama trabaja en la carpeta como antes, y se avisa.
        b.state = 'shared';
        this.run.emitter.emit({ type: 'supervisor.alert', nodeId: b.branch.entry, rule: 'isolation-failed', severity: 'warning', detail: `No se pudo aislar la rama: ${errorMessage(err)}. Trabaja en la carpeta compartida.` }, this.path);
        return dest;
      }
    })();
    return b.opening;
  }

  /** El espacio en el que trabaja un paso: el de su rama más interior o el del nivel [R73.2][R73.3]. */
  async spaceFor(nodeId: Id): Promise<SpaceRef | undefined> {
    const b = this.innermost(nodeId);
    const space = b ? await this.ensure(b) : this.levelSpace;
    if (space) this.run.spaces!.bind?.(space, pathKey(this.path, nodeId));
    return space;
  }

  /** ¿Tiene que esperar `to` a que se fusione la rama de `from`? [R73.11] */
  blocks(from: Id, to: Id): boolean {
    return this.branches.some((b) => b.nodes.has(from) && !b.nodes.has(to) && BUSY.has(b.state));
  }

  /** Lo que junta la rama: los nodos de fuera que reciben de ella. */
  private joinsOf(b: Branch): Id[] {
    return [...new Set(this.diagram.edges.filter((e) => b.nodes.has(e.from) && !b.nodes.has(e.to)).map((e) => e.to))];
  }

  /** Ramas que han terminado y se pueden fusionar o descartar; devuelve sus tareas [R73.11][R73.17]. */
  settle(status: ReadonlyMap<Id, NodeStatus>): { key: string; task: Promise<void> }[] {
    const out: { key: string; task: Promise<void> }[] = [];
    for (const b of this.branches) {
      if (b.state !== 'open') continue;
      if (![...b.nodes].every((id) => TERMINAL.has(status.get(id) ?? 'idle'))) continue;
      // Las ramas de dentro se fusionan antes en esta [R73.3].
      if (this.branches.some((c) => c.parent === b && BUSY.has(c.state))) continue;
      b.state = 'merging';
      const failed = this.run.signal.aborted || [...b.nodes].some((id) => status.get(id) === 'failed' || status.get(id) === 'cancelled');
      out.push({ key: `\u0000merge:${b.region.id}:${b.branch.entry}`, task: failed ? this.discard(b) : this.merge(b, status) });
    }
    return out;
  }

  private async discard(b: Branch): Promise<void> {
    try {
      const files = await this.run.spaces!.discard(b.space!);
      this.run.emitter.emit({ type: 'workspace.discarded', regionId: b.region.id, branchNodeIds: [...b.nodes], files }, this.path);
    } catch {
      await this.run.spaces!.close(b.space!).catch(() => undefined);
    }
    b.state = 'discarded';
  }

  private async merge(b: Branch, status: ReadonlyMap<Id, NodeStatus>): Promise<void> {
    const spaces = this.run.spaces!;
    const into = await this.destOf(b);
    const joins = this.joinsOf(b);
    const at = joins[0] ?? b.branch.nodes.at(-1)!;
    const ids = { regionId: b.region.id, branchNodeIds: [...b.nodes] };
    try {
      const r = await spaces.merge(b.space!, into);
      this.run.emitter.emit({ type: 'workspace.merged', nodeId: at, files: r.merged, ...ids, ...(r.mergedByLines.length > 0 ? { mergedByLines: r.mergedByLines } : {}) }, this.path);
      if (r.conflicts.length > 0) await this.conflict(b, at, joins, into, r.conflicts, r.savedTo, status);
    } catch (err) {
      // Cancelada mientras esperaba (p. ej. la pregunta de conflicto): nada que contar.
      if (this.run.signal.aborted) return;
      this.run.emitter.emit({ type: 'error', nodeId: at, message: `No se pudo juntar la rama «${this.label(b.branch.entry)}»: ${errorMessage(err)}`, retriable: false }, this.path);
      this.run.halt(`No se pudo juntar la rama «${this.label(b.branch.entry)}»`);
    } finally {
      await spaces.close(b.space!).catch(() => undefined);
      b.state = 'merged';
    }
  }

  /** Un conflicto se pregunta a la persona, con las dos versiones guardadas [R73.14]–[R73.16]. */
  private async conflict(b: Branch, at: Id, joins: Id[], into: SpaceRef | undefined, files: string[], savedTo: string | undefined, status: ReadonlyMap<Id, NodeStatus>): Promise<void> {
    const spaces = this.run.spaces!;
    const mine = this.label(b.branch.entry);
    const before = this.branches.filter((o) => o !== b && o.region === b.region && o.state === 'merged').map((o) => this.label(o.branch.entry));
    const theirs = before.length > 0 ? before.join(' y ') : 'la carpeta';
    const ids = { regionId: b.region.id, nodeIds: joins.length > 0 ? joins : [at] };
    let pending = files;
    for (let round = 0; round < 3 && pending.length > 0; round++) {
      this.run.emitter.emit({ type: 'workspace.conflict', nodeIds: ids.nodeIds, files: pending, regionId: b.region.id, branchNodeIds: [...b.nodes], ...(savedTo ? { savedTo } : {}) }, this.path);
      const keepTheirs = keepVersionOf(theirs);
      const keepMine = keepVersionOf(mine);
      const text = `Las ramas en paralelo cambiaron las mismas líneas y no se pueden juntar solas:\n${pending.map((f) => `- ${f}`).join('\n')}${savedTo ? `\n\nLas dos versiones están en ${savedTo}.` : ''}\n\n¿Qué hago?`;
      const conflict = { files: [...pending], branches: [theirs, mine] as [string, string], ...(savedTo ? { savedTo: savedTo.replace(/^conflicts\//, '') } : {}) };
      const answer = (await this.run.questions.ask(at, this.path, { text, options: [keepTheirs, keepMine, CONFLICT_AGENT, CONFLICT_STOP], kind: 'conflict', fallback: CONFLICT_STOP, conflict })).trim();
      if (answer === keepTheirs || answer === keepMine) {
        await spaces.resolve(b.space!, into, answer === keepMine ? 'branch' : 'target');
        this.run.emitter.emit({ type: 'workspace.resolved', ...ids, files: pending, choice: answer === keepMine ? 'branch' : 'target' }, this.path);
        return;
      }
      if (answer === CONFLICT_AGENT) {
        const agentId = this.mergerOf(b, joins, status);
        if (!agentId) {
          this.run.emitter.emit({ type: 'error', nodeId: at, message: 'No hay ningún agente que pueda juntar los archivos', retriable: false }, this.path);
          continue;
        }
        await spaces.resolve(b.space!, into, 'markers');
        await runMergeAgent(this.run, { nodeId: at, agentId, path: this.path, files: pending, branches: [theirs, mine], ...(into ? { space: into } : {}) });
        const left = await spaces.unresolved(b.space!, into);
        if (left.length === 0) {
          this.run.emitter.emit({ type: 'workspace.resolved', ...ids, files: pending, choice: 'agent' }, this.path);
          return;
        }
        pending = left;
        continue;
      }
      break;
    }
    this.run.halt(CONFLICT_HALT);
  }

  /** El agente del nodo que junta o, si no es un agente, el del último paso de la rama [R73.15]. */
  private mergerOf(b: Branch, joins: Id[], status: ReadonlyMap<Id, NodeStatus>): Id | undefined {
    const join = joins.map((id) => this.node(id)).find((n) => n?.kind === 'agent' && n.agentId);
    if (join?.agentId) return join.agentId;
    const done = b.branch.nodes.map((id) => this.node(id)).filter((n) => n?.kind === 'agent' && n.agentId && status.get(n.id) === 'succeeded');
    return done.at(-1)?.agentId;
  }

  /** Al acabar el nivel: lo que quedó abierto (cancelado) se guarda aparte y se borra [R73.17][R73.18]. */
  async finish(): Promise<void> {
    for (const b of this.branches) {
      if (b.state === 'opening') await b.opening?.catch(() => undefined);
      if (b.state === 'open') await this.discard(b);
    }
  }
}
