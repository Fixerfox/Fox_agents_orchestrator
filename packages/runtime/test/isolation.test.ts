import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CONFLICT_PREVIEW_KEY, MockAgent, MockDecider, Orchestrator, defaultSettings, type AgentAdapter, type BranchSpaces, type Diagram } from '@orquestador/core';
import { ProjectStore } from '@orquestador/store';
import { BranchSpaceManager } from '@orquestador/workspace';
import { RunService, createEngineOrchestrator } from '../src';
import { portsOf } from './ports';

/** Entrada → (web, api) → Salida. */
const D: Diagram = {
  id: 'abanico',
  name: 'Abanico',
  schemaVersion: 1,
  nodes: [
    { id: 'entry', kind: 'entry' },
    { id: 'web', kind: 'agent', agentId: 'web', label: 'Web' },
    { id: 'api', kind: 'agent', agentId: 'api', label: 'Api' },
    { id: 'output', kind: 'output' },
  ],
  edges: [
    { id: 'e1', from: 'entry', to: 'web' },
    { id: 'e2', from: 'entry', to: 'api' },
    { id: 'e3', from: 'web', to: 'output' },
    { id: 'e4', from: 'api', to: 'output' },
  ],
};

let dir: string;
let store: ProjectStore;
beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'orq-riso-'));
  store = await ProjectStore.create(dir, { name: 'p' });
  await store.diagrams.save(D);
});
afterEach(() => fs.rm(dir, { recursive: true, force: true }));

/** Un agente que escribe de verdad en su carpeta y, mientras `hold`, no termina. */
function writer(file: string, text: string, hold?: Promise<void>): AgentAdapter {
  return {
    async *run(req) {
      const root = req.workspace?.dir ?? dir;
      await fs.writeFile(join(root, file), text);
      yield { type: 'file', path: file, change: 'created' };
      if (hold) await hold;
      yield { type: 'result', text: 'hecho', files: [file] };
    },
  };
}

describe('SPEC-073 · ramas aisladas en la app', () => {
  it('[R73.2] con Ajustes encendido (por defecto) cada ejecución tiene sus espacios; apagado, ninguno', () => {
    let isolate = true;
    const asked: string[] = [];
    const spaces = (runId: string) => (asked.push(runId), {} as BranchSpaces);
    const agent = new MockAgent({});
    const engine = { id: 'mock', adapter: agent, decider: new MockDecider() };
    const settings = () => ({ ...defaultSettings(), engine: 'mock' as never, ...(isolate ? {} : { isolateBranches: false }) });
    const orch = createEngineOrchestrator({ library: { agents: async () => [], skills: async () => [], contexts: async () => [], mcp: async () => [], diagram: async () => D } as never, settings, spaces }, [engine as never]);
    const deps = (orch as unknown as { deps: { spaces(runId: string): unknown } }).deps;
    expect(deps.spaces('r1')).toBeDefined();
    isolate = false;
    expect(deps.spaces('r2')).toBeUndefined();
    expect(asked).toEqual(['r1']);
  });

  it('[R73.19][R73.11] la vista previa de un paso en marcha lee de su espacio; al juntarse, todo está en la carpeta', async () => {
    let release!: () => void;
    const hold = new Promise<void>((r) => (release = r));
    const managers: BranchSpaceManager[] = [];
    const adapters: Record<string, AgentAdapter> = { web: writer('web.md', 'la web', hold), api: writer('api.ts', 'la api') };
    const orch = new Orchestrator({
      getAdapter: (id) => adapters[id]!,
      decider: new MockDecider(),
      spaces: (runId) => {
        const m = new BranchSpaceManager({ workRoot: dir, runDir: store.paths.runDir(runId), spacesRoot: join(dir, '..', `${basename(dir)}-spaces`) });
        managers.push(m);
        return m;
      },
    });
    const svc = new RunService({ ...portsOf(store), stepDir: (_runId, key) => managers[0]?.dirForStep(key) }, orch);
    const { runId } = await svc.start({ diagramId: 'abanico', order: 'haz' });
    for (let i = 0; i < 100 && !managers[0]?.dirForStep('web'); i++) await new Promise((r) => setTimeout(r, 10));
    for (let i = 0; i < 100; i++) {
      const p = await svc.previewFile(runId, 'web', 'web.md').catch(() => undefined);
      if (p?.kind === 'markdown') break;
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(await svc.previewFile(runId, 'web', 'web.md')).toMatchObject({ kind: 'markdown', text: 'la web', source: 'live' });
    // Mientras la rama no termina, la carpeta no tiene lo suyo.
    await expect(fs.access(join(dir, 'web.md'))).rejects.toThrow();
    release();
    await svc.settled(runId);
    expect(await fs.readFile(join(dir, 'web.md'), 'utf8')).toBe('la web');
    expect(await fs.readFile(join(dir, 'api.ts'), 'utf8')).toBe('la api');
    expect(await svc.previewFile(runId, 'web', 'web.md')).toMatchObject({ text: 'la web', source: 'run' });
    await fs.rm(join(dir, '..', `${basename(dir)}-spaces`), { recursive: true, force: true });
  });

  it('[R73.16] las dos versiones de un conflicto se pueden previsualizar', async () => {
    const svc = new RunService(portsOf(store), new Orchestrator({ getAdapter: () => new MockAgent({}), decider: new MockDecider() }));
    const { runId } = await svc.start({ diagramId: 'abanico', order: 'haz' });
    await svc.settled(runId);
    const saved = join(store.paths.runDir(runId), 'conflicts', 'Api', 'rama');
    await fs.mkdir(saved, { recursive: true });
    await fs.writeFile(join(saved, 'config.json'), '{"de":"api"}');
    expect(await svc.previewFile(runId, CONFLICT_PREVIEW_KEY, 'Api/rama/config.json')).toMatchObject({ kind: 'text', text: '{"de":"api"}' });
    expect(await svc.previewFile(runId, CONFLICT_PREVIEW_KEY, 'Api/rama/nada.json')).toEqual({ path: 'Api/rama/nada.json', kind: 'missing' });
  });
});
