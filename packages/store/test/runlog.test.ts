import { cp, promises as fs } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { reduceRunState, transcriptOf } from '@orquestador/core';
import {
  ProjectStore,
  applyRetention,
  listRuns,
  readRunLog,
  readRunMeta,
  readRunDiagram,
  startLoggedRun,
  type RunMeta,
} from '../src';
import { chain, cleanupTmp, deferred, orchestrator, tmp } from './helpers';

cleanupTmp();

const usage = { inputTokens: 10, outputTokens: 5, costUsd: 0.01 };
const jsonRoundTrip = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const sleepMs = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function newProject() {
  return ProjectStore.create(await tmp(), { name: 'p' });
}

async function fakeRun(runsDir: string, meta: Partial<RunMeta> & { runId: string; startedAt: string }) {
  const dir = path.join(runsDir, meta.runId);
  await fs.mkdir(dir, { recursive: true });
  const full: RunMeta = {
    schemaVersion: 1,
    diagramId: 'd',
    status: 'succeeded',
    usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
    eventCount: 0,
    ...meta,
  };
  await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify(full));
  await fs.writeFile(path.join(dir, 'events.jsonl'), '');
}

describe('SPEC-008 · logs en disco', () => {
  it('[R8.8] persiste events.jsonl (una línea por evento, en orden) y meta.json', async () => {
    const project = await newProject();
    const { orch } = orchestrator({ a: { usage }, b: { usage } });
    const { handle, logged } = startLoggedRun(orch, project, chain(['a', 'b'], 'principal'), 'dibuja un pino', {});
    const result = await logged;
    const runDir = project.paths.runDir(handle.runId);

    const lines = (await fs.readFile(path.join(runDir, 'events.jsonl'), 'utf8')).trimEnd().split('\n');
    expect(lines).toHaveLength(result.events.length);
    const seqs = lines.map((l) => (JSON.parse(l) as { seq: number }).seq);
    expect(seqs).toEqual(seqs.map((_, i) => i + 1));

    const meta = await readRunMeta(runDir);
    expect(meta).toMatchObject({
      runId: handle.runId,
      diagramId: 'principal',
      status: 'succeeded',
      eventCount: result.events.length,
      order: 'dibuja un pino',
      startedAt: result.events[0]!.ts,
      finishedAt: result.events.at(-1)!.ts,
    });
    expect(meta.usage.inputTokens).toBe(20);
    expect(meta.usage.outputTokens).toBe(10);
    expect(meta.usage.costUsd).toBeCloseTo(0.02);
  });

  it('[R8.8] los eventos se escriben mientras la ejecución corre, no al final', async () => {
    const project = await newProject();
    const gate = deferred();
    const { orch } = orchestrator({ a: { waitFor: gate.promise } });
    const { handle, logged } = startLoggedRun(orch, project, chain(['a']), 'x');
    await sleepMs(30);
    const runDir = project.paths.runDir(handle.runId);
    const midway = (await fs.readFile(path.join(runDir, 'events.jsonl'), 'utf8')).trimEnd().split('\n');
    expect(midway.length).toBeGreaterThan(3);
    expect((JSON.parse(midway[0]!) as { type: string }).type).toBe('run.started');
    expect((await readRunMeta(runDir)).status).toBe('running');
    gate.resolve();
    await logged;
    expect((await readRunMeta(runDir)).status).toBe('succeeded');
  });

  it('[R8.8] el extracto de la orden y el log no contienen secretos', async () => {
    const project = await newProject();
    const { orch } = orchestrator();
    const { handle, logged } = startLoggedRun(orch, project, chain(['a']), 'usa la clave sk-ant-api03-ABCDEFGH12345678 por favor');
    await logged;
    const runDir = project.paths.runDir(handle.runId);
    const all = (await fs.readFile(path.join(runDir, 'events.jsonl'), 'utf8')) + (await fs.readFile(path.join(runDir, 'meta.json'), 'utf8'));
    expect(all).not.toContain('sk-ant-api03');
    expect(all).toContain('[REDACTED]');
  });

  it('[R8.9] un log cargado da el mismo estado y las mismas transcripciones que en vivo', async () => {
    const project = await newProject();
    const { orch } = orchestrator({ a: { tokens: ['hola ', 'mundo'], usage, files: ['a.txt'] } });
    const { handle, logged } = startLoggedRun(orch, project, chain(['a', 'b']), 'x');
    const result = await logged;
    const loaded = await readRunLog(project.paths.runDir(handle.runId));
    expect(loaded.truncated).toBe(false);
    expect(loaded.corruptLines).toBe(0);
    expect(loaded.events).toEqual(jsonRoundTrip(result.events));
    expect(reduceRunState(loaded.events)).toEqual(reduceRunState(jsonRoundTrip(result.events)));
    expect(transcriptOf(loaded.events, 'a').map((e) => e.type)).toEqual(
      transcriptOf(result.events, 'a').map((e) => e.type),
    );
  });

  it('[R8.9] ignora un último registro a medias tras un cierre inesperado', async () => {
    const project = await newProject();
    const { orch } = orchestrator();
    const { handle, logged } = startLoggedRun(orch, project, chain(['a']), 'x');
    const result = await logged;
    const file = path.join(project.paths.runDir(handle.runId), 'events.jsonl');
    const text = await fs.readFile(file, 'utf8');
    await fs.writeFile(file, text.slice(0, -15)); // corta el último registro (y su salto de línea)
    const loaded = await readRunLog(path.dirname(file));
    expect(loaded.truncated).toBe(true);
    expect(loaded.events).toHaveLength(result.events.length - 1);

    // una línea intermedia rota se salta y se cuenta
    const lines = text.trimEnd().split('\n');
    lines[2] = '{rota';
    await fs.writeFile(file, `${lines.join('\n')}\n`);
    const again = await readRunLog(path.dirname(file));
    expect(again.corruptLines).toBe(1);
    expect(again.truncated).toBe(false);
    expect(again.events).toHaveLength(result.events.length - 1);
  });

  it('[R10.6] lista las ejecuciones desde meta.json (sin events.jsonl), más recientes primero', async () => {
    const project = await newProject();
    const runs = project.paths.runsDir;
    await fakeRun(runs, { runId: 'r-viejo', startedAt: '2026-11-01T10:00:00.000Z' });
    await fakeRun(runs, { runId: 'r-medio', startedAt: '2026-11-02T10:00:00.000Z' });
    await fakeRun(runs, { runId: 'r-nuevo', startedAt: '2026-11-03T10:00:00.000Z', status: 'failed' });
    await fs.mkdir(path.join(runs, 'carpeta-sin-meta'));
    for (const id of ['r-viejo', 'r-medio', 'r-nuevo']) await fs.rm(path.join(runs, id, 'events.jsonl'));
    const list = await listRuns(runs);
    expect(list.map((r) => r.runId)).toEqual(['r-nuevo', 'r-medio', 'r-viejo']);
    expect(list[0]!.status).toBe('failed');
    expect(await listRuns(path.join(runs, 'no-existe'))).toEqual([]);
  });

  it('[R8.13] una ejecución en "running" que no está viva se lista como interrupted', async () => {
    const project = await newProject();
    const runs = project.paths.runsDir;
    await fakeRun(runs, { runId: 'zombi', startedAt: '2026-11-03T10:00:00.000Z', status: 'running' });
    expect((await listRuns(runs))[0]!.status).toBe('interrupted');
    expect((await listRuns(runs, { live: new Set(['zombi']) }))[0]!.status).toBe('running');
  });

  it('[R8.10] la retención borra lo antiguo y nunca las ejecuciones en curso', async () => {
    const project = await newProject();
    const runs = project.paths.runsDir;
    const day = (n: number) => `2026-11-0${n}T10:00:00.000Z`;
    await fakeRun(runs, { runId: 'r1', startedAt: day(1) });
    await fakeRun(runs, { runId: 'r2', startedAt: day(2), status: 'running' }); // en curso (viva)
    await fakeRun(runs, { runId: 'r3', startedAt: day(3) });
    await fakeRun(runs, { runId: 'r4', startedAt: day(4) });
    await fakeRun(runs, { runId: 'r5', startedAt: day(5) });
    const live = new Set(['r2']);

    const byCount = await applyRetention(runs, { maxRuns: 2, live });
    expect(byCount.sort()).toEqual(['r1', 'r3']);
    expect((await fs.readdir(runs)).sort()).toEqual(['r2', 'r4', 'r5']);

    const byAge = await applyRetention(runs, {
      maxAgeMs: 2 * 24 * 3600 * 1000,
      now: new Date('2026-11-06T12:00:00.000Z'),
      live,
    });
    expect(byAge).toEqual(['r4']); // r5 es reciente; r2 está en curso aunque sea antigua
    expect((await fs.readdir(runs)).sort()).toEqual(['r2', 'r5']);

    // sin política, no se borra nada
    expect(await applyRetention(runs, { live })).toEqual([]);
  });

  it('[R10.4] las ejecuciones de un proyecto copiado se leen igual', async () => {
    const project = await newProject();
    const { orch } = orchestrator();
    const { handle, logged } = startLoggedRun(orch, project, chain(['a']), 'x');
    const result = await logged;
    const copyRoot = path.join(await tmp(), 'movido');
    await new Promise<void>((res, rej) => cp(project.paths.root, copyRoot, { recursive: true }, (e) => (e ? rej(e) : res())));
    const copy = await ProjectStore.open(copyRoot);
    const runs = await listRuns(copy.paths.runsDir);
    expect(runs.map((r) => r.runId)).toEqual([handle.runId]);
    expect((await readRunLog(copy.paths.runDir(handle.runId))).events).toHaveLength(result.events.length);
  });
});

describe('copia del diagrama y uso a medias (SPEC-035) [R35.15][R35.16]', () => {
  it('[R35.16] al arrancar guarda diagram.json y el nombre del diagrama en meta.json', async () => {
    const project = await newProject();
    const { orch } = orchestrator({ a: {} });
    const d = { ...chain(['a'], 'principal'), name: 'Mi diagrama' };
    const { handle, logged } = startLoggedRun(orch, project, d, 'x');
    await logged;
    const runDir = project.paths.runDir(handle.runId);
    expect(await readRunDiagram(runDir)).toEqual(jsonRoundTrip(d));
    expect((await readRunMeta(runDir)).diagramName).toBe('Mi diagrama');
    expect(await readRunDiagram(path.join(runDir, 'no-existe'))).toBeNull();
  });

  it('[R35.15] el uso se guarda en meta.json al momento, aunque la ejecución no termine', async () => {
    const project = await newProject();
    const gate = deferred();
    const { orch } = orchestrator({ a: { usage }, b: { waitFor: gate.promise } });
    const { handle, logged } = startLoggedRun(orch, project, chain(['a', 'b']), 'x');
    const runDir = project.paths.runDir(handle.runId);
    for (let i = 0; i < 100 && (await readRunMeta(runDir)).usage.inputTokens === 0; i++) await sleepMs(5);
    const meta = await readRunMeta(runDir);
    expect(meta.status).toBe('running');
    expect(meta.usage).toMatchObject({ inputTokens: 10, outputTokens: 5 });
    gate.resolve();
    await logged;
  });
});
