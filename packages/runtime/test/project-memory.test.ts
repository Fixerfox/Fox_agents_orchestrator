import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MEMORY_MAX_ACTIVE, MockAgent, MockDecider, defaultSettings, memoryEngine, type AgentRequest, type Decider, type Diagram, type MemoryEntry, type RunEvent } from '@orquestador/core';
import { ProjectStore, libraryReaderOf } from '@orquestador/store';
import { RunService, RunSnapshots, createEngineOrchestrator, snapshotLibrary } from '../src';
import { portsOf } from './ports';

const D: Diagram = {
  id: 'd',
  name: 'Docs',
  schemaVersion: 1,
  nodes: [
    { id: 'entry', kind: 'entry' },
    { id: 'a', kind: 'agent', agentId: 'a', label: 'Documentador', confirm: true },
    { id: 'output', kind: 'output' },
  ],
  edges: [
    { id: 'e1', from: 'entry', to: 'a' },
    { id: 'e2', from: 'a', to: 'output' },
  ],
};
const PLAIN: Diagram = { ...D, id: 'p', nodes: D.nodes.map((n) => (n.id === 'a' ? { id: 'a', kind: 'agent', agentId: 'a', label: 'Documentador' } : n)) };

const T = '2026-11-01T10:00:00.000Z';
const entry = (id: string, o: Partial<MemoryEntry> = {}): MemoryEntry => ({ id, kind: 'convention', scope: 'project', title: `Título ${id}`, text: `Texto ${id}`, status: 'active', source: { origin: 'manual' }, createdAt: T, updatedAt: T, uses: 0, history: [{ at: T, action: 'created', by: 'user' }], ...o });

let dir: string;
let store: ProjectStore;
beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'orq-pmem-'));
  store = await ProjectStore.create(dir, { name: 'p' });
  await store.diagrams.save(D);
  await store.diagrams.save(PLAIN);
});
afterEach(() => fs.rm(dir, { recursive: true, force: true }));

/** La app en pequeño: motor simulado, copia por ejecución y memoria en disco. */
function app(o: { decider?: Decider; agents?: MockAgent } = {}) {
  const agents = o.agents ?? new MockAgent({ a: { output: 'Hecho' } });
  const snapshots = new RunSnapshots();
  const library = snapshotLibrary(libraryReaderOf(store), snapshots);
  const orch = createEngineOrchestrator({ library, settings: () => ({ ...defaultSettings(), engine: 'mem' as never }) }, [memoryEngine('mem', { adapter: agents, decider: o.decider ?? new MockDecider() })]);
  const svc = new RunService({ ...portsOf(store), memory: { load: () => store.loadProjectMemory(), save: (e) => store.saveProjectMemory(e) } }, orch, () => ({}), snapshots);
  return { svc, agents };
}

/** Lanza el diagrama, responde a la confirmación con cambios y espera a las propuestas. */
async function runWithChange(svc: RunService, text = 'Escribe siempre en español') {
  const { runId } = await svc.start({ diagramId: 'd', order: 'Documenta' });
  const answered = new Set<string>();
  await svc.subscribe(runId, 1, (e: RunEvent) => {
    if (e.type !== 'agent.question' || !e.confirm || answered.has(e.questionId)) return;
    answered.add(e.questionId);
    setTimeout(() => void svc.answer(runId, e.questionId, answered.size === 1 ? text : 'Aprobar'), 0);
  });
  await svc.memoryProposed(runId);
  return runId;
}
const eventsOf = async (runId: string) => (await fs.readFile(join(store.paths.runDir(runId), 'events.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l) as RunEvent);

describe('SPEC-076 · propuestas al terminar', () => {
  it('[R76.5][R76.8][R76.9][R76.10] lo que dijo la persona sale como memory.proposed después de run.finished y avisa a la bandeja', async () => {
    const { svc } = app();
    const notices: { runId: string; diagramName: string; count: number }[] = [];
    svc.onMemoryProposals((n) => notices.push(n));
    const runId = await runWithChange(svc);
    const events = await eventsOf(runId);
    const finished = events.findIndex((e) => e.type === 'run.finished');
    const proposed = events.findIndex((e) => e.type === 'memory.proposed');
    expect(proposed).toBeGreaterThan(finished);
    const p = events[proposed] as Extract<RunEvent, { type: 'memory.proposed' }>;
    expect(p.proposals).toEqual([expect.objectContaining({ id: 'p1', action: 'add', kind: 'preference', origin: 'confirm', text: 'Escribe siempre en español' })]);
    expect(notices).toEqual([{ runId, diagramName: 'Docs', count: 1 }]);
    // Ninguna se guarda sola.
    expect(await svc.projectMemory()).toEqual([]);
  });

  it('[R76.9] sin señales no se consulta al modelo ni hay propuestas', async () => {
    let asked = 0;
    const decider = new MockDecider();
    Object.assign(decider, { proposeMemory: async () => (asked++, { proposals: [] }) });
    const { svc } = app({ decider });
    const { runId } = await svc.start({ diagramId: 'p', order: 'Documenta' });
    await svc.memoryProposed(runId);
    expect(asked).toBe(0);
    expect((await eventsOf(runId)).some((e) => e.type === 'memory.proposed')).toBe(false);
  });

  it('[R76.6] el uso de la consulta cuenta en el de la ejecución', async () => {
    const decider = new MockDecider();
    Object.assign(decider, { proposeMemory: async () => ({ proposals: [{ action: 'add', kind: 'convention', scope: 'project', title: 'Español', text: 'Escribe en español', origin: 'confirm' }], usage: { inputTokens: 100, outputTokens: 20, costUsd: 0.5 } }) });
    const { svc } = app({ decider });
    const runId = await runWithChange(svc);
    const meta = JSON.parse(await fs.readFile(join(store.paths.runDir(runId), 'meta.json'), 'utf8')) as { usage: { costUsd: number } };
    expect(meta.usage.costUsd).toBeGreaterThanOrEqual(0.5);
  });
});

describe('SPEC-076 · aprobación', () => {
  it('[R76.11] guardar crea la entrada con su historial y anota memory.decided; no se decide dos veces', async () => {
    const { svc } = app();
    const runId = await runWithChange(svc);
    const entries = await svc.decideMemory(runId, { proposalId: 'p1', decision: 'save', edited: { text: 'Todo en español' } });
    expect(entries).toEqual([expect.objectContaining({ text: 'Todo en español', status: 'active', source: { runId, origin: 'confirm' } })]);
    expect(entries[0]!.history[0]).toMatchObject({ action: 'created', by: 'user', runId });
    expect((await eventsOf(runId)).at(-1)).toMatchObject({ type: 'memory.decided', proposalId: 'p1', decision: 'save', entryId: entries[0]!.id, edited: true, by: 'user' });
    await expect(svc.decideMemory(runId, { proposalId: 'p1', decision: 'discard' })).rejects.toThrow('ya se decidió');
    await expect(svc.decideMemory(runId, { proposalId: 'p9', decision: 'save' })).rejects.toThrow('no existe');
  });

  it('[R76.11] lo descartado no se vuelve a proponer igual en las ejecuciones siguientes', async () => {
    const { svc } = app();
    const first = await runWithChange(svc);
    await svc.decideMemory(first, { proposalId: 'p1', decision: 'discard' });
    const second = await runWithChange(svc, 'Escribe siempre en ESPAÑOL.');
    expect((await eventsOf(second)).some((e) => e.type === 'memory.proposed')).toBe(false);
    const third = await runWithChange(svc, 'Usa títulos cortos');
    expect((await eventsOf(third)).some((e) => e.type === 'memory.proposed')).toBe(true);
  });

  it('[R76.4] no se pasa de 300 entradas activas', async () => {
    await store.saveProjectMemory(Array.from({ length: MEMORY_MAX_ACTIVE }, (_, i) => entry(`m${i}`)));
    const { svc } = app();
    await expect(svc.saveMemoryEntry({ kind: 'lesson', scope: 'project', title: 'Una más', text: 'x' })).rejects.toThrow(`${MEMORY_MAX_ACTIVE}`);
    // Archivar sí se puede.
    const after = await svc.saveMemoryEntry({ id: 'm0', kind: 'convention', scope: 'project', title: 'Título m0', text: 'Texto m0', status: 'archived' });
    expect(after.find((e) => e.id === 'm0')!.history.at(-1)).toMatchObject({ action: 'archived' });
  });

  it('[R76.12][R76.21] a mano queda como manual; el asistente, como suyo; restaurar se anota', async () => {
    const { svc } = app();
    const mine = await svc.saveMemoryEntry({ kind: 'lesson', scope: 'project', title: 'A mano', text: 'x' });
    expect(mine[0]!.source.origin).toBe('manual');
    const theirs = await svc.saveMemoryEntry({ kind: 'lesson', scope: 'project', title: 'Del asistente', text: 'y' }, 'assistant');
    expect(theirs[1]!.source.origin).toBe('assistant');
    expect(theirs[1]!.history[0]!.by).toBe('assistant');
    const id = mine[0]!.id;
    await svc.saveMemoryEntry({ id, kind: 'lesson', scope: 'project', title: 'A mano', text: 'x', status: 'archived' });
    const back = await svc.saveMemoryEntry({ id, kind: 'lesson', scope: 'project', title: 'A mano', text: 'x', status: 'active' });
    expect(back.find((e) => e.id === id)!.history.map((h) => h.action)).toEqual(['created', 'archived', 'restored']);
    await expect(svc.saveMemoryEntry({ kind: 'lesson', scope: 'project', title: 'Clave', text: 'sk-ant-abcdefghijklmnopqrstuvwx' })).rejects.toThrow('secreto');
  });
});

describe('SPEC-076 · lo que reciben los agentes', () => {
  it('[R76.13][R76.14][R76.16] el paso recibe la memoria de la copia de la ejecución y al terminar suma sus usos', async () => {
    await store.saveProjectMemory([entry('m1', { title: 'Español', text: 'Escribe en español' }), entry('m2', { scope: 'agent:otro' }), entry('fa', { kind: 'false-alarm', scope: 'agent:a' })]);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const agents = new MockAgent({ a: { output: 'Hecho', waitFor: gate } });
    const { svc } = app({ agents });
    const { runId } = await svc.start({ diagramId: 'p', order: 'Documenta' });
    for (let i = 0; i < 100 && agents.calls.length === 0; i++) await new Promise((r) => setTimeout(r, 5));
    // Lo que cambie mientras corre no llega a esta ejecución [R76.13].
    await store.saveProjectMemory([entry('m1', { title: 'Inglés', text: 'Escribe en inglés' })]);
    release();
    await svc.memoryProposed(runId);
    const req = agents.calls[0] as AgentRequest;
    expect(req.projectMemory).toMatchObject({ ids: ['m1'], scopes: ['agent:a', 'diagram:p', 'project'] });
    expect(req.projectMemory!.text).toContain('Español: Escribe en español');
    const events = await eventsOf(runId);
    expect(events.find((e) => e.type === 'agent.request')).toMatchObject({ projectMemory: ['m1'] });
    const m1 = (await store.loadProjectMemory()).find((e) => e.id === 'm1')!;
    expect(m1.uses).toBe(1);
    expect(m1.lastUsedAt).toBeDefined();
  });
});
