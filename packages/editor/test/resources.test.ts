import { describe, expect, it } from 'vitest';
import { defaultSettings, runMetrics, type RunEvent } from '@orquestador/core';
import { CHANNELS, deriveLive, filterHistory, historyRows, metricsCsv, parseRequest, sortHistory, type RunSummary } from '../src';

let seq = 0;
const ev = (b: object, ts = '2026-11-08T10:00:00.000Z'): RunEvent => ({ runId: 'r', seq: ++seq, ts, ...b }) as RunEvent;
const started = [ev({ type: 'run.started', diagramId: 'd' }), ev({ type: 'node.started', nodeId: 'a' }), ev({ type: 'agent.request', nodeId: 'a', agentId: 'a', attempt: 1, input: { text: '', files: [] } })];

describe('SPEC-077 · vista en vivo', () => {
  it('[R77.3] esperando hueco en toda la app: en cola con los agentes trabajando, hasta que arranca su intento', () => {
    const q = [...started, ev({ type: 'node.retrying', nodeId: 'a', attempt: 1, max: 3, delayMs: 1, message: 'x' }), ev({ type: 'node.queued', nodeId: 'a', others: 8 })];
    const v = deriveLive(q);
    expect(v.nodeStatus['a']).toBe('queued');
    expect(v.waits['a']).toEqual({ queuedBehind: 8 });
    const after = deriveLive([...q, ev({ type: 'agent.request', nodeId: 'a', agentId: 'a', attempt: 2, input: { text: '', files: [] } })]);
    expect(after.nodeStatus['a']).toBe('running');
    expect(after.waits['a']).toBeUndefined();
  });

  it('[R77.13] en pausa: «pausando» hasta que el paso queda retenido; al reanudar, nada', () => {
    const p = [...started, ev({ type: 'run.paused' })];
    expect(deriveLive(p).waits['a']).toEqual({ pause: 'pausing' });
    expect(deriveLive([...p, ev({ type: 'node.paused', nodeId: 'a', tool: 'Bash' })]).waits['a']).toEqual({ pause: 'paused' });
    expect(deriveLive([...p, ev({ type: 'node.paused', nodeId: 'a' }), ev({ type: 'run.resumed' })]).waits['a']).toBeUndefined();
    // Retenido en una pausa anterior no vale para la siguiente.
    expect(deriveLive([...p, ev({ type: 'node.paused', nodeId: 'a' }), ev({ type: 'run.resumed' }), ev({ type: 'run.paused' })]).waits['a']).toEqual({ pause: 'pausing' });
  });

  it('[R77.5][R77.6] el enfriamiento del proveedor y el aviso del 80 % se ven mientras corre', () => {
    const v = deriveLive([...started, ev({ type: 'provider.cooldown', provider: 'claude', untilTs: '2026-11-08T10:42:00.000Z', reason: 'rate_limit' }), ev({ type: 'run.budget_warning', limit: 'cost', used: 4.1, max: 5 })]);
    expect(v.cooldown).toEqual({ provider: 'claude', untilTs: '2026-11-08T10:42:00.000Z' });
    expect(v.budgetWarning).toEqual({ limit: 'cost', used: 4.1, max: 5 });
    expect(deriveLive([...started, ev({ type: 'provider.cooldown', provider: 'claude', untilTs: '2026-11-08T10:42:00.000Z', reason: 'rate_limit' }), ev({ type: 'run.finished', status: 'succeeded' })]).cooldown).toBeUndefined();
  });
});

describe('SPEC-077 · historial y métricas', () => {
  const run = (id: string, o: Partial<RunSummary>): RunSummary => ({ runId: id, diagramId: 'd', startedAt: '2026-11-08T10:00:00.000Z', finishedAt: '2026-11-08T10:01:00.000Z', status: 'succeeded', usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 }, eventCount: 1, ...o });

  it('[R77.19] ordenar por coste, duración y reintentos, y filtrar las caras, las largas y las que reintentaron', () => {
    const rows = historyRows([run('barata', { startedAt: '2026-11-08T12:00:00.000Z', finishedAt: '2026-11-08T12:00:10.000Z' }), run('cara', { usage: { inputTokens: 1, outputTokens: 1, costUsd: 3 } }), run('larga', { finishedAt: '2026-11-08T10:30:00.000Z', retries: 2 })], {}, 0);
    expect(rows.find((r) => r.runId === 'larga')!.retries).toBe(2);
    expect(sortHistory(rows).map((r) => r.runId)[0]).toBe('barata');
    expect(sortHistory(rows, 'cost').map((r) => r.runId)[0]).toBe('cara');
    expect(sortHistory(rows, 'duration').map((r) => r.runId)[0]).toBe('larga');
    expect(sortHistory(rows, 'retries').map((r) => r.runId)[0]).toBe('larga');
    expect(filterHistory(rows, { measure: 'costly' }).map((r) => r.runId)).toEqual(['cara']);
    expect(filterHistory(rows, { measure: 'long' }).map((r) => r.runId)).toEqual(['larga']);
    expect(filterHistory(rows, { measure: 'retried' }).map((r) => r.runId)).toEqual(['larga']);
    expect(filterHistory(rows, { measure: 'all' })).toHaveLength(3);
  });

  it('[R77.18] la tabla por agente se exporta a CSV con totales y el Supervisor aparte', () => {
    const e = (s: number, b: object) => ev(b, new Date(Date.parse('2026-11-08T10:00:00.000Z') + s * 1000).toISOString());
    const m = runMetrics([e(0, { type: 'node.started', nodeId: 'a' }), e(0, { type: 'agent.request', nodeId: 'a', agentId: 'dev', attempt: 1, input: { text: '', files: [] } }), e(1, { type: 'agent.usage', nodeId: 'a', inputTokens: 10, outputTokens: 5, costUsd: 0.25 }), e(2, { type: 'agent.usage', nodeId: 'a', inputTokens: 1, outputTokens: 1, costUsd: 0.01, source: 'supervisor' }), e(10, { type: 'node.finished', nodeId: 'a', status: 'succeeded' })]);
    const csv = metricsCsv(m, (id) => (id === 'dev' ? 'Dev, el bueno' : id)).trim().split('\n');
    expect(csv[0]).toBe('agente,pasos,intentos,reintentos,trabajando_s,esperando_s,en_cola_s,tokens,coste_usd');
    expect(csv[1]).toBe('"Dev, el bueno",1,1,0,10,0,0,15,0.2500');
    expect(csv[2]!.startsWith('total,1,1,0,10')).toBe(true);
    expect(csv[3]).toBe('supervisor,0,0,0,0,0,0,2,0.0100');
  });

  it('[R77.1][R77.8][R77.10] los ajustes nuevos pasan el contrato y se comprueba su forma', () => {
    const s = { ...defaultSettings(), maxAgentsTotal: 12, onBudget: 'finish-running', burnRateUsdPerMin: 2 };
    expect(parseRequest(CHANNELS.saveSettings, s)).toMatchObject({ maxAgentsTotal: 12, onBudget: 'finish-running', burnRateUsdPerMin: 2 });
    expect(() => parseRequest(CHANNELS.saveSettings, { ...s, maxAgentsTotal: '12' })).toThrow();
  });
});
