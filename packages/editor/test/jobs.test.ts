import { describe, expect, it } from 'vitest';
import { agoText, filterJobs, jobRows, jobsBanner, type JobInfo, type QueuedRunView, type RunSummary } from '../src';

const job = (id: string, name: string, problems = 0, steps = 3): JobInfo => ({ id, name, steps, problems });
const run = (runId: string, diagramId: string, status: RunSummary['status'], startedAt: string, finishedAt?: string): RunSummary => ({
  runId,
  diagramId,
  status,
  startedAt,
  ...(finishedAt ? { finishedAt } : {}),
  usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
  eventCount: 1,
});
const NOW = Date.parse('2026-11-05T20:00:00Z');

describe('SPEC-052 · filas de Trabajos', () => {
  it('[R52.4] cuenta ejecuciones, en marcha, esperando y en cola, y da la última con hace cuánto', () => {
    const runs = [
      run('a', 'informe', 'succeeded', '2026-11-05T17:00:00Z', '2026-11-05T18:00:00Z'),
      run('b', 'informe', 'running', '2026-11-05T19:58:00Z'),
      run('c', 'informe', 'running', '2026-11-05T19:59:00Z'),
      run('d', 'pr', 'failed', '2026-11-04T10:00:00Z', '2026-11-04T10:05:00Z'),
    ];
    const queue: QueuedRunView[] = [{ queuedId: 'q1', diagramId: 'informe', diagramName: 'Informe', order: 'x', at: '2026-11-05T19:59:30Z' }];
    const rows = jobRows([job('pr', 'Revisión de PR'), job('informe', 'Informe semanal'), job('nuevo', 'Nuevo', 2)], runs, queue, new Set(['c']), NOW);
    const informe = rows.find((r) => r.id === 'informe')!;
    expect(informe).toMatchObject({ total: 3, running: 2, waiting: 1, queued: 1, runnable: true });
    expect(informe.last).toEqual({ status: 'running', at: '2026-11-05T19:59:00Z', agoS: 60 });
    expect(rows.find((r) => r.id === 'pr')!.last).toMatchObject({ status: 'failed', at: '2026-11-04T10:05:00Z' });
    expect(rows.find((r) => r.id === 'nuevo')).toMatchObject({ total: 0, runnable: false });
    expect(rows.find((r) => r.id === 'nuevo')!.last).toBeUndefined();
  });

  it('[R52.4] ordena: primero lo que tiene algo en marcha o en cola, luego la última más reciente y luego el nombre', () => {
    const runs = [run('a', 'b', 'succeeded', '2026-11-05T10:00:00Z', '2026-11-05T10:01:00Z'), run('x', 'c', 'succeeded', '2026-11-05T12:00:00Z', '2026-11-05T12:01:00Z')];
    const queue: QueuedRunView[] = [{ queuedId: 'q', diagramId: 'z', diagramName: 'Z', order: '', at: '' }];
    const rows = jobRows([job('a', 'Alfa'), job('b', 'Beta'), job('c', 'Gamma'), job('d', 'Ápice'), job('z', 'Zeta')], runs, queue, new Set(), NOW);
    expect(rows.map((r) => r.id)).toEqual(['z', 'c', 'b', 'a', 'd']);
  });

  it('[R52.4] filterJobs busca por nombre sin mayúsculas ni acentos', () => {
    const rows = jobRows([job('a', 'Revisión de PR'), job('b', 'Informe')], [], [], new Set(), NOW);
    expect(filterJobs(rows, 'REVISION').map((r) => r.id)).toEqual(['a']);
    expect(filterJobs(rows, '  ')).toHaveLength(2);
    expect(filterJobs(rows, 'nada')).toEqual([]);
  });

  it('[R52.6] el «hace cuánto» se escribe en minutos, horas o días', () => {
    expect(agoText(20)).toBe('hace un momento');
    expect(agoText(5 * 60)).toBe('hace 5 min');
    expect(agoText(2 * 3600 + 10)).toBe('hace 2 h');
    expect(agoText(86400 + 5)).toBe('hace 1 día');
    expect(agoText(3 * 86400)).toBe('hace 3 días');
  });
});

describe('SPEC-052 · banda de estado de Trabajos', () => {
  it('[R52.4][R52.6] cuenta en marcha, te necesita, en cola y terminadas en 24 h con sus fallos', () => {
    const runs = [
      run('a', 'x', 'running', '2026-11-05T19:50:00Z'),
      run('b', 'x', 'running', '2026-11-05T19:55:00Z'),
      run('c', 'x', 'succeeded', '2026-11-05T18:00:00Z', '2026-11-05T18:10:00Z'),
      run('d', 'x', 'failed', '2026-11-05T10:00:00Z', '2026-11-05T10:05:00Z'),
      run('e', 'x', 'interrupted', '2026-11-05T09:00:00Z'),
      run('f', 'x', 'succeeded', '2026-11-03T10:00:00Z', '2026-11-03T10:05:00Z'),
    ];
    const queue: QueuedRunView[] = [{ queuedId: 'q', diagramId: 'x', diagramName: 'X', order: '', at: '' }];
    expect(jobsBanner(runs, new Set(['b']), queue, NOW)).toEqual({ running: 1, needs: 1, queued: 1, finished: 3, failed: 2 });
  });
});
