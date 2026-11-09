import type { MemoryProposal, RunEvent } from '@orquestador/core';

/** Una propuesta de memoria con lo que se decidió de ella [R76.10]. */
export interface ProposalView extends MemoryProposal {
  decision?: 'save' | 'discard';
  edited?: boolean;
}

/** «Para recordar» de una ejecución: sus propuestas y cómo quedó cada una [R76.10][R76.11]. */
export function memoryProposalsOf(events: readonly RunEvent[]): ProposalView[] {
  const out: ProposalView[] = [];
  for (const e of events) {
    if (e.type === 'memory.proposed') out.push(...e.proposals.map((p) => ({ ...p })));
    if (e.type === 'memory.decided') {
      const p = out.find((x) => x.id === e.proposalId);
      if (p) Object.assign(p, { decision: e.decision, ...(e.edited ? { edited: true } : {}) });
    }
  }
  return out;
}
