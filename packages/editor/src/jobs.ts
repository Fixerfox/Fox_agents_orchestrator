import type { JobInfo, QueuedRunView, RunSummary } from './api';
import { t } from './i18n';

/** Una tarjeta de la pantalla Trabajos [R52.4][R52.6]. */
export interface JobRow extends JobInfo {
  /** Sin problemas: se puede lanzar. */
  runnable: boolean;
  total: number;
  running: number;
  /** En marcha y esperando una respuesta del usuario. */
  waiting: number;
  queued: number;
  last?: { status: RunSummary['status']; at: string; agoS: number };
}

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const time = (iso: string | undefined) => (iso ? Date.parse(iso) || 0 : 0);

/**
 * Junta los diagramas con su historial, su cola y las preguntas pendientes [R52.4]. Orden: primero lo que tiene
 * algo en marcha o en cola, luego por la última ejecución más reciente y luego por nombre.
 */
export function jobRows(jobs: readonly JobInfo[], runs: readonly RunSummary[], queue: readonly QueuedRunView[], waitingRunIds: ReadonlySet<string>, now: number): JobRow[] {
  const rows = jobs.map((j): JobRow => {
    const mine = runs.filter((r) => r.diagramId === j.id);
    const running = mine.filter((r) => r.status === 'running');
    const latest = [...mine].sort((a, b) => time(b.startedAt) - time(a.startedAt))[0];
    const at = latest ? (latest.finishedAt ?? latest.startedAt) : undefined;
    return {
      ...j,
      runnable: j.problems === 0,
      total: mine.length,
      running: running.length,
      waiting: running.filter((r) => waitingRunIds.has(r.runId)).length,
      queued: queue.filter((q) => q.diagramId === j.id).length,
      ...(latest && at ? { last: { status: latest.status, at, agoS: Math.max(0, Math.round((now - time(at)) / 1000)) } } : {}),
    };
  });
  const busy = (r: JobRow) => (r.running + r.queued > 0 ? 1 : 0);
  return rows.sort((a, b) => busy(b) - busy(a) || time(b.last?.at) - time(a.last?.at) || a.name.localeCompare(b.name, 'es'));
}

/** Busca por nombre sin distinguir mayúsculas ni acentos [R52.4]. */
export function filterJobs(rows: readonly JobRow[], text: string): JobRow[] {
  const q = fold(text.trim());
  return q === '' ? [...rows] : rows.filter((r) => fold(r.name).includes(q));
}

/** «hace un momento», «hace 5 min», «hace 2 h», «hace 3 días» [R52.6]. */
export function agoText(seconds: number): string {
  if (seconds < 60) return t('jobs.ago.now');
  if (seconds < 3600) return t('jobs.ago.min', { n: Math.floor(seconds / 60) });
  if (seconds < 86400) return t('jobs.ago.h', { n: Math.floor(seconds / 3600) });
  const days = Math.floor(seconds / 86400);
  return days === 1 ? t('jobs.ago.day') : t('jobs.ago.days', { n: days });
}

/** Banda de estado de Trabajos [R52.6]. */
export interface JobsBanner {
  /** En marcha sin nada que preguntar. */
  running: number;
  /** En marcha esperando una respuesta, un permiso o una confirmación. */
  needs: number;
  queued: number;
  /** Terminadas en las últimas 24 h (bien, con fallo, canceladas o interrumpidas). */
  finished: number;
  /** De esas, las que fallaron o se interrumpieron. */
  failed: number;
}

const DAY_MS = 86_400_000;

/** Cuenta lo que hay en marcha, lo que te necesita, la cola y lo terminado en las últimas 24 h [R52.6]. */
export function jobsBanner(runs: readonly RunSummary[], waitingRunIds: ReadonlySet<string>, queue: readonly QueuedRunView[], now: number): JobsBanner {
  const out: JobsBanner = { running: 0, needs: 0, queued: queue.length, finished: 0, failed: 0 };
  for (const r of runs) {
    if (r.status === 'running') {
      if (waitingRunIds.has(r.runId)) out.needs++;
      else out.running++;
      continue;
    }
    const end = time(r.finishedAt ?? r.startedAt);
    if (now - end > DAY_MS) continue;
    out.finished++;
    if (r.status === 'failed' || r.status === 'interrupted') out.failed++;
  }
  return out;
}
