import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MockAgent, MockDecider, Orchestrator, VERIFIER_AGENT_ID, VERIFY_SKILL_ID, newAgent, type Diagram } from '@orquestador/core';
import { ProjectStore } from '@orquestador/store';
import { RunService, withBuiltinAgents } from '../src';
import { portsOf } from './ports';

const D: Diagram = {
  id: 'd',
  name: 'Docs',
  schemaVersion: 1,
  nodes: [
    { id: 'entry', kind: 'entry' },
    { id: 'a', kind: 'agent', agentId: 'a', label: 'Documentador' },
    { id: 'output', kind: 'output' },
  ],
  edges: [
    { id: 'e1', from: 'entry', to: 'a' },
    { id: 'e2', from: 'a', to: 'output' },
  ],
};

let dir: string;
let store: ProjectStore;
beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'orq-sev-'));
  store = await ProjectStore.create(dir, { name: 'p' });
  await store.diagrams.save(D);
});
afterEach(() => fs.rm(dir, { recursive: true, force: true }));

describe('SPEC-075 · en la app', () => {
  it('[R75.16] la biblioteca trae el Verificador y «Verificar lo pedido», y una copia del proyecto manda', async () => {
    const lib = withBuiltinAgents({ agents: async () => [], contexts: async () => [], skills: async () => [], mcp: async () => [], diagram: async () => D, diagramIds: async () => [] });
    const verifier = (await lib.agents()).find((a) => a.id === VERIFIER_AGENT_ID)!;
    expect(verifier).toMatchObject({ name: 'Verificador', skillIds: [VERIFY_SKILL_ID] });
    const skill = (await lib.skills()).find((s) => s.id === VERIFY_SKILL_ID)!;
    expect(skill.name).toBe('Verificar lo pedido');
    for (const must of ['lo pedido', 'diff', 'README', 'CLAUDE.md', 'principio a fin', 'No arregles nada', '## Verificación']) expect(skill.body).toContain(must);
    const own = withBuiltinAgents({ agents: async () => [{ ...newAgent(VERIFIER_AGENT_ID, 'Mío'), instructions: 'otro' }], contexts: async () => [], skills: async () => [{ id: VERIFY_SKILL_ID, name: 'Mía', description: '', body: 'x' }], mcp: async () => [], diagram: async () => D, diagramIds: async () => [] });
    expect((await own.agents()).find((a) => a.id === VERIFIER_AGENT_ID)!.name).toBe('Mío');
    expect((await own.skills()).map((s) => s.name)).toEqual(['Mía']);
  });

  it('[R75.21][R75.22][R75.23] marcar un aviso de una ejecución terminada: va a su registro, cuenta y queda como caso', async () => {
    const agents = new MockAgent({ a: { output: 'Añadí la documentación' } });
    const decider = new MockDecider({ supervise: async () => ({ ok: true, reason: '', summary: 's', outOfScope: 'Borró el README' }) });
    const svc = new RunService(portsOf(store), new Orchestrator({ getAdapter: () => agents, decider, supervisor: { review: () => true } }));
    const { runId } = await svc.start({ diagramId: 'd', order: 'Documenta' });
    await svc.settled(runId);
    const { backlog } = await svc.subscribe(runId, 1, () => {});
    const alert = backlog.find((e) => e.type === 'supervisor.alert' && e.rule === 'out-of-scope')!;
    expect(await svc.supervisorFeedback(runId, { alertSeq: alert.seq, verdict: 'false-alarm', note: 'lo pedí yo' })).toBe(true);
    const events = (await fs.readFile(join(store.paths.runDir(runId), 'events.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l) as { type: string });
    expect(events.at(-1)).toMatchObject({ type: 'supervisor.feedback', alertSeq: alert.seq, verdict: 'false-alarm', nodeId: 'a' });
    const cases = (await fs.readFile(store.paths.supervisorCasesFile, 'utf8')).trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(cases[0]).toMatchObject({ rule: 'out-of-scope', runId, person: { verdict: 'false-alarm', note: 'lo pedí yo' }, step: { output: 'Añadí la documentación' } });
    const stats = await svc.supervisorStats(runId);
    expect(stats.run).toEqual([{ rule: 'out-of-scope', alerts: 1, falseAlarms: 1, confirmed: 0 }]);
    expect(stats.recent).toEqual(stats.run);
    await expect(svc.supervisorFeedback(runId, { alertSeq: 99999, verdict: 'confirmed' })).rejects.toThrow(/no existe/);
  });
});
