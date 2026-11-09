import { type Diagram, type Id, type KnowledgeExtra, type DeliverableSpec, type ReviewPort, type StepCheck } from '@orquestador/core';
import { setDiagramChecks } from './ops-step';
import { EditorError, type EditorErrorCode } from './errors';
import { History } from './history';
import { t } from './i18n';
import {
  addNode,
  connect,
  disconnect,
  duplicateNode,
  getLevel,
  moveNode,
  moveNodes,
  removeNode,
  setCondition,
  updateNode,
  validPath,
  type NewNodeSpec,
  type NodePatch,
  type Position,
  insertOnEdge,
  insertParallel,
  renameDiagram,
  setDiagramExtra,
  setDeliverable,
  type ParallelSpec,
} from './ops';
import { computeProblems, type ProblemsView } from './problems';

export interface Crumb {
  /** Ruta de bucles que representa esta miga. */
  path: Id[];
  label: string;
}

export interface EditorSnapshot {
  version: number;
  diagram: Diagram;
  /** Diagrama del nivel que se está editando (la raíz o el cuerpo de un bucle). */
  level: Diagram;
  path: Id[];
  crumbs: Crumb[];
  canUndo: boolean;
  canRedo: boolean;
  dirty: boolean;
  problems: ProblemsView;
  /** Hay una ejecución en curso: el diagrama no se puede cambiar [R32.37]. */
  readOnly: boolean;
}

export type ConnectResult = { ok: true; edgeId: Id } | { ok: false; code: EditorErrorCode; message: string };

/** Sesión de edición: historial + navegación por bucles + validación. Compatible con `useSyncExternalStore`. */
export class EditorSession {
  private readonly history: History<Diagram>;
  private path: Id[] = [];
  private version = 0;
  private cached: EditorSnapshot | undefined;
  private readonly listeners = new Set<() => void>();
  private locked = false;

  constructor(diagram: Diagram) {
    this.history = new History(diagram);
  }

  // --- observación -------------------------------------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): EditorSnapshot => {
    if (this.cached?.version === this.version) return this.cached;
    const diagram = this.history.present;
    const crumbs: Crumb[] = [{ path: [], label: diagram.name }];
    let level = diagram;
    this.path.forEach((id, i) => {
      const node = level.nodes.find((n) => n.id === id);
      crumbs.push({ path: this.path.slice(0, i + 1), label: node?.label ?? id });
      level = getLevel(level, [id]);
    });
    this.cached = {
      version: this.version,
      diagram,
      level: getLevel(diagram, this.path),
      path: [...this.path],
      crumbs,
      canUndo: !this.locked && this.history.canUndo,
      canRedo: !this.locked && this.history.canRedo,
      dirty: this.history.dirty,
      problems: computeProblems(diagram, this.path, { sharedFans: this.shared }),
      readOnly: this.locked,
    };
    return this.cached;
  };

  private changed(): void {
    this.path = validPath(this.history.present, this.path);
    this.version++;
    for (const l of [...this.listeners]) l();
  }

  private shared = false;

  /** Con el aislamiento apagado, los abanicos avisan de que sus ramas comparten carpeta [R73.21]. */
  setSharedFans(on: boolean): void {
    if (this.shared === on) return;
    this.shared = on;
    this.version++;
    for (const l of [...this.listeners]) l();
  }

  /** Bloquea o libera la edición mientras se ejecuta el diagrama [R32.37]. */
  setReadOnly(on: boolean): void {
    if (this.locked === on) return;
    this.locked = on;
    this.version++;
    for (const l of [...this.listeners]) l();
  }

  private commit(next: Diagram): void {
    if (this.locked) throw new EditorError('locked', t('error.locked'));
    this.history.push(next);
    this.changed();
  }

  // --- edición (todas las acciones pasan por el historial) ---------------------------------

  get diagram(): Diagram {
    return this.history.present;
  }

  addNode(spec: NewNodeSpec): Id {
    const { diagram, id } = addNode(this.history.present, this.path, spec);
    this.commit(diagram);
    return id;
  }

  /** Inserta un nodo en una conexión; un solo paso de deshacer [R32.8]. */
  insertOnEdge(edgeId: Id, spec: Parameters<typeof insertOnEdge>[3]): Id {
    const { diagram, id } = insertOnEdge(this.history.present, this.path, edgeId, spec);
    this.commit(diagram);
    return id;
  }

  /** Inserta ramas en paralelo en una conexión, en un solo paso de historial [R32.36]. */
  insertParallel(edgeId: Id, spec: ParallelSpec): { ids: Id[]; joinId?: Id } {
    const { diagram, ...rest } = insertParallel(this.history.present, this.path, edgeId, spec);
    this.commit(diagram);
    return rest;
  }

  /** Conocimiento para todos los agentes del diagrama (un paso de deshacer) [R33.1]. */
  setDiagramExtra(extra: KnowledgeExtra | undefined): void {
    this.commit(setDiagramExtra(this.history.present, extra));
  }

  /** Comprobaciones de la ejecución (un paso de deshacer) [R75.24]. */
  setDiagramChecks(checks: StepCheck[]): void {
    const next = setDiagramChecks(this.history.present, checks);
    if (next !== this.history.present) this.commit(next);
  }

  /** Entregable de la ejecución (un paso de deshacer) [R46.12]. */
  setDeliverable(spec: DeliverableSpec | undefined): void {
    this.commit(setDeliverable(this.history.present, spec));
  }

  /** Renombra el diagrama (un paso de deshacer) [R32.38]. */
  rename(name: string): void {
    const next = renameDiagram(this.history.present, name);
    if (next !== this.history.present) this.commit(next);
  }

  duplicateNode(id: Id): Id {
    const { diagram, id: newId } = duplicateNode(this.history.present, this.path, id);
    this.commit(diagram);
    return newId;
  }

  /** Un arrastre completo es un solo paso del historial (se llama al soltar). */
  moveNode(id: Id, position: Position): void {
    this.commit(moveNode(this.history.present, this.path, id, position));
  }

  moveNodes(moves: { id: Id; position: Position }[]): void {
    this.commit(moveNodes(this.history.present, this.path, moves));
  }

  updateNode(id: Id, patch: NodePatch): void {
    this.commit(updateNode(this.history.present, this.path, id, patch));
  }

  connect(from: Id, to: Id, port?: ReviewPort): Id {
    const { diagram, edgeId } = connect(this.history.present, this.path, from, to, port);
    this.commit(diagram);
    return edgeId;
  }

  tryConnect(from: Id, to: Id, port?: ReviewPort): ConnectResult {
    try {
      return { ok: true, edgeId: this.connect(from, to, port) };
    } catch (err) {
      if (err instanceof EditorError) return { ok: false, code: err.code, message: err.message };
      throw err;
    }
  }

  setCondition(edgeId: Id, text: string | undefined): void {
    this.commit(setCondition(this.history.present, this.path, edgeId, text));
  }

  /** Borra la selección en un solo paso. La entrada y la salida se ignoran y se devuelven en `skipped`. */
  removeSelection(sel: { nodes?: Id[]; edges?: Id[] }): { removedNodes: Id[]; removedEdges: Id[]; skipped: Id[] } {
    let d = this.history.present;
    const level = getLevel(d, this.path);
    const removedNodes: Id[] = [];
    const removedEdges: Id[] = [];
    const skipped: Id[] = [];
    for (const id of sel.nodes ?? []) {
      const node = level.nodes.find((n) => n.id === id);
      if (!node) continue;
      if (node.kind === 'entry' || node.kind === 'output') {
        skipped.push(id);
        continue;
      }
      d = removeNode(d, this.path, id);
      removedNodes.push(id);
    }
    for (const id of sel.edges ?? []) {
      if (!getLevel(d, this.path).edges.some((e) => e.id === id)) continue;
      d = disconnect(d, this.path, id);
      removedEdges.push(id);
    }
    if (removedNodes.length > 0 || removedEdges.length > 0) this.commit(d);
    return { removedNodes, removedEdges, skipped };
  }

  // --- navegación ---------------------------------------------------------------------------

  enter(loopId: Id): void {
    const level = getLevel(this.history.present, this.path);
    const node = level.nodes.find((n) => n.id === loopId);
    if (!node) throw new EditorError('unknown-node', t('error.unknown-node'));
    if (node.kind !== 'loop' || !node.loop) throw new EditorError('not-a-loop', t('error.not-a-loop'));
    this.path = [...this.path, loopId];
    this.changed();
  }

  up(): void {
    if (this.path.length === 0) return;
    this.path = this.path.slice(0, -1);
    this.changed();
  }

  goTo(path: readonly Id[]): void {
    this.path = validPath(this.history.present, path);
    this.changed();
  }

  // --- historial y guardado ------------------------------------------------------------------

  undo(): boolean {
    if (this.locked) return false;
    const ok = this.history.undo();
    if (ok) this.changed();
    return ok;
  }

  redo(): boolean {
    if (this.locked) return false;
    const ok = this.history.redo();
    if (ok) this.changed();
    return ok;
  }

  markSaved(): void {
    this.history.markSaved();
    this.changed();
  }

  /** Carga otro diagrama (abrir / nuevo): vacía el historial y deja el estado como guardado. */
  load(diagram: Diagram): void {
    if (this.locked) throw new EditorError('locked', t('error.locked'));
    this.history.reset(diagram);
    this.path = [];
    this.changed();
  }
}
