import { MEMORY_TEXT_MAX, MEMORY_TITLE_MAX, normalMemoryText, type MemoryEntry, type MemoryKind, type MemoryOrigin, type MemoryScope } from '../knowledge';
import { clipMiddle, redactString, type Id } from '../shared';
import type { RunEvent } from './events';
import { CONFIRM_APPROVE } from './text/confirm';
import { UNFINISHED_OPTIONS } from './text/unfinished';

/** Algo que dijo la persona y que puede valer para las siguientes ejecuciones [R76.5]. */
export interface MemorySignal {
  origin: Exclude<MemoryOrigin, 'manual' | 'assistant'>;
  text: string;
  nodeId?: Id;
  agentId?: Id;
  /** La pregunta, si la señal es una respuesta. */
  question?: string;
  /** Regla del aviso marcado como falso [R75.21]. */
  rule?: string;
}

/** Una propuesta para la memoria del proyecto: añadir, actualizar o archivar [R76.6]. */
export interface MemoryProposal {
  id: string;
  action: 'add' | 'update' | 'archive';
  /** En `update` y `archive`, la entrada que cambia. */
  entryId?: Id;
  kind: MemoryKind;
  scope: MemoryScope;
  title: string;
  text: string;
  reason?: string;
  /** De qué señal sale [R76.10]. */
  origin: MemorySignal['origin'];
}

/** Ejecuciones anteriores en las que se busca una pregunta repetida, y en las que no se repite un descarte [R76.5][R76.11]. */
export const MEMORY_LOOKBACK_RUNS = 20;
export const MAX_PROPOSALS = 5;

const answered = (events: readonly RunEvent[]) => {
  const q = new Map<string, Extract<RunEvent, { type: 'agent.question' }>>();
  const out: { q: Extract<RunEvent, { type: 'agent.question' }>; answer: Extract<RunEvent, { type: 'agent.answer' }> }[] = [];
  for (const e of events) {
    if (e.type === 'agent.question') q.set(e.questionId, e);
    if (e.type === 'agent.answer' && q.has(e.questionId) && !e.auto && !e.reused) out.push({ q: q.get(e.questionId)!, answer: e });
  }
  return out;
};

/**
 * Las señales de una ejecución [R76.5]: solo lo que dijo la persona. Correcciones, revisiones humanas con cambios,
 * «Repetir el paso» con texto, confirmaciones con cambios, avisos marcados como falsos y preguntas que ya se
 * respondieron en alguna de las ejecuciones anteriores.
 */
export function memorySignals(events: readonly RunEvent[], past: readonly (readonly RunEvent[])[] = []): MemorySignal[] {
  const agentOf = new Map<string, Id>();
  for (const e of events) if (e.type === 'agent.request' && e.kind === undefined) agentOf.set(`${(e.nodePath ?? []).join('/')}|${e.nodeId}`, e.agentId);
  const who = (e: RunEvent & { nodeId?: Id }) => (e.nodeId === undefined ? {} : { nodeId: e.nodeId, ...(agentOf.get(`${(e.nodePath ?? []).join('/')}|${e.nodeId}`) ? { agentId: agentOf.get(`${(e.nodePath ?? []).join('/')}|${e.nodeId}`)! } : {}) });
  const out: MemorySignal[] = [];
  const said = (text: string) => redactString(clipMiddle(text.trim(), 1000));
  for (const e of events) {
    if (e.type === 'correction.applied' && e.text.trim()) out.push({ origin: 'correction', text: said(e.text), ...who(e) });
    if (e.type === 'confirm.decided' && e.verdict === 'changes' && e.text?.trim()) out.push({ origin: 'confirm', text: said(e.text), ...who(e) });
    if (e.type === 'supervisor.feedback' && e.verdict === 'false-alarm') {
      const alert = events.find((a): a is Extract<RunEvent, { type: 'supervisor.alert' }> => a.type === 'supervisor.alert' && a.seq === e.alertSeq);
      if (alert) out.push({ origin: 'alert-feedback', text: said(`${alert.detail}${e.note ? ` — ${e.note}` : ''}`), rule: alert.rule, ...who(alert) });
    }
  }
  const earlier = new Set(past.flatMap((run) => answered(run).map((x) => normalMemoryText(x.q.text))));
  for (const { q, answer } of answered(events)) {
    const text = answer.text.trim();
    if (q.review && q.review.phase === 'feedback' && text && text !== CONFIRM_APPROVE) out.push({ origin: 'review', text: said(text), question: said(q.text), ...who(q) });
    else if (q.kind === 'unfinished' && text && !UNFINISHED_OPTIONS.includes(text)) out.push({ origin: 'retry', text: said(text), ...who(q) });
    else if ((q.kind === 'question' || q.kind === undefined) && !q.confirm && !q.review && text && earlier.has(normalMemoryText(q.text))) out.push({ origin: 'repeated-question', text: said(text), question: said(q.text), ...who(q) });
  }
  return out;
}

const KIND_OF: Record<MemorySignal['origin'], MemoryKind> = { correction: 'convention', review: 'convention', retry: 'lesson', confirm: 'preference', 'repeated-question': 'preference', 'alert-feedback': 'false-alarm' };
const firstLine = (s: string, n: number) => {
  const line = s.replace(/\s+/g, ' ').trim();
  return line.length > n ? `${line.slice(0, n - 1).trimEnd()}…` : line;
};

/** Propuestas por regla fija, para el motor simulado y las pruebas [R76.9]. */
export function ruleProposals(signals: readonly MemorySignal[]): MemoryProposal[] {
  return signals.slice(0, MAX_PROPOSALS).map((s, i) => ({
    id: `p${i + 1}`,
    action: 'add',
    kind: KIND_OF[s.origin],
    scope: s.origin === 'alert-feedback' && s.agentId ? `agent:${s.agentId}` : 'project',
    title: firstLine(s.question ?? s.text, MEMORY_TITLE_MAX),
    text: firstLine(s.question ? `${s.question} → ${s.text}` : s.text, MEMORY_TEXT_MAX),
    origin: s.origin,
  }));
}

/** Quita lo que la persona ya descartó con el mismo texto en las ejecuciones recientes [R76.11]. */
export function withoutDiscarded(proposals: readonly MemoryProposal[], recent: readonly (readonly RunEvent[])[]): MemoryProposal[] {
  const gone = new Set<string>();
  for (const run of recent) {
    const offered = new Map<string, MemoryProposal>();
    for (const e of run) {
      if (e.type === 'memory.proposed') for (const p of e.proposals) offered.set(p.id, p);
      if (e.type === 'memory.decided' && e.decision === 'discard') {
        const p = offered.get(e.proposalId);
        if (p) gone.add(normalMemoryText(p.text));
      }
    }
  }
  return proposals.filter((p) => !gone.has(normalMemoryText(p.text)));
}

/**
 * Lo que hace guardar una propuesta en la memoria [R76.11]: añadir, actualizar o archivar, con su historial. `edited`
 * es «Editar y guardar». No valida: eso lo hace quien guarda.
 */
export function applyProposal(entries: readonly MemoryEntry[], p: MemoryProposal, o: { at: string; by: 'user' | 'assistant'; runId?: Id; edited?: { title?: string; text?: string }; newId: () => Id }): MemoryEntry[] {
  const title = (o.edited?.title ?? p.title).trim();
  const text = (o.edited?.text ?? p.text).trim();
  const source = { ...(o.runId ? { runId: o.runId } : {}), origin: o.by === 'assistant' ? ('assistant' as const) : p.origin };
  if (p.action === 'add' || !p.entryId || !entries.some((e) => e.id === p.entryId)) {
    return [...entries, { id: o.newId(), kind: p.kind, scope: p.scope, title, text, status: 'active', source, createdAt: o.at, updatedAt: o.at, uses: 0, history: [{ at: o.at, action: 'created', by: o.by, ...(o.runId ? { runId: o.runId } : {}) }] }];
  }
  return entries.map((e) => {
    if (e.id !== p.entryId) return e;
    const step = { at: o.at, by: o.by, ...(o.runId ? { runId: o.runId } : {}), before: e.text };
    return p.action === 'archive' ? { ...e, status: 'archived', updatedAt: o.at, history: [...e.history, { ...step, action: 'archived' }] } : { ...e, title, text, kind: p.kind, updatedAt: o.at, history: [...e.history, { ...step, action: 'updated' }] };
  });
}

/** Al terminar la ejecución, las entradas que recibieron sus pasos suman un uso [R76.16]. */
export function markUsed(entries: readonly MemoryEntry[], events: readonly RunEvent[], at: string): MemoryEntry[] {
  const used = new Map<Id, number>();
  for (const e of events) if (e.type === 'agent.request') for (const id of e.projectMemory ?? []) used.set(id, (used.get(id) ?? 0) + 1);
  if (used.size === 0) return [...entries];
  return entries.map((e) => (used.has(e.id) ? { ...e, uses: e.uses + used.get(e.id)!, lastUsedAt: at } : e));
}
