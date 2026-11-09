import {
  MAX_PROPOSALS,
  MEMORY_LOOKBACK_RUNS,
  MEMORY_MAX_ACTIVE,
  applyProposal,
  markUsed,
  memoryEntryProblems,
  memorySignals,
  withoutDiscarded,
  type MemoryEntry,
  type MemoryProposal,
  type Orchestrator,
  type RunEvent,
  type RunRepository,
} from '@orquestador/core';
import { RunError } from './errors';

/** Dónde se lee y guarda la memoria del proyecto [R76.2]. */
export interface ProjectMemoryPort {
  load(): Promise<MemoryEntry[]>;
  save(entries: readonly MemoryEntry[]): Promise<void>;
}

const newId = () => `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * La memoria del proyecto: propuestas al terminar cada ejecución, lo que decide la persona y su mantenimiento
 * [R76.5]–[R76.12][R76.16]. Nada entra sin un «Guardar».
 */
export class RunMemory {
  constructor(
    private readonly runs: RunRepository,
    private readonly orchestrator: Orchestrator,
    private readonly memory: ProjectMemoryPort,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private async recent(except: string): Promise<RunEvent[][]> {
    const metas = (await this.runs.list({ live: new Set() }).catch(() => [])).filter((m) => m.runId !== except).sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, MEMORY_LOOKBACK_RUNS);
    return Promise.all(metas.map((m) => this.runs.readEvents(m.runId).catch(() => [] as RunEvent[])));
  }

  /**
   * Al terminar una ejecución (también fallida o cancelada): suma los usos de lo que recibieron sus pasos [R76.16] y,
   * si la persona dijo algo que valga, propone qué recordar [R76.5]–[R76.9]. Devuelve las propuestas.
   */
  async afterRun(runId: string, signal: AbortSignal = new AbortController().signal): Promise<MemoryProposal[]> {
    const events = await this.runs.readEvents(runId);
    const entries = await this.memory.load();
    const used = markUsed(entries, events, this.now().toISOString());
    if (used.some((e, i) => e !== entries[i])) await this.memory.save(used).catch(() => undefined);
    const past = await this.recent(runId);
    const signals = memorySignals(events, past);
    // Sin señales no se consulta al modelo [R76.9].
    if (signals.length === 0) return [];
    const diagramId = events.find((e): e is Extract<RunEvent, { type: 'run.started' }> => e.type === 'run.started')?.diagramId;
    const scopes = new Set(['project', ...(diagramId ? [`diagram:${diagramId}`] : []), ...signals.flatMap((s) => (s.agentId ? [`agent:${s.agentId}`] : []))]);
    const existing = used.filter((e) => e.status === 'active' && scopes.has(e.scope)).map((e) => ({ id: e.id, kind: e.kind, scope: e.scope, title: e.title, text: e.text }));
    const { proposals, usage } = await this.orchestrator.proposeMemory({ signals, entries: existing }, signal);
    const valid = withoutDiscarded(proposals, past).filter((p) => p.action === 'archive' || memoryEntryProblems(p).length === 0).slice(0, MAX_PROPOSALS);
    if (valid.length === 0) return [];
    // Después de `run.finished`, en su registro, como `run.accepted` [R76.8].
    await this.runs.appendEvent?.(runId, { type: 'memory.proposed', proposals: valid, ...(usage ? { usage } : {}) });
    return valid;
  }

  /** «Guardar», «Editar y guardar» o «Descartar» una propuesta [R76.10][R76.11]. */
  async decide(runId: string, req: { proposalId: string; decision: 'save' | 'discard'; edited?: { title?: string; text?: string }; by?: 'user' | 'assistant' }): Promise<MemoryEntry[]> {
    const events = await this.runs.readEvents(runId);
    const proposal = events.flatMap((e) => (e.type === 'memory.proposed' ? e.proposals : [])).find((p) => p.id === req.proposalId);
    if (!proposal) throw new RunError('not-found', 'Esa propuesta no existe');
    if (events.some((e) => e.type === 'memory.decided' && e.proposalId === req.proposalId)) throw new RunError('bad-request', 'Esa propuesta ya se decidió');
    const by = req.by ?? 'user';
    let entries = await this.memory.load();
    let entryId: string | undefined;
    if (req.decision === 'save') {
      const id = newId();
      const next = applyProposal(entries, proposal, { at: this.now().toISOString(), by, runId, ...(req.edited ? { edited: req.edited } : {}), newId: () => id });
      const changed = next.find((e) => e.id === id) ?? next.find((e) => e.id === proposal.entryId);
      if (changed && changed.status === 'active') {
        const bad = memoryEntryProblems(changed)[0];
        if (bad) throw new RunError('bad-request', bad);
      }
      if (next.filter((e) => e.status === 'active').length > MEMORY_MAX_ACTIVE) throw new RunError('bad-request', `La memoria ya tiene ${MEMORY_MAX_ACTIVE} entradas activas: archiva alguna antes`);
      await this.memory.save(next);
      entries = next;
      entryId = changed?.id;
    }
    await this.runs.appendEvent?.(runId, { type: 'memory.decided', proposalId: req.proposalId, decision: req.decision, ...(entryId ? { entryId } : {}), ...(req.edited ? { edited: true } : {}), by });
    return entries;
  }

  list(): Promise<MemoryEntry[]> {
    return this.memory.load();
  }

  /**
   * Editar, archivar o restaurar desde la pantalla de memoria, o añadir a mano [R76.21]; el asistente también, con
   * permiso, y queda como suyo [R76.12].
   */
  async upsert(entry: Pick<MemoryEntry, 'kind' | 'scope' | 'title' | 'text'> & { id?: string; status?: MemoryEntry['status'] }, by: 'user' | 'assistant' = 'user'): Promise<MemoryEntry[]> {
    const at = this.now().toISOString();
    const entries = await this.memory.load();
    const old = entry.id ? entries.find((e) => e.id === entry.id) : undefined;
    const status = entry.status ?? old?.status ?? 'active';
    const next: MemoryEntry = old
      ? { ...old, kind: entry.kind, scope: entry.scope, title: entry.title.trim(), text: entry.text.trim(), status, updatedAt: at, history: [...old.history, { at, by, action: status !== old.status ? (status === 'archived' ? 'archived' : 'restored') : 'updated', before: old.text }] }
      : { id: newId(), kind: entry.kind, scope: entry.scope, title: entry.title.trim(), text: entry.text.trim(), status, source: { origin: by === 'assistant' ? 'assistant' : 'manual' }, createdAt: at, updatedAt: at, uses: 0, history: [{ at, by, action: 'created' }] };
    if (next.status === 'active') {
      const bad = memoryEntryProblems(next)[0];
      if (bad) throw new RunError('bad-request', bad);
    }
    const all = old ? entries.map((e) => (e.id === old.id ? next : e)) : [...entries, next];
    if (all.filter((e) => e.status === 'active').length > MEMORY_MAX_ACTIVE) throw new RunError('bad-request', `La memoria ya tiene ${MEMORY_MAX_ACTIVE} entradas activas: archiva alguna antes`);
    await this.memory.save(all);
    return all;
  }
}
