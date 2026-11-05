import { describe, expect, it } from 'vitest';
import type { RunEvent } from '@orquestador/core';
import { defaultStep, deriveLive, filterHistory, formatDuration, historyCounts, historyRows, runTimeline, settleLive, type RunSummary } from '../src';

const T0 = Date.parse('2026-11-05T10:00:00.000Z');
const at = (s: number) => new Date(T0 + s * 1000).toISOString();

const summary = (o: Partial<RunSummary> & Pick<RunSummary, 'runId' | 'status'>): RunSummary => ({
  diagramId: 'pr',
  startedAt: at(0),
  usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
  eventCount: 1,
  ...o,
});

const RUNS: RunSummary[] = [
  summary({ runId: 'a', status: 'succeeded', diagramId: 'pr', startedAt: at(0), finishedAt: at(90), order: 'Revisa el PR #139', usage: { inputTokens: 100, outputTokens: 50, costUsd: 0.02 } }),
  summary({ runId: 'b', status: 'running', diagramId: 'inf', startedAt: at(300), order: 'Informe de la semana' }),
  summary({ runId: 'c', status: 'interrupted', diagramId: 'pr', startedAt: at(100), order: 'Revisión rápida' }),
  summary({ runId: 'd', status: 'cancelled', diagramId: 'borrado', startedAt: at(50), finishedAt: at(60), order: 'Traducción' }),
  summary({ runId: 'e', status: 'failed', diagramId: 'inf', startedAt: at(200), finishedAt: at(230), order: 'Información' }),
];
const NAMES = { pr: 'Revisión de PR', inf: 'Informe semanal' };

describe('historial de ejecuciones [R35.1][R35.2]', () => {
  const rows = historyRows(RUNS, NAMES, T0 + 360_000);

  it('[R35.1] ordena de la más reciente a la más antigua con diagrama, duración, tokens, coste y entrada', () => {
    expect(rows.map((r) => r.runId)).toEqual(['b', 'e', 'c', 'd', 'a']);
    const a = rows.find((r) => r.runId === 'a')!;
    expect(a).toMatchObject({ diagramName: 'Revisión de PR', durationS: 90, tokens: 150, costUsd: 0.02, input: 'Revisa el PR #139' });
  });

  it('[R35.1] la que sigue en curso cuenta hasta ahora; la de un diagrama borrado no tiene nombre', () => {
    expect(rows.find((r) => r.runId === 'b')!.durationS).toBe(60);
    expect(rows.find((r) => r.runId === 'd')!.diagramName).toBeUndefined();
    expect(rows.find((r) => r.runId === 'c')!).toMatchObject({ status: 'interrupted', durationS: 0 });
  });

  it('[R35.2] agrupa por estado: fallidas incluye las interrumpidas, y cuenta cada grupo', () => {
    expect(filterHistory(rows, { group: 'failed' }).map((r) => r.runId)).toEqual(['e', 'c']);
    expect(filterHistory(rows, { group: 'active' }).map((r) => r.runId)).toEqual(['b']);
    expect(historyCounts(rows)).toEqual({ all: 5, active: 1, succeeded: 1, failed: 2, cancelled: 1 });
  });

  it('[R35.2] filtra por diagrama y busca en la entrada y en el diagrama sin mayúsculas ni acentos', () => {
    expect(filterHistory(rows, { diagramId: 'inf' }).map((r) => r.runId)).toEqual(['b', 'e']);
    expect(filterHistory(rows, { text: 'INFORMACION' }).map((r) => r.runId)).toEqual(['e']);
    expect(filterHistory(rows, { text: 'revision' }).map((r) => r.runId)).toEqual(['c', 'a']);
    expect(filterHistory(rows, { text: 'semanal', group: 'failed' }).map((r) => r.runId)).toEqual(['e']);
  });
});

let seq = 0;
const ev = (s: number, body: Record<string, unknown>, nodePath?: string[]): RunEvent =>
  ({ runId: 'r', seq: ++seq, ts: at(s), ...(nodePath ? { nodePath } : {}), ...body }) as unknown as RunEvent;

describe('cronograma de una ejecución [R35.3][R35.9]', () => {
  const events: RunEvent[] = [
    ev(0, { type: 'run.started', diagramId: 'd' }),
    ev(0, { type: 'node.started', nodeId: 'entry' }),
    ev(1, { type: 'node.finished', nodeId: 'entry', status: 'succeeded' }),
    ev(1, { type: 'node.started', nodeId: 'a' }),
    ev(1, { type: 'agent.request', nodeId: 'a', agentId: 'analista', attempt: 1, input: { text: 'x' } }),
    ev(5, { type: 'node.retrying', nodeId: 'a', attempt: 1, max: 3, message: 'tiempo' }),
    ev(10, { type: 'node.finished', nodeId: 'a', status: 'succeeded' }),
    ev(10, { type: 'node.started', nodeId: 'loop' }),
    ev(10, { type: 'node.started', nodeId: 'entry' }, ['loop']),
    ev(11, { type: 'node.started', nodeId: 'w' }, ['loop']),
    ev(15, { type: 'loop.iteration', loopId: 'loop', n: 1, max: 3, verdict: 'continue' }),
    ev(16, { type: 'node.started', nodeId: 'q' }),
    ev(18, { type: 'agent.question', nodeId: 'q', questionId: 'q1', text: '¿Incluyo costes?' }),
  ];

  it('[R35.3] pasos en orden de inicio, sin la entrada interna del bucle, con inicio y fin relativos', () => {
    const tl = runTimeline(events, T0 + 20_000);
    expect(tl.totalS).toBe(20);
    expect(tl.steps.map((s) => s.key)).toEqual(['entry', 'a', 'loop', 'loop/w', 'q']);
    expect(tl.steps[1]).toMatchObject({ status: 'succeeded', startS: 1, endS: 10, open: false, agentId: 'analista', leftPct: 5, widthPct: 45 });
  });

  it('[R35.3] un paso abierto llega hasta ahora y las marcas llevan su posición', () => {
    const tl = runTimeline(events, T0 + 20_000);
    const q = tl.steps.find((s) => s.key === 'q')!;
    expect(q).toMatchObject({ status: 'waiting_input', open: true, endS: 20, widthPct: 20 });
    expect(q.marks).toEqual([{ kind: 'question', atS: 18, pct: 90, text: '¿Incluyo costes?' }]);
    expect(tl.steps[1]!.marks[0]).toMatchObject({ kind: 'retry', pct: 25 });
    expect(tl.steps.find((s) => s.key === 'loop')!.marks[0]).toMatchObject({ kind: 'loop', text: 'Vuelta 1 de 3' });
  });

  it('[R35.3] una ejecución terminada mide hasta su final, marca errores y la duración mínima es 1 s', () => {
    const done = [...events, ev(19, { type: 'error', nodeId: 'q', message: 'falló', retriable: false }), ev(19, { type: 'node.finished', nodeId: 'q', status: 'failed' }), ev(20, { type: 'run.finished', status: 'failed' })];
    const tl = runTimeline(done, T0 + 999_000);
    expect(tl.totalS).toBe(20);
    expect(tl.steps.find((s) => s.key === 'q')!.marks.map((m) => m.kind)).toEqual(['question', 'error']);
    expect(runTimeline([ev(0, { type: 'run.started', diagramId: 'd' })], T0).totalS).toBe(1);
    expect(runTimeline([], T0).steps).toEqual([]);
  });

  it('[R35.9] por defecto se ve el paso que pregunta; si no, el que trabaja, el que falló o el último', () => {
    const tl = runTimeline(events, T0 + 20_000);
    expect(defaultStep(tl.steps)!.key).toBe('q');
    const ok = runTimeline(events.slice(0, 7), T0 + 20_000);
    expect(defaultStep(ok.steps)!.key).toBe('a');
  });

  it('[R35.3] duración legible', () => {
    expect(formatDuration(45)).toBe('45 s');
    expect(formatDuration(134)).toBe('2 min 14 s');
    expect(formatDuration(120)).toBe('2 min');
    expect(formatDuration(3780)).toBe('1 h 3 min');
  });
});

describe('estado verdadero de una ejecución que ya no está en marcha [R35.14][R35.16]', () => {
  const open: RunEvent[] = [
    ev(0, { type: 'run.started', diagramId: 'd' }),
    ev(0, { type: 'node.started', nodeId: 'entry' }),
    ev(1, { type: 'node.finished', nodeId: 'entry', status: 'succeeded' }),
    ev(1, { type: 'node.started', nodeId: 'qa' }),
    ev(1, { type: 'node.queued', nodeId: 'router' }),
    ev(300, { type: 'tool.called', nodeId: 'qa', tool: 'Read', input: {} }),
    ev(400, { type: 'agent.question', nodeId: 'qa', questionId: 'q1', text: '¿Sigo?' }),
  ];

  it('[R35.14] settleLive: lo abierto pasa a interrumpido, sin preguntas ni pausa; lo cerrado no cambia', () => {
    const live = deriveLive([...open, ev(401, { type: 'run.paused' })]);
    expect(live.nodeStatus).toMatchObject({ qa: 'waiting_input', router: 'queued', entry: 'succeeded' });
    const settled = settleLive(live);
    expect(settled.nodeStatus).toEqual({ entry: 'succeeded', qa: 'interrupted', router: 'interrupted' });
    expect(settled.pending).toEqual([]);
    expect(settled.paused).toBe(false);
    expect(settleLive(deriveLive(open.slice(0, 3))).nodeStatus).toEqual({ entry: 'succeeded' });
  });

  it('[R35.14] el cronograma de una ejecución parada acaba en su último evento y no deja barras abiertas', () => {
    const tl = runTimeline(open, T0 + 99_999_000, { settled: true });
    expect(tl.totalS).toBe(400);
    const qa = tl.steps.find((s) => s.key === 'qa')!;
    expect(qa).toMatchObject({ status: 'interrupted', open: false, startS: 1, endS: 400 });
    expect(tl.steps.some((s) => s.open)).toBe(false);
    expect(defaultStep(tl.steps)!.key).toBe('qa');
    // Sin `settled` (sigue en marcha) la barra llega hasta ahora.
    expect(runTimeline(open, T0 + 500_000).steps.find((s) => s.key === 'qa')).toMatchObject({ status: 'waiting_input', open: true, endS: 500 });
  });

  it('[R35.16][R35.1] el historial usa el nombre que tenía el diagrama al ejecutarse', () => {
    const rows = historyRows([summary({ runId: 'x', status: 'succeeded', diagramId: 'pr', diagramName: 'Revisión (antes)' }), summary({ runId: 'y', status: 'succeeded', diagramId: 'gone', diagramName: 'Borrado' })], NAMES, T0);
    expect(rows.map((r) => r.diagramName).sort()).toEqual(['Borrado', 'Revisión (antes)']);
  });
});

describe('cronograma con revisión y retorno [R35.3]', () => {
  it('[R35.3] la revisión marca cada decisión y el paso que vuelve a empezar está abierto de nuevo', () => {
    const evs: RunEvent[] = [
      ev(0, { type: 'run.started', diagramId: 'd' }),
      ev(1, { type: 'node.started', nodeId: 'crea' }),
      ev(5, { type: 'node.finished', nodeId: 'crea', status: 'succeeded' }),
      ev(5, { type: 'node.started', nodeId: 'qa' }),
      ev(8, { type: 'review.decided', nodeId: 'qa', round: 1, max: 3, verdict: 'rejected', source: 'verdict', returnTo: 'crea' }),
      ev(8, { type: 'node.finished', nodeId: 'qa', status: 'succeeded' }),
      ev(9, { type: 'node.started', nodeId: 'crea' }),
    ];
    const tl = runTimeline(evs, T0 + 12_000);
    expect(tl.steps.find((s) => s.key === 'crea')).toMatchObject({ status: 'running', open: true, startS: 1, endS: 12 });
    expect(tl.steps.find((s) => s.key === 'qa')!.marks).toEqual([expect.objectContaining({ kind: 'loop', text: 'Revisión rechazada · vuelta 1 de 3' })]);
    // Parada a medias: el paso que había vuelto a empezar queda interrumpido, no «terminado».
    expect(runTimeline(evs, T0, { settled: true }).steps.find((s) => s.key === 'crea')).toMatchObject({ status: 'interrupted', endS: 9 });
  });
});

describe('cronograma por pasadas [R35.17]', () => {
  // El caso real del 05/11: «disenador» termina, pasan QA y Revisión, y la revisión lo devuelve.
  const evs: RunEvent[] = [
    ev(0, { type: 'run.started', diagramId: 'd' }),
    ev(10, { type: 'node.started', nodeId: 'dis' }),
    ev(21, { type: 'node.finished', nodeId: 'dis', status: 'succeeded' }),
    ev(21, { type: 'node.started', nodeId: 'qa' }),
    ev(35, { type: 'node.finished', nodeId: 'qa', status: 'succeeded' }),
    ev(35, { type: 'node.started', nodeId: 'rev' }),
    ev(38, { type: 'review.decided', nodeId: 'rev', round: 1, max: 3, verdict: 'rejected', source: 'verdict', returnTo: 'dis' }),
    ev(38, { type: 'node.finished', nodeId: 'rev', status: 'succeeded' }),
    ev(38, { type: 'node.started', nodeId: 'dis' }),
    ev(52, { type: 'agent.question', nodeId: 'dis', questionId: 'q1', text: '¿Construyo todo?' }),
  ];

  it('[R35.17] cada pasada es un tramo propio y el hueco entre ellas no se pinta como «ejecutando»', () => {
    const tl = runTimeline(evs, T0 + 60_000, { label: (id) => (id === 'rev' ? 'Revisión' : id) });
    const dis = tl.steps.find((s) => s.key === 'dis')!;
    expect(dis.passes.map((p) => [p.n, p.startS, p.endS, p.status, p.open])).toEqual([
      [1, 10, 21, 'succeeded', false],
      [2, 38, 60, 'waiting_input', true],
    ]);
    // QA y Revisión trabajaron en el hueco: ningún tramo de «dis» los solapa.
    for (const other of ['qa', 'rev']) {
      const o = tl.steps.find((s) => s.key === other)!.passes[0]!;
      for (const p of dis.passes) expect(p.endS <= o.startS || p.startS >= o.endS).toBe(true);
    }
    expect(dis.marks).toContainEqual(expect.objectContaining({ kind: 'loop', atS: 38, text: 'Pasada 2 · devuelto por Revisión' }));
    // Los porcentajes de cada tramo salen de su propio inicio y fin.
    expect(dis.passes[0]!.leftPct).toBeCloseTo((10 / 60) * 100);
    expect(dis.passes[0]!.widthPct).toBeCloseTo((11 / 60) * 100);
  });

  it('[R35.17] con una sola pasada el tramo coincide con la barra; sin revisión conocida la marca dice solo «Pasada N»', () => {
    const tl = runTimeline(evs, T0 + 60_000);
    const qa = tl.steps.find((s) => s.key === 'qa')!;
    expect(qa.passes).toHaveLength(1);
    expect(qa.passes[0]).toMatchObject({ startS: qa.startS, endS: qa.endS, leftPct: qa.leftPct, widthPct: qa.widthPct });
    const again: RunEvent[] = [
      ev(0, { type: 'run.started', diagramId: 'd' }),
      ev(1, { type: 'node.started', nodeId: 'w' }, ['loop']),
      ev(2, { type: 'node.finished', nodeId: 'w', status: 'succeeded' }, ['loop']),
      ev(3, { type: 'node.started', nodeId: 'w' }, ['loop']),
    ];
    const w = runTimeline(again, T0 + 4_000).steps[0]!;
    expect(w.passes).toHaveLength(2);
    expect(w.marks).toContainEqual(expect.objectContaining({ kind: 'loop', text: 'Pasada 2' }));
  });

  it('[R35.17][R35.14] parada a medias: solo la última pasada queda interrumpida, cerrada en su último evento', () => {
    const dis = runTimeline(evs, T0, { settled: true }).steps.find((s) => s.key === 'dis')!;
    expect(dis.passes.map((p) => [p.status, p.endS, p.open])).toEqual([
      ['succeeded', 21, false],
      ['interrupted', 52, false],
    ]);
    expect(dis).toMatchObject({ status: 'interrupted', open: false, startS: 10, endS: 52 });
  });
});
