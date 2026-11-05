import type { DeliverableItemResult, NodeStatus, RunEvent } from '@orquestador/core';
import { t } from './i18n';

/**
 * Resumen legible de una ejecución a partir de sus eventos: cómo terminó, qué hizo cada paso, revisiones, preguntas
 * y archivos. Lo usan la pestaña «Resumen» y la herramienta `get_run` del asistente [R38.23][R38.24].
 */
export interface RunStepSummary {
  key: string;
  nodeId: string;
  nodePath: string[];
  label: string;
  status: NodeStatus | 'running';
  /** Veces que empezó (vueltas de revisión o bucle, reintentos). */
  runs: number;
  /** Lo último que entregó, recortado. */
  output?: string;
  files: string[];
  error?: string;
  /** Se reutilizó la salida de la ejecución reanudada [R41.5]. */
  reused?: boolean;
}
export interface RunReviewSummary {
  label: string;
  round: number;
  max: number;
  verdict: 'approved' | 'rejected' | 'exhausted';
  reason?: string;
}
export interface RunSummaryView {
  status: 'running' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted';
  reason?: string;
  input?: string;
  startedAt?: string;
  finishedAt?: string;
  durationSec: number;
  usage: { inputTokens: number; outputTokens: number; costUsd: number };
  steps: RunStepSummary[];
  reviews: RunReviewSummary[];
  questions: { label: string; text: string; answer?: string }[];
  files: string[];
  errors: { label: string; message: string }[];
  finalOutput?: string;
  /** Paso donde falló, si falló. */
  failedAt?: string;
  /** Frase que lo cuenta todo de un vistazo. */
  headline: string;
  /** Entregable pedido y, si se compuso, cómo quedó [R46.12]. */
  deliverable?: { done?: { ok: boolean; fileName: string; markdown: string; items: DeliverableItemResult[] } };
}

const SKIP = new Set(['entry', 'output']);
const cut = (s: string, max: number) => (s.length > max ? `${s.slice(0, max).trimEnd()}…` : s);
const key = (path: readonly string[] | undefined, id: string) => [...(path ?? []), id].join('/');

/** `interrupted`: la lista de ejecuciones sabe que se cortó (la app se cerró) aunque no haya `run.finished` [R35.14]. */
export function summarizeRun(events: readonly RunEvent[], labelOf: (nodeId: string, nodePath: readonly string[]) => string = (id) => id, maxText = 600, now = Date.now(), interrupted = false): RunSummaryView {
  const steps = new Map<string, RunStepSummary>();
  const reviews = new Map<string, RunReviewSummary>();
  const questions = new Map<string, { label: string; text: string; answer?: string }>();
  const files: string[] = [];
  const errors: { label: string; message: string }[] = [];
  const usage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
  let status: RunSummaryView['status'] = 'running';
  let reason: string | undefined;
  let input: string | undefined;
  let finalOutput: string | undefined;
  let finishedAt: string | undefined;
  let deliverable: RunSummaryView['deliverable'];
  const startedAt = events[0]?.ts;
  const step = (e: { nodeId: string; nodePath?: string[] }) => {
    const k = key(e.nodePath, e.nodeId);
    let s = steps.get(k);
    if (!s) {
      s = { key: k, nodeId: e.nodeId, nodePath: [...(e.nodePath ?? [])], label: labelOf(e.nodeId, e.nodePath ?? []), status: 'queued', runs: 0, files: [] };
      steps.set(k, s);
    }
    return s;
  };
  for (const e of events) {
    switch (e.type) {
      case 'run.started':
        if (e.deliverable) deliverable = {};
        break;
      case 'deliverable.done':
        deliverable = { done: { ok: e.ok, fileName: e.fileName, markdown: e.markdown, items: e.items } };
        break;
      case 'run.finished':
        status = e.status;
        reason = e.reason;
        finishedAt = e.ts;
        break;
      case 'node.started':
        if (e.nodeId === 'entry' && !e.nodePath?.length) input = e.input?.text;
        if (SKIP.has(e.nodeId)) break;
        step(e).status = 'running';
        step(e).runs++;
        break;
      case 'node.finished':
        if (e.nodeId === 'output' && !e.nodePath?.length && e.output?.text !== undefined) finalOutput = e.output.text;
        if (SKIP.has(e.nodeId)) break;
        step(e).status = e.status;
        if (e.output?.text) step(e).output = cut(e.output.text.trim(), maxText);
        break;
      case 'node.reused':
        step(e).reused = true;
        break;
      case 'file.produced': {
        if (!files.includes(e.path)) files.push(e.path);
        const s = step(e);
        if (!s.files.includes(e.path)) s.files.push(e.path);
        break;
      }
      case 'error':
        if (e.nodeId) step(e as { nodeId: string; nodePath?: string[] }).error = e.message;
        errors.push({ label: e.nodeId ? labelOf(e.nodeId, e.nodePath ?? []) : '', message: e.message });
        break;
      case 'review.decided':
        reviews.set(key(e.nodePath, e.nodeId), { label: labelOf(e.nodeId, e.nodePath ?? []), round: e.round, max: e.max, verdict: e.verdict, ...(e.reason ? { reason: e.reason } : {}) });
        break;
      case 'agent.question':
        questions.set(e.questionId, { label: labelOf(e.nodeId, e.nodePath ?? []), text: e.text });
        break;
      case 'agent.answer': {
        const q = questions.get(e.questionId);
        if (q) q.answer = e.text;
        break;
      }
      case 'agent.usage':
        usage.inputTokens += e.inputTokens;
        usage.outputTokens += e.outputTokens;
        usage.costUsd += e.costUsd ?? 0;
        break;
      default:
        break;
    }
  }
  if (interrupted && status === 'running') status = 'interrupted';
  const list = [...steps.values()];
  const failed = list.find((s) => s.status === 'failed');
  const end = finishedAt ?? (status === 'running' ? new Date(now).toISOString() : events.at(-1)?.ts);
  const durationSec = startedAt && end ? Math.max(0, (Date.parse(end) - Date.parse(startedAt)) / 1000) : 0;
  const done = list.filter((s) => s.status === 'succeeded' && !s.reused).length;
  const reusedCount = list.filter((s) => s.reused).length;
  const rounds = [...reviews.values()].reduce((n, r) => n + Math.max(0, r.round - (r.verdict === 'approved' ? 1 : 0)), 0);
  const parts = [
    done === 1 ? t('rsum.steps.one') : t('rsum.steps.many', { count: done }),
    rounds > 0 ? (rounds === 1 ? t('rsum.rounds.one') : t('rsum.rounds.many', { count: rounds })) : '',
    files.length > 0 ? (files.length === 1 ? t('rsum.files.one') : t('rsum.files.many', { count: files.length })) : '',
    reusedCount > 0 ? t('rsum.reused.many', { count: reusedCount }) : '',
  ].filter(Boolean);
  const headline =
    status === 'interrupted'
      ? t('rsum.head.interrupted', { what: parts.join(', ') })
      : status === 'running'
      ? t('rsum.head.running', { what: parts.join(', ') })
      : status === 'succeeded'
        ? t('rsum.head.ok', { what: parts.join(', ') })
        : status === 'cancelled'
          ? t('rsum.head.cancelled', { what: parts.join(', ') })
          : failed
            ? t('rsum.head.failedAt', { step: failed.label, reason: failed.error ?? reason ?? t('rsum.noReason') })
            : t('rsum.head.failed', { reason: reason ?? t('rsum.noReason') });
  return {
    status,
    ...(reason !== undefined ? { reason } : {}),
    ...(input !== undefined ? { input: cut(input, maxText) } : {}),
    ...(startedAt ? { startedAt } : {}),
    ...(finishedAt ? { finishedAt } : {}),
    durationSec,
    usage,
    steps: list,
    reviews: [...reviews.values()],
    questions: [...questions.values()],
    files,
    errors,
    ...(finalOutput !== undefined ? { finalOutput: cut(finalOutput, maxText * 10) } : {}),
    ...(failed ? { failedAt: failed.label } : {}),
    headline,
    ...(deliverable ? { deliverable } : {}),
  };
}
