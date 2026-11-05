import { promises as fs } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MockAgent, MockDecider, Orchestrator } from '@orquestador/core';
import { ProjectStore, readRunMeta, startLoggedRun } from '../src';
import { chain, cleanupTmp, tmp } from './helpers';

cleanupTmp();

function orch(transform?: () => string) {
  return new Orchestrator({
    getAdapter: () => new MockAgent({ a: { output: 'Hecho en http://localhost:5173', files: ['web/index.html'] } }),
    decider: new MockDecider(transform ? { transform } : {}),
    sleep: async () => {},
  });
}

describe('SPEC-046 · entregable en disco', () => {
  it('[R46.11] escribe <archivo>.md y .json en output/ y no deja avisos si todo salió', async () => {
    const project = await ProjectStore.create(await tmp(), { name: 'p' });
    const d = { ...chain(['a']), deliverable: { items: [{ kind: 'links' as const }, { kind: 'json' as const }], fileName: 'web-final' } };
    const { handle, logged } = startLoggedRun(orch(), project, d, 'haz la web');
    expect((await logged).status).toBe('succeeded');
    const out = path.join(project.paths.runDir(handle.runId), 'output');
    const md = await fs.readFile(path.join(out, 'web-final.md'), 'utf8');
    expect(md.startsWith('# Entregable')).toBe(true);
    expect(md).toContain('`web/index.html`');
    expect(JSON.parse(await fs.readFile(path.join(out, 'web-final.json'), 'utf8'))).toEqual({});
    expect((await readRunMeta(project.paths.runDir(handle.runId))).warnings).toBeUndefined();
  });

  it('[R46.11] si falta algo, la ejecución termina bien con el aviso en meta.json', async () => {
    const project = await ProjectStore.create(await tmp(), { name: 'p' });
    const d = { ...chain(['a']), deliverable: { items: [{ kind: 'summary' as const }] } };
    const { handle, logged } = startLoggedRun(orch(() => ''), project, d, 'x');
    expect((await logged).status).toBe('succeeded');
    const dir = project.paths.runDir(handle.runId);
    expect((await readRunMeta(dir)).warnings).toEqual(['El entregable no se pudo completar del todo (Resumen).']);
    expect(await fs.readFile(path.join(dir, 'output', 'entregable.md'), 'utf8')).toContain('No se pudo completar');
  });
});
