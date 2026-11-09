import { applyProposal, memorySignals, ruleProposals, type MemoryEntry, type RunEvent } from '@orquestador/core';
import { fail, ok } from '@orquestador/editor';
import type { MemoryApi, MemoryState } from './types';

/** La memoria del proyecto en memoria, como `RunService` [R76.5][R76.10][R76.21]. */
export function memoryProjectMemory(s: MemoryState, notify: (runId: string, events: RunEvent[]) => void): Pick<MemoryApi, 'decideMemory' | 'projectMemory' | 'saveMemoryEntry'> & { proposeFor(runId: string): void } {
  const entries: MemoryEntry[] = [];
  let seq = 0;
  const id = () => `m${++seq}`;
  const at = () => new Date().toISOString();
  const append = (runId: string, body: Record<string, unknown>) => {
    const run = s.runs.get(runId);
    if (!run) return;
    const event = { runId, seq: run.events.reduce((m, e) => Math.max(m, e.seq), 0) + 1, ts: at(), ...body } as RunEvent;
    run.events.push(event);
    notify(runId, [event]);
  };
  return {
    // Con la regla fija del motor simulado [R76.9].
    proposeFor(runId) {
      const run = s.runs.get(runId);
      if (!run) return;
      const past = [...s.runs.values()].filter((r) => r !== run).map((r) => r.events);
      const proposals = ruleProposals(memorySignals(run.events, past));
      if (proposals.length > 0) append(runId, { type: 'memory.proposed', proposals });
    },
    async decideMemory({ runId, proposalId, decision, edited }) {
      const run = s.runs.get(runId);
      if (!run) return fail('not-found', 'No existe esa ejecución');
      const p = run.events.flatMap((e) => (e.type === 'memory.proposed' ? e.proposals : [])).find((x) => x.id === proposalId);
      if (!p) return fail('not-found', 'Esa propuesta no existe');
      if (run.events.some((e) => e.type === 'memory.decided' && e.proposalId === proposalId)) return fail('bad-request', 'Esa propuesta ya se decidió');
      let entryId: string | undefined;
      if (decision === 'save') {
        const newId = id();
        const next = applyProposal(entries, p, { at: at(), by: 'user', runId, ...(edited ? { edited } : {}), newId: () => newId });
        entries.splice(0, entries.length, ...next);
        entryId = next.some((e) => e.id === newId) ? newId : p.entryId;
      }
      append(runId, { type: 'memory.decided', proposalId, decision, ...(entryId ? { entryId } : {}), ...(edited ? { edited: true } : {}), by: 'user' });
      return ok([...entries]);
    },
    async projectMemory() {
      return ok([...entries]);
    },
    async saveMemoryEntry(e) {
      const now = at();
      const i = e.id ? entries.findIndex((x) => x.id === e.id) : -1;
      if (i >= 0) {
        const old = entries[i]!;
        const status = e.status ?? old.status;
        entries[i] = { ...old, kind: e.kind, scope: e.scope, title: e.title, text: e.text, status, updatedAt: now, history: [...old.history, { at: now, by: 'user', action: status !== old.status ? (status === 'archived' ? 'archived' : 'restored') : 'updated', before: old.text }] };
      } else entries.push({ id: id(), kind: e.kind, scope: e.scope, title: e.title, text: e.text, status: e.status ?? 'active', source: { origin: 'manual' }, createdAt: now, updatedAt: now, uses: 0, history: [{ at: now, by: 'user', action: 'created' }] });
      return ok([...entries]);
    },
  };
}
