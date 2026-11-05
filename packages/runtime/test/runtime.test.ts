import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MockAgent,
  MockDecider,
  Orchestrator,
  reduceRunState,
  type Diagram,
  type RunEvent,
} from '@orquestador/core';
import { ProjectStore } from '@orquestador/store';
import { Batcher, MAX_READ_BYTES, RunError, RunService, createDemoOrchestrator } from '../src';

const D = (nodes: Diagram['nodes'], edges: Diagram['edges']): Diagram => ({ id: 'd', name: 'D', schemaVersion: 1, nodes, edges });
const ENTRY = { id: 'entry', kind: 'entry' as const };
const OUT = { id: 'output', kind: 'output' as const };
const A = { id: 'a', kind: 'agent' as const, agentId: 'a' };
const simple = () =>
  D([ENTRY, A, OUT], [
    { id: 'e1', from: 'entry', to: 'a' },
    { id: 'e2', from: 'a', to: 'output' },
  ]);

let dir: string;
let store: ProjectStore;

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'orq-rt-'));
  store = await ProjectStore.create(dir, { name: 'p' });
});
afterEach(() => fs.rm(dir, { recursive: true, force: true }));

function service(scripts: ConstructorParameters<typeof MockAgent>[0] = { a: { output: 'hecho', tokens: ['he', 'cho'] } }) {
  const agent = new MockAgent(scripts);
  const orch = new Orchestrator({ getAdapter: () => agent, decider: new MockDecider() });
  return { svc: new RunService(store, orch), agent };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('arranque [R20.1]', () => {
  it('[R20.1] ejecuta un diagrama del proyecto y deja el registro en disco', async () => {
    const { svc } = service();
    await store.diagrams.save(simple());
    const { runId } = await svc.start({ diagramId: 'd', order: 'hola' });
    await svc.settled(runId);
    const sub = await svc.subscribe(runId, 1, () => {});
    expect(reduceRunState(sub.backlog).status).toBe('succeeded');
    const log = await fs.readFile(join(store.paths.runDir(runId), 'events.jsonl'), 'utf8');
    expect(log.trim().split('\n').length).toBe(sub.backlog.length);
  });

  it('[R20.1] rechaza un diagrama con problemas sin crear ejecución', async () => {
    const { svc } = service();
    await store.diagrams.save(D([ENTRY, A, OUT], [{ id: 'e1', from: 'entry', to: 'output' }]));
    await expect(svc.start({ diagramId: 'd', order: 'x' })).rejects.toMatchObject({ code: 'invalid-diagram' });
    expect(await svc.list()).toEqual([]);
  });

  it('[R20.1] un diagrama inexistente da error del proyecto', async () => {
    const { svc } = service();
    await expect(svc.start({ diagramId: 'nada', order: 'x' })).rejects.toMatchObject({ code: 'not-found' });
  });

  it('[R20.1] aplica el presupuesto opcional', async () => {
    const { svc } = service({ a: { output: 'x', usage: { inputTokens: 500, outputTokens: 500 } } });
    await store.diagrams.save(simple());
    const { runId } = await svc.start({ diagramId: 'd', order: 'x', maxTokens: 100 });
    await svc.settled(runId);
    const { backlog } = await svc.subscribe(runId, 1, () => {});
    const state = reduceRunState(backlog);
    expect(state.status).toBe('failed');
    expect(state.reason).toBe('budget_exceeded');
  });
});

describe('control [R20.2][R20.5]', () => {
  it('[R20.2] pausar, reanudar y cancelar actúan sobre la ejecución', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { svc } = service({ a: { output: 'x', waitFor: gate } });
    await store.diagrams.save(simple());
    const { runId } = await svc.start({ diagramId: 'd', order: 'x' });
    svc.pause(runId);
    svc.resume(runId);
    svc.cancel(runId);
    release();
    await svc.settled(runId);
    const { backlog } = await svc.subscribe(runId, 1, () => {});
    expect(backlog.map((e) => e.type)).toEqual(expect.arrayContaining(['run.paused', 'run.resumed', 'run.cancelled']));
    expect(reduceRunState(backlog).status).toBe('cancelled');
  });

  it('[R20.2] un runId desconocido devuelve not-found', async () => {
    const { svc } = service();
    expect(() => svc.pause('x')).toThrow(RunError);
    expect(() => svc.answer('x', 'q', 'a')).toThrow(/No existe/);
    await expect(svc.subscribe('no-existe', 1, () => {})).rejects.toMatchObject({ code: 'not-found' });
  });

  it('[R20.2][R20.5] responde preguntas pendientes y devuelve true/false', async () => {
    const { svc } = service({ a: { output: 'ok', asks: [{ question: '¿Cuál?', options: ['1', '2'] }] } });
    await store.diagrams.save(simple());
    const { runId } = await svc.start({ diagramId: 'd', order: 'x' });
    await vi.waitFor(() => expect(svc.pending(runId)).toHaveLength(1));
    const q = svc.pending(runId)[0]!;
    expect(q).toMatchObject({ nodeId: 'a', text: '¿Cuál?', options: ['1', '2'] });
    expect(svc.answer(runId, 'nope', 'x')).toBe(false);
    expect(svc.answer(runId, q.questionId, '1')).toBe(true);
    expect(svc.answer(runId, q.questionId, '1')).toBe(false);
    await svc.settled(runId);
    expect(svc.pending(runId)).toEqual([]);
  });

  it('[R20.5] lista las ejecuciones marcando las vivas', async () => {
    let release!: () => void;
    const { svc } = service({ a: { output: 'x', waitFor: new Promise<void>((r) => (release = r)) } });
    await store.diagrams.save(simple());
    const { runId } = await svc.start({ diagramId: 'd', order: 'x' });
    await vi.waitFor(async () => expect((await svc.list()).map((r) => r.runId)).toEqual([runId]));
    expect((await svc.list())[0]!.status).toBe('running');
    release();
    await svc.settled(runId);
    expect((await svc.list())[0]!.status).toBe('succeeded');
  });
});

describe('suscripción [R20.3]', () => {
  it('[R20.3] historial + vivo sin huecos ni duplicados y en orden', async () => {
    let release!: () => void;
    const { svc } = service({ a: { output: 'x', tokens: ['a', 'b', 'c'], waitFor: new Promise<void>((r) => (release = r)) } });
    await store.diagrams.save(simple());
    const { runId } = await svc.start({ diagramId: 'd', order: 'x' });
    await vi.waitFor(async () => expect((await svc.subscribe(runId, 1, () => {})).backlog.length).toBeGreaterThan(2));
    const live: RunEvent[] = [];
    const { backlog, unsubscribe } = await svc.subscribe(runId, 1, (e) => live.push(e));
    release();
    await svc.settled(runId);
    unsubscribe();
    const seqs = [...backlog, ...live].map((e) => e.seq);
    expect(seqs).toEqual(Array.from({ length: seqs.length }, (_, i) => i + 1));
    expect(reduceRunState([...backlog, ...live]).status).toBe('succeeded');
  });

  it('[R20.3] reconectar desde seq+1 entrega solo lo que falta', async () => {
    const { svc } = service();
    await store.diagrams.save(simple());
    const { runId } = await svc.start({ diagramId: 'd', order: 'x' });
    await svc.settled(runId);
    const all = (await svc.subscribe(runId, 1, () => {})).backlog;
    const rest = (await svc.subscribe(runId, 4, () => {})).backlog;
    expect(rest.map((e) => e.seq)).toEqual(all.slice(3).map((e) => e.seq));
    await expect(svc.subscribe(runId, 0, () => {})).rejects.toMatchObject({ code: 'bad-request' });
  });

  it('[R20.3] una ejecución de una sesión anterior se lee del disco', async () => {
    const first = service();
    await store.diagrams.save(simple());
    const { runId } = await first.svc.start({ diagramId: 'd', order: 'x' });
    await first.svc.settled(runId);
    const second = service();
    const { backlog } = await second.svc.subscribe(runId, 1, () => {});
    expect(reduceRunState(backlog).status).toBe('succeeded');
    expect((await second.svc.list())[0]!.runId).toBe(runId);
  });
});

describe('lotes [R20.4]', () => {
  it('[R20.4][R15.7] agrupa por ventana, conserva el orden y flush entrega lo pendiente', () => {
    vi.useFakeTimers();
    try {
      const out: number[][] = [];
      const b = new Batcher<number>((x) => out.push(x), 50);
      b.push(1);
      b.push(2);
      vi.advanceTimersByTime(49);
      expect(out).toEqual([]);
      vi.advanceTimersByTime(1);
      expect(out).toEqual([[1, 2]]);
      b.push(3);
      b.flush();
      b.flush();
      b.push(4);
      b.dispose();
      expect(out).toEqual([[1, 2], [3], [4]]);
      vi.advanceTimersByTime(500);
      expect(out).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('[R20.4][R15.7] con muchos eventos no se pierde ninguno', () => {
    vi.useFakeTimers();
    try {
      const out: number[] = [];
      const b = new Batcher<number>((x) => out.push(...x), 50);
      for (let i = 0; i < 5000; i++) {
        b.push(i);
        if (i % 700 === 0) vi.advanceTimersByTime(60);
      }
      b.flush();
      expect(out).toEqual(Array.from({ length: 5000 }, (_, i) => i));
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('resultados [R20.6]', () => {
  async function withOutput() {
    const { svc } = service();
    await store.diagrams.save(simple());
    const { runId } = await svc.start({ diagramId: 'd', order: 'x' });
    await svc.settled(runId);
    const out = join(store.paths.runDir(runId), 'output');
    await fs.mkdir(join(out, 'src'), { recursive: true });
    await fs.writeFile(join(out, 'src', 'a.ts'), 'const x = 1;');
    await fs.writeFile(join(out, 'b.txt'), 'x'.repeat(MAX_READ_BYTES + 10));
    await fs.writeFile(join(store.paths.runDir(runId), 'meta-secreto.txt'), 'no');
    return { svc, runId };
  }

  it('[R20.6] lista y lee archivos de output/', async () => {
    const { svc, runId } = await withOutput();
    expect(await svc.listOutput(runId)).toEqual([
      { path: 'b.txt', size: MAX_READ_BYTES + 10 },
      { path: 'src/a.ts', size: 12 },
    ]);
    expect(await svc.readOutput(runId, 'src/a.ts')).toEqual({ text: 'const x = 1;', truncated: false });
  });

  it('[R20.6] trunca lo que supera el límite e indica que se truncó', async () => {
    const { svc, runId } = await withOutput();
    const r = await svc.readOutput(runId, 'b.txt');
    expect(r.truncated).toBe(true);
    expect(r.text.length).toBe(MAX_READ_BYTES);
  });

  it('[R20.6] rechaza rutas que salen de output/ y archivos inexistentes', async () => {
    const { svc, runId } = await withOutput();
    for (const p of ['../meta-secreto.txt', '../../project.json', '/etc/passwd', '..', '']) {
      await expect(svc.readOutput(runId, p)).rejects.toMatchObject({ code: 'bad-request' });
    }
    await expect(svc.readOutput(runId, 'nada.txt')).rejects.toMatchObject({ code: 'not-found' });
    expect(await svc.listOutput('sin-salida')).toEqual([]);
  });
});

describe('demostración [R20.7]', () => {
  it('[R20.7] el orquestador demo completa un diagrama con pregunta y es determinista', async () => {
    const ex = D(
      [ENTRY, { id: 'c', kind: 'agent', agentId: 'creador' }, { id: 's', kind: 'agent', agentId: 'sprites' }, OUT],
      [
        { id: 'e1', from: 'entry', to: 'c' },
        { id: 'e2', from: 'c', to: 's' },
        { id: 'e3', from: 's', to: 'output' },
      ],
    );
    await store.diagrams.save(ex);
    const svc = new RunService(store, createDemoOrchestrator());
    const { runId } = await svc.start({ diagramId: 'd', order: 'hazme un juego' });
    await vi.waitFor(() => expect(svc.pending(runId)).toHaveLength(1));
    expect(svc.pending(runId)[0]!.options).toEqual(['Pixel art', 'Vectorial', 'Realista']);
    svc.answer(runId, svc.pending(runId)[0]!.questionId, 'Pixel art');
    await svc.settled(runId);
    const { backlog } = await svc.subscribe(runId, 1, () => {});
    expect(reduceRunState(backlog).status).toBe('succeeded');
    await sleep(0);
  });
});

describe('diagrama del momento y estado verdadero (SPEC-035) [R35.13][R35.16]', () => {
  it('[R35.16] la ejecución conserva el diagrama y su nombre aunque después cambien', async () => {
    const { svc } = service();
    await store.diagrams.save({ ...simple(), name: 'Primera versión' });
    const { runId } = await svc.start({ diagramId: 'd', order: 'hola' });
    await svc.settled(runId);
    await store.diagrams.save({ ...simple(), name: 'Renombrado', nodes: simple().nodes.map((n) => (n.id === 'a' ? { ...n, label: 'Otro' } : n)) });
    const copy = await svc.runDiagram(runId);
    expect(copy?.name).toBe('Primera versión');
    expect(copy?.nodes.find((n) => n.id === 'a')?.label).toBeUndefined();
    expect((await svc.list())[0]).toMatchObject({ runId, diagramName: 'Primera versión' });
  });

  it('[R35.16] una ejecución antigua sin copia devuelve null', async () => {
    await fs.mkdir(store.paths.runDir('vieja'), { recursive: true });
    expect(await service().svc.runDiagram('vieja')).toBeNull();
  });

  it('[R35.13] una ejecución que figuraba en marcha y no está viva se lista como interrumpida', async () => {
    const { svc } = service();
    await store.diagrams.save(simple());
    const { runId } = await svc.start({ diagramId: 'd', order: 'hola' });
    await svc.settled(runId);
    const meta = JSON.parse(await fs.readFile(join(store.paths.runDir(runId), 'meta.json'), 'utf8')) as Record<string, unknown>;
    await fs.writeFile(join(store.paths.runDir(runId), 'meta.json'), JSON.stringify({ ...meta, status: 'running', finishedAt: undefined }));
    // Otro servicio (la app reabierta) no la está ejecutando.
    expect((await service().svc.list())[0]!.status).toBe('interrupted');
  });
});

describe('reanudar y cancelar [R41.2][R41.3]', () => {
  const AB = () =>
    D([ENTRY, { id: 'a', kind: 'agent', agentId: 'a' }, { id: 'b', kind: 'agent', agentId: 'b' }, OUT], [
      { id: 'e1', from: 'entry', to: 'a' },
      { id: 'e2', from: 'a', to: 'b' },
      { id: 'e3', from: 'b', to: 'output' },
    ]);
  function flaky() {
    const calls: string[] = [];
    let failB = true;
    const adapter = {
      async *run(req: { agentId: string; input: { text: string } }) {
        calls.push(req.agentId);
        if (req.agentId === 'b' && failB) throw Object.assign(new Error('se cayó'), { retriable: false });
        yield { type: 'result', text: `hecho ${req.agentId}` };
      },
    };
    const orch = new Orchestrator({ getAdapter: () => adapter as never, decider: new MockDecider(), retry: { maxAttempts: 1, baseDelayMs: 0 } } as never);
    return { svc: new RunService(store, orch), calls, fix: () => void (failB = false) };
  }

  it('[R41.2] reanuda una fallida con la misma entrada, reutiliza lo hecho y enlaza las dos; no se reanuda dos veces', async () => {
    await store.diagrams.save(AB());
    const { svc, calls, fix } = flaky();
    const first = await svc.start({ diagramId: 'd', order: 'pedido' });
    await svc.settled(first.runId);
    expect((await svc.list()).find((m) => m.runId === first.runId)?.status).toBe('failed');
    fix();
    calls.length = 0;
    const second = await svc.resumeRun(first.runId);
    await svc.settled(second.runId);
    expect(calls).toEqual(['b']);
    const list = await svc.list();
    expect(list.find((m) => m.runId === second.runId)).toMatchObject({ status: 'succeeded', resumedFrom: first.runId });
    expect(list.find((m) => m.runId === first.runId)).toMatchObject({ resumedBy: second.runId });
    const sub = await svc.subscribe(second.runId, 1, () => {});
    expect(sub.backlog.find((e) => e.type === 'node.reused')).toMatchObject({ nodeId: 'a', fromRunId: first.runId });
    expect(sub.backlog.find((e) => e.type === 'node.started' && e.nodeId === 'entry')).toMatchObject({ input: { text: 'pedido' } });
    await expect(svc.resumeRun(first.runId)).rejects.toThrow(/ya se reanudó/);
    await expect(svc.resumeRun(second.runId)).rejects.toThrow(/Solo se reanuda/);
  });

  it('[R41.3] cancelar cierra una interrumpida (registro cortado incluido) y no toca una terminada', async () => {
    const runDir = store.paths.runDir('r-cut');
    await fs.mkdir(runDir, { recursive: true });
    const started = { runId: 'r-cut', seq: 1, ts: '2026-11-05T10:00:00.000Z', type: 'run.started', diagramId: 'd' };
    await fs.writeFile(join(runDir, 'events.jsonl'), `${JSON.stringify(started)}\n{"runId":"r-cut","seq":2,"ty`);
    await fs.writeFile(join(runDir, 'meta.json'), JSON.stringify({ version: 1, runId: 'r-cut', diagramId: 'd', startedAt: started.ts, status: 'running', eventCount: 1 }));
    const { svc } = service();
    expect((await svc.list()).find((m) => m.runId === 'r-cut')?.status).toBe('interrupted');
    expect(await svc.dismiss('r-cut')).toBe(true);
    const meta = (await svc.list()).find((m) => m.runId === 'r-cut');
    expect(meta).toMatchObject({ status: 'cancelled', reason: 'Se interrumpió y la cancelaste' });
    const lines = (await fs.readFile(join(runDir, 'events.jsonl'), 'utf8')).trim().split('\n');
    expect(JSON.parse(lines.at(-1)!)).toMatchObject({ type: 'run.finished', status: 'cancelled' });
    expect(await svc.dismiss('r-cut')).toBe(false);
  });
});
