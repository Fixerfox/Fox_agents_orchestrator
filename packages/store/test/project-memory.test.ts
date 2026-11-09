import { promises as fs } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { MemoryEntry } from '@orquestador/core';
import { ProjectStore, appendRunEvent, readRunLog, readRunMeta, startLoggedRun } from '../src';
import { chain, cleanupTmp, orchestrator, tmp } from './helpers';

cleanupTmp();

const T = '2026-11-08T10:00:00.000Z';
const entry = (id: string, o: Partial<MemoryEntry> = {}): MemoryEntry => ({ id, kind: 'convention', scope: 'project', title: `Título ${id}`, text: `Texto ${id}`, status: 'active', source: { origin: 'manual' }, createdAt: T, updatedAt: T, uses: 0, history: [{ at: T, action: 'created', by: 'user' }], ...o });

describe('SPEC-076 · la memoria del proyecto en disco', () => {
  it('[R76.2] entries.json con versión y MEMORIA.md legible; sin archivo, ninguna', async () => {
    const project = await ProjectStore.create(await tmp(), { name: 'p' });
    expect(await project.loadProjectMemory()).toEqual([]);
    await project.saveProjectMemory([entry('a', { title: 'Usa pnpm' }), entry('b', { scope: 'agent:dev', title: 'Del agente' })]);
    const dir = path.join(project.paths.orq, 'memory');
    const json = JSON.parse(await fs.readFile(path.join(dir, 'entries.json'), 'utf8')) as { schemaVersion: number; entries: MemoryEntry[] };
    expect(json.schemaVersion).toBe(1);
    expect(json.entries.map((e) => e.id)).toEqual(['a', 'b']);
    const md = await fs.readFile(path.join(dir, 'MEMORIA.md'), 'utf8');
    expect(md).toContain('# Memoria del proyecto');
    expect(md).toContain('## Agente dev');
    expect(md).toContain('**Usa pnpm**');
    expect((await project.loadProjectMemory()).map((e) => e.title)).toEqual(['Usa pnpm', 'Del agente']);
  });

  it('[R76.3] una entrada activa que parece una clave se rechaza; en las archivadas se oculta', async () => {
    const project = await ProjectStore.create(await tmp(), { name: 'p' });
    await expect(project.saveProjectMemory([entry('a', { text: 'la clave es sk-ant-abcdefghijklmnopqrstuvwx' })])).rejects.toThrow('secreto');
    await project.saveProjectMemory([entry('a', { status: 'archived', text: 'vieja ANTHROPIC_API_KEY=sk-ant-abcdefghijklmnopqrstuvwx' })]);
    const raw = await fs.readFile(path.join(project.paths.orq, 'memory', 'entries.json'), 'utf8');
    expect(raw).not.toContain('sk-ant-abcdefghijklmnop');
  });

  it('[R76.3] si la carpeta de memoria apunta fuera de .orquestador, no se lee ni escribe', async () => {
    const project = await ProjectStore.create(await tmp(), { name: 'p' });
    const outside = await tmp('orq-fuera-');
    try {
      await fs.symlink(outside, path.join(project.paths.orq, 'memory'), 'dir');
    } catch {
      return; // Sin permiso para enlaces (Windows sin modo desarrollador): no hay nada que probar.
    }
    await expect(project.saveProjectMemory([entry('a')])).rejects.toThrow('no está donde debe');
    await expect(project.loadProjectMemory()).rejects.toThrow('no está donde debe');
    expect(await fs.readdir(outside)).toEqual([]);
  });

  it('[R76.8] un evento después de run.finished queda en el registro, con la meta y el uso al día', async () => {
    const project = await ProjectStore.create(await tmp(), { name: 'p' });
    const { orch } = orchestrator({ a: { output: 'hecho' } });
    const { handle, logged } = startLoggedRun(orch, project, chain(['a']), 'x');
    await logged;
    const runDir = project.paths.runDir(handle.runId);
    const before = await readRunMeta(runDir);
    await appendRunEvent(runDir, { type: 'memory.proposed', proposals: [], usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.02 } });
    const { events } = await readRunLog(runDir);
    expect(events.at(-2)!.type).toBe('run.finished');
    expect(events.at(-1)).toMatchObject({ type: 'memory.proposed', seq: before.eventCount + 1 });
    const after = await readRunMeta(runDir);
    expect(after.eventCount).toBe(before.eventCount + 1);
    expect(after.usage.costUsd).toBeCloseTo(before.usage.costUsd + 0.02);
    expect(after.status).toBe(before.status);
  });
});

describe('SPEC-077 · en disco', () => {
  it('[R77.19] la meta de cada ejecución cuenta sus reintentos', async () => {
    const project = await ProjectStore.create(await tmp(), { name: 'p' });
    const { orch } = orchestrator({ a: { failTimes: 2 } });
    const { handle, logged } = startLoggedRun(orch, project, chain(['a']), 'x');
    await logged;
    expect((await readRunMeta(project.paths.runDir(handle.runId))).retries).toBe(2);
  });
});
