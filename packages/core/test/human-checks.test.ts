import { describe, expect, it } from 'vitest';
import { MockAgent, MockDecider, Orchestrator, defaultSettings, normalizeSettings, reduceRunState, supervisorHumanChecks, validateSettings, type Diagram, type RunEvent, type SupervisorVerdict } from '../src';

const OK: SupervisorVerdict = { ok: true, reason: '', summary: 'Hizo lo pedido' };
const D: Diagram = {
  id: 'd',
  name: 'D',
  schemaVersion: 1,
  nodes: [{ id: 'entry', kind: 'entry' }, { id: 'a', kind: 'agent', agentId: 'a' }, { id: 'output', kind: 'output' }],
  edges: [{ id: 'e1', from: 'entry', to: 'a' }, { id: 'e2', from: 'a', to: 'output' }],
};
const ofType = <T extends RunEvent['type']>(events: readonly RunEvent[], type: T) => events.filter((e): e is Extract<RunEvent, { type: T }> => e.type === type);

function run(verdict: { met: boolean; missing: string; forPerson?: string }, humanChecks?: 'warn' | 'fail') {
  const orch = new Orchestrator({
    getAdapter: () => new MockAgent({ a: { output: 'hecho' } }),
    decider: new MockDecider({ supervise: () => Promise.resolve(OK), verifyRun: () => Promise.resolve(verdict) }),
    supervisor: { review: () => true, ...(humanChecks ? { humanChecks: () => humanChecks } : {}) },
  });
  return orch.start(D, 'Mide el quickstart').result;
}

describe('SPEC-065 · lo que solo puede comprobar una persona', () => {
  it('[R65.2] el ajuste vale «warn» por defecto, se valida y se normaliza', () => {
    expect(supervisorHumanChecks(defaultSettings())).toBe('warn');
    expect(supervisorHumanChecks({ supervisorHumanChecks: 'fail' })).toBe('fail');
    expect(validateSettings({ ...defaultSettings(), supervisorHumanChecks: 'nunca' as never }).map((e) => e.field)).toContain('supervisorHumanChecks');
    expect(normalizeSettings({ supervisorHumanChecks: 'fail' }).supervisorHumanChecks).toBe('fail');
    expect(normalizeSettings({ supervisorHumanChecks: 'raro' }).supervisorHumanChecks).toBeUndefined();
  });

  it('[R65.3] con «Avisar», lo que queda para una persona termina bien con el aviso needs-person', async () => {
    const r = await run({ met: true, missing: '', forPerson: 'Medir de verdad los 30 minutos' });
    expect(r.status).toBe('succeeded');
    expect(ofType(r.events, 'supervisor.verified')).toMatchObject([{ met: true, forPerson: 'Medir de verdad los 30 minutos' }]);
    expect(ofType(r.events, 'supervisor.alert')).toMatchObject([{ rule: 'needs-person', severity: 'warning', detail: 'Medir de verdad los 30 minutos' }]);
  });

  it('[R65.3] con «Hacer fallar», lo que queda para una persona cuenta como falta', async () => {
    const r = await run({ met: true, missing: '', forPerson: 'Medir de verdad los 30 minutos' }, 'fail');
    expect(r.status).toBe('failed');
    expect(r.reason).toBe('No cumple lo pedido: Medir de verdad los 30 minutos');
    expect(ofType(r.events, 'supervisor.alert').map((a) => a.rule)).toEqual(['requirements-unmet']);
  });

  it('[R65.3] lo que de verdad falta sigue haciendo fallar, aunque también quede algo para una persona', async () => {
    const r = await run({ met: false, missing: 'T038 está marcada como hecha y no lo está', forPerson: 'Medir los 30 minutos' });
    expect(r.status).toBe('failed');
    expect(r.reason).toBe('No cumple lo pedido: T038 está marcada como hecha y no lo está');
  });

  it('[R65.5][R65.7] run.accepted deja la ejecución terminada bien con el motivo de quien la aceptó', () => {
    const state = reduceRunState([
      { runId: 'r', seq: 1, ts: 't', type: 'run.started', diagramId: 'd' },
      { runId: 'r', seq: 2, ts: 't', type: 'run.finished', status: 'failed', reason: 'No cumple lo pedido: x' },
      { runId: 'r', seq: 3, ts: 't', type: 'run.accepted', by: 'user', reason: 'La medición la hago yo', previousReason: 'No cumple lo pedido: x' },
    ] as RunEvent[]);
    expect(state).toMatchObject({ status: 'succeeded', reason: 'La medición la hago yo' });
  });
});
