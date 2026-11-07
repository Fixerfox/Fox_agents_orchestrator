import { t } from './i18n';
import { describeSplitProblem, pathKey, type Id, type RunEvent } from '@orquestador/core';
import type { RunSummary } from './api';
import type { LiveNodeStatus } from './live';

// --- Historial (R35.1, R35.2) -------------------------------------------------------------------

export type HistoryStatus = RunSummary['status'];
export type HistoryGroup = 'all' | 'active' | 'succeeded' | 'failed' | 'cancelled';

export interface HistoryRow {
  runId: string;
  diagramId: string;
  /** Nombre del diagrama; `undefined` si ya no existe (la interfaz dice «Diagrama eliminado»). */
  diagramName?: string;
  status: HistoryStatus;
  startedAt: string;
  finishedAt?: string;
  /** Segundos; hasta `now` si sigue en curso. */
  durationS: number;
  tokens: number;
  costUsd: number;
  input: string;
  reason?: string;
  /** Enlaces con la ejecución reanudada o que la reanudó [R41.4]. */
  resumedFrom?: string;
  resumedBy?: string;
  /** Enlaces con la ejecución corregida y las que la corrigieron [R53.14]. */
  correctedFrom?: string;
  correctedBy?: string[];
}

const ms = (iso: string | undefined): number | undefined => {
  if (!iso) return undefined;
  const v = Date.parse(iso);
  return Number.isFinite(v) ? v : undefined;
};

/** Una fila por ejecución, de la más reciente a la más antigua [R35.1]. */
export function historyRows(runs: readonly RunSummary[], diagramNames: Readonly<Record<string, string>>, now: number): HistoryRow[] {
  return [...runs]
    .sort((a, b) => (ms(b.startedAt) ?? 0) - (ms(a.startedAt) ?? 0))
    .map((r) => {
      const start = ms(r.startedAt);
      const end = ms(r.finishedAt) ?? (r.status === 'running' ? now : undefined);
      // El nombre que tenía al ejecutarse; si no se guardó, el actual (R35.16).
      const name = r.diagramName ?? diagramNames[r.diagramId];
      return {
        runId: r.runId,
        diagramId: r.diagramId,
        ...(name !== undefined ? { diagramName: name } : {}),
        status: r.status,
        startedAt: r.startedAt,
        ...(r.finishedAt !== undefined ? { finishedAt: r.finishedAt } : {}),
        durationS: start !== undefined && end !== undefined ? Math.max(0, Math.round((end - start) / 1000)) : 0,
        tokens: r.usage.inputTokens + r.usage.outputTokens,
        costUsd: r.usage.costUsd,
        input: r.order ?? '',
        ...(r.reason !== undefined ? { reason: r.reason } : {}),
        ...(r.resumedFrom ? { resumedFrom: r.resumedFrom } : {}),
        ...(r.resumedBy ? { resumedBy: r.resumedBy } : {}),
        ...(r.correctedFrom ? { correctedFrom: r.correctedFrom } : {}),
        ...(r.correctedBy && r.correctedBy.length > 0 ? { correctedBy: [...r.correctedBy] } : {}),
      };
    });
}

export const groupOf = (s: HistoryStatus): Exclude<HistoryGroup, 'all'> =>
  s === 'running' ? 'active' : s === 'interrupted' ? 'failed' : s;

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

export interface HistoryFilter {
  group?: HistoryGroup;
  diagramId?: string;
  text?: string;
}

/** Filtra por grupo de estado, diagrama y texto (sin mayúsculas ni acentos) [R35.2]. */
export function filterHistory(rows: readonly HistoryRow[], f: HistoryFilter): HistoryRow[] {
  const q = fold((f.text ?? '').trim());
  return rows.filter(
    (r) =>
      (!f.group || f.group === 'all' || groupOf(r.status) === f.group) &&
      (!f.diagramId || r.diagramId === f.diagramId) &&
      (q === '' || fold(r.input).includes(q) || fold(r.diagramName ?? '').includes(q)),
  );
}

/** Número de ejecuciones de cada grupo [R35.2]. */
export function historyCounts(rows: readonly HistoryRow[]): Record<HistoryGroup, number> {
  const c: Record<HistoryGroup, number> = { all: rows.length, active: 0, succeeded: 0, failed: 0, cancelled: 0 };
  for (const r of rows) c[groupOf(r.status)]++;
  return c;
}

// --- Cronograma (R35.3) -------------------------------------------------------------------------

const REVIEW_VERDICT = { approved: 'aprobada', rejected: 'rechazada', exhausted: 'agotada' } as const;

export type TimelineMarkKind = 'question' | 'retry' | 'loop' | 'error';

export interface TimelineMark {
  kind: TimelineMarkKind;
  /** Segundos desde el arranque. */
  atS: number;
  /** Posición en % de la duración total. */
  pct: number;
  text: string;
}

/** Una pasada de un paso: de su `node.started` a su `node.finished` [R35.17]. */
export interface TimelinePass {
  n: number;
  status: LiveNodeStatus;
  startS: number;
  endS: number;
  open: boolean;
  leftPct: number;
  widthPct: number;
  /** Tramos esperando tu respuesta: de cada pregunta a su respuesta, o hasta el fin si no se respondió [R45.7]. */
  waits: TimelineSpan[];
}

export interface TimelineSpan {
  startS: number;
  endS: number;
  leftPct: number;
  widthPct: number;
}

/** Fichero tocado por el paso en un momento [R45.7]. */
export interface TimelineFile {
  atS: number;
  pct: number;
  path: string;
  change?: 'created' | 'modified';
}

/** Respuesta tuya a una pregunta del paso [R45.7]. */
export interface TimelineDecision {
  atS: number;
  pct: number;
  question: string;
  answer: string;
}

export interface TimelineStep {
  key: string;
  nodeId: Id;
  nodePath: Id[];
  status: LiveNodeStatus;
  agentId?: string;
  startS: number;
  endS: number;
  open: boolean;
  leftPct: number;
  widthPct: number;
  marks: TimelineMark[];
  /** Un tramo por pasada; con una sola pasada coincide con la barra del paso [R35.17]. */
  passes: TimelinePass[];
  files: TimelineFile[];
  decisions: TimelineDecision[];
}

export interface RunTimeline {
  totalS: number;
  /** Tiempo total esperando tu respuesta, sumando los pasos [R45.7]. */
  waitS: number;
  steps: TimelineStep[];
}

/**
 * Pasos de la ejecución con sus tramos y sus marcas, en el orden en que empezaron [R35.3].
 * Cada pasada de un paso es un tramo propio: entre dos pasadas queda el hueco en el que trabajaron los demás [R35.17].
 * Con `settled` (la ejecución ya no está en marcha) nada sigue abierto: la duración acaba en el último
 * evento y los pasos sin terminar quedan `interrupted`, con la barra cerrada en su último evento [R35.14].
 * `label` da el nombre de un nodo para las marcas de retorno (por defecto, su id).
 */
export function runTimeline(events: readonly RunEvent[], now: number, opts: { settled?: boolean; label?: (id: Id, path: readonly Id[]) => string } = {}): RunTimeline {
  const t0 = ms(events[0]?.ts);
  if (t0 === undefined) return { totalS: 1, waitS: 0, steps: [] };
  const finishedAt = ms(events.find((e) => e.type === 'run.finished')?.ts);
  const lastAt = ms(events[events.length - 1]!.ts) ?? t0;
  const endAll = finishedAt ?? (opts.settled ? lastAt : Math.max(now, lastAt));
  const rel = (iso: string) => Math.max(0, ((ms(iso) ?? t0) - t0) / 1000);
  const label = opts.label ?? ((id: Id) => id);
  type Wait = { startS: number; endS?: number };
  type Pass = Omit<TimelinePass, 'leftPct' | 'widthPct' | 'waits'> & { lastS: number; waits: Wait[] };
  type Draft = { key: string; nodeId: Id; nodePath: Id[]; agentId?: string; passes: Pass[]; marks: Omit<TimelineMark, 'pct'>[]; files: Omit<TimelineFile, 'pct'>[]; decisions: Omit<TimelineDecision, 'pct'>[] };
  // Pregunta abierta → su espera y su texto, para cerrarla con la respuesta [R45.7].
  const asking = new Map<string, { wait: Wait; text: string }>();
  const steps = new Map<string, Draft>();
  // Revisión que acaba de devolver el flujo a cada paso: se nombra al empezar su siguiente pasada [R35.17].
  const returnedBy = new Map<string, Id>();
  const mark = (key: string, kind: TimelineMarkKind, ts: string, text: string) => steps.get(key)?.marks.push({ kind, atS: rel(ts), text });
  for (const e of events) {
    const np = e.nodePath ?? [];
    if (e.type === 'loop.iteration') {
      mark(pathKey(np, e.loopId), 'loop', e.ts, `Vuelta ${e.n} de ${e.max}`);
      continue;
    }
    if (!('nodeId' in e) || e.nodeId === undefined) continue;
    const key = pathKey(np, e.nodeId);
    if (e.type === 'review.decided' && e.verdict === 'rejected' && e.returnTo !== undefined) returnedBy.set(pathKey(np, e.returnTo), e.nodeId);
    // La entrada y la salida internas de un bucle no son pasos del usuario.
    const inner = np.length > 0 && (e.nodeId === 'entry' || e.nodeId === 'output');
    if (e.type === 'node.started' && !inner) {
      const s = rel(e.ts);
      let st = steps.get(key);
      if (!st) {
        st = { key, nodeId: e.nodeId, nodePath: [...np], passes: [], marks: [], files: [], decisions: [] };
        steps.set(key, st);
      }
      const prev = st.passes[st.passes.length - 1];
      // Un `node.started` repetido sin haber terminado no abre otra pasada.
      if (!prev || !prev.open) {
        const n = st.passes.length + 1;
        st.passes.push({ n, status: 'running', startS: s, endS: s, open: true, lastS: s, waits: [] });
        if (n > 1) {
          const by = returnedBy.get(key);
          mark(key, 'loop', e.ts, by !== undefined ? `Pasada ${n} · devuelto por ${label(by, np)}` : `Pasada ${n}`);
        }
      }
      returnedBy.delete(key);
    }
    const st = steps.get(key);
    const cur = st?.passes[st.passes.length - 1];
    if (!st || !cur) continue;
    if (cur.open) cur.lastS = rel(e.ts);
    switch (e.type) {
      case 'agent.request':
        st.agentId = e.agentId;
        break;
      case 'agent.question': {
        cur.status = 'waiting_input';
        mark(key, 'question', e.ts, e.text);
        const wait: Wait = { startS: rel(e.ts) };
        cur.waits.push(wait);
        asking.set(e.questionId, { wait, text: e.text });
        break;
      }
      case 'agent.answer': {
        cur.status = 'running';
        const q = asking.get(e.questionId);
        if (q) {
          q.wait.endS = rel(e.ts);
          asking.delete(e.questionId);
        }
        st.decisions.push({ atS: rel(e.ts), question: q?.text ?? '', answer: e.text });
        break;
      }
      case 'file.produced':
        st.files.push({ atS: rel(e.ts), path: e.path, ...(e.change ? { change: e.change } : {}) });
        break;
      case 'node.retrying':
        mark(key, 'retry', e.ts, `Reintento ${e.attempt} de ${e.max}: ${e.message}`);
        break;
      case 'supervisor.alert':
        mark(key, 'retry', e.ts, t('sup.mark', { detail: e.detail }));
        break;
      case 'split.rejected':
        mark(key, 'retry', e.ts, t('split.rejected', { problems: e.problems.map(describeSplitProblem).join(' ') }));
        break;
      case 'error':
        mark(key, 'error', e.ts, e.message);
        break;
      case 'review.decided':
        mark(key, 'loop', e.ts, `Revisión ${REVIEW_VERDICT[e.verdict]} · vuelta ${e.round} de ${e.max}`);
        break;
      case 'node.finished':
        cur.status = e.status;
        cur.endS = rel(e.ts);
        cur.open = false;
        break;
      default:
        break;
    }
  }
  const totalS = Math.max(1, (endAll - t0) / 1000);
  const pct = (s: number) => Math.min(100, Math.max(0, (s / totalS) * 100));
  let waitS = 0;
  const out = {
    totalS,
    waitS: 0,
    steps: [...steps.values()].map((d) => {
      const passes: TimelinePass[] = d.passes.map(({ lastS, waits, ...p }) => {
        const cut = p.open && opts.settled === true;
        const endS = cut ? lastS : p.open ? totalS : p.endS;
        const spans = waits.map((w) => {
          const end = Math.max(w.startS, Math.min(endS, w.endS ?? endS));
          waitS += end - w.startS;
          return { startS: w.startS, endS: end, leftPct: pct(w.startS), widthPct: Math.max(0, pct(end) - pct(w.startS)) };
        });
        return { ...p, ...(cut ? { status: 'interrupted' as const, open: false } : {}), endS, leftPct: pct(p.startS), widthPct: Math.max(0, pct(endS) - pct(p.startS)), waits: spans };
      });
      const first = passes[0]!;
      const last = passes[passes.length - 1]!;
      return {
        key: d.key,
        nodeId: d.nodeId,
        nodePath: d.nodePath,
        status: last.status,
        ...(d.agentId !== undefined ? { agentId: d.agentId } : {}),
        startS: first.startS,
        endS: last.endS,
        open: last.open,
        leftPct: first.leftPct,
        widthPct: Math.max(0, pct(last.endS) - first.leftPct),
        marks: d.marks.map((m) => ({ ...m, pct: pct(m.atS) })),
        passes,
        files: d.files.map((f) => ({ ...f, pct: pct(f.atS) })),
        decisions: d.decisions.map((x) => ({ ...x, pct: pct(x.atS) })),
      };
    }),
  };
  out.waitS = waitS;
  return out;
}

/** Paso que se ve por defecto: el que pregunta, el que trabaja, el que quedó interrumpido, el que falló o, si no, el último que empezó (sin contar la Salida) [R35.9]. */
export function defaultStep(steps: readonly TimelineStep[]): TimelineStep | undefined {
  return steps.find((s) => s.status === 'waiting_input') ?? [...steps].reverse().find((s) => s.open) ?? steps.find((s) => s.status === 'interrupted') ?? steps.find((s) => s.status === 'failed') ?? [...steps].reverse().find((s) => s.nodeId !== 'output' || s.nodePath.length > 0) ?? steps[steps.length - 1];
}

/** Duración legible: «45 s», «2 min 14 s» o «1 h 3 min». */
export function formatDuration(s: number): string {
  const v = Math.max(0, Math.round(s));
  if (v < 60) return `${v} s`;
  if (v < 3600) return `${Math.floor(v / 60)} min${v % 60 ? ` ${v % 60} s` : ''}`;
  return `${Math.floor(v / 3600)} h${Math.floor((v % 3600) / 60) ? ` ${Math.floor((v % 3600) / 60)} min` : ''}`;
}
