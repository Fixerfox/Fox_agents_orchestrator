import { describe, expect, it } from 'vitest';
import type { RunEvent } from '@orquestador/core';
import { stepOverview } from '../src';

let seq = 0;
const ev = (body: Record<string, unknown>, ts: string, nodePath?: string[]): RunEvent => ({ runId: 'r', seq: ++seq, ts, ...(nodePath ? { nodePath } : {}), ...body }) as RunEvent;

describe('SPEC-068 · resumen de un paso (editor)', () => {
  it('[R68.4] estado, duración, tokens y coste de todas las pasadas, y la última salida', () => {
    const events = [
      ev({ type: 'node.started', nodeId: 'rev' }, '2026-11-08T10:00:00.000Z'),
      ev({ type: 'agent.usage', nodeId: 'rev', inputTokens: 1000, outputTokens: 200, costUsd: 0.01 }, '2026-11-08T10:00:30.000Z'),
      ev({ type: 'node.finished', nodeId: 'rev', status: 'failed', output: { text: 'primera' } }, '2026-11-08T10:00:40.000Z'),
      ev({ type: 'node.started', nodeId: 'rev' }, '2026-11-08T10:01:00.000Z'),
      ev({ type: 'agent.usage', nodeId: 'rev', inputTokens: 3000, outputTokens: 1042, costUsd: 0.031 }, '2026-11-08T10:01:50.000Z'),
      ev({ type: 'node.finished', nodeId: 'rev', status: 'succeeded', output: { text: 'Aprobado' } }, '2026-11-08T10:02:12.000Z'),
      // otro paso y el mismo id dentro de un bucle no cuentan
      ev({ type: 'agent.usage', nodeId: 'otro', inputTokens: 9, outputTokens: 9, costUsd: 9 }, '2026-11-08T10:02:13.000Z'),
      ev({ type: 'agent.usage', nodeId: 'rev', inputTokens: 9, outputTokens: 9, costUsd: 9 }, '2026-11-08T10:02:14.000Z', ['loop']),
    ];
    const o = stepOverview(events, 'rev');
    expect(o.status).toBe('succeeded');
    expect(o.output).toBe('Aprobado');
    expect(o.durationMs).toBe(132_000);
    expect(o.tokens).toBe(5242);
    expect(o.costUsd).toBeCloseTo(0.041);
    expect(o.hasUsage).toBe(true);
  });

  it('[R68.4] un paso que aún trabaja no tiene duración ni salida', () => {
    const o = stepOverview([ev({ type: 'node.started', nodeId: 'a' }, '2026-11-08T10:00:00.000Z')], 'a');
    expect(o).toEqual({ tokens: 0, costUsd: 0, hasUsage: false });
  });
});
