import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CHANNELS, ContractError, parseRequest } from '@orquestador/editor';
import { createDemoOrchestrator } from '@orquestador/runtime';
import { ProjectTrustStore, projectKey } from '@orquestador/store';
import { checkRunnerFor } from '../src/main/checks';
import { createProject, type OrchestratorContext } from '../src/main/composition';
import { DesktopHandlers } from '../src/main/handlers';

let dir: string;
let picks: (string | null)[];
let ctxs: OrchestratorContext[];
let h: DesktopHandlers;
const project = () => join(dir, 'clonado');
const trustFile = () => join(dir, 'datos', 'trust.json');

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'orq-trust-ipc-'));
  picks = [];
  ctxs = [];
  h = new DesktopHandlers({
    pickFolder: async () => picks.shift() ?? null,
    createOrchestrator: (ctx) => (ctxs.push(ctx), createDemoOrchestrator()),
    trust: new ProjectTrustStore(trustFile()),
    trustDir: join(dir, 'datos', 'trust'),
  });
});
afterEach(async () => {
  h.dispose();
  await fs.rm(dir, { recursive: true, force: true });
});

const val = <T,>(r: unknown) => {
  const x = r as { ok: boolean; value?: T; error?: unknown };
  if (!x.ok) throw new Error(JSON.stringify(x.error));
  return x.value as T;
};
const openWith = async (settings: unknown) => {
  await fs.mkdir(join(project(), '.claude'), { recursive: true });
  await fs.writeFile(join(project(), '.claude', 'settings.json'), JSON.stringify(settings));
  picks.push(project());
  val(await h.invoke(CHANNELS.createProject, undefined));
};
const trustInfo = async () => val<{ items: { key: string; detail: string }[]; decision: string | null }>(await h.invoke(CHANNELS.projectTrust, undefined));

describe('SPEC-088 · decisión guardada', () => {
  it('[R88.3] la decisión vive en los datos de la app y solo vale con la misma huella', async () => {
    const store = new ProjectTrustStore(trustFile());
    expect(await store.decision('/p', 'h1')).toBeNull();
    await store.set('/p', 'h1', 'trusted');
    expect(await store.decision('/p', 'h1')).toBe('trusted');
    expect(await store.decision('/p', 'h2')).toBeNull();
    expect(await store.decision('/otro', 'h1')).toBeNull();
    expect(projectKey('C:\\Juego', 'win32')).toBe(projectKey('c:\\juego', 'win32'));
    expect(projectKey('/p')).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('SPEC-088 · IPC y motor', () => {
  it('[R88.6][R88.4] E88.a: el proyecto clonado enseña lo que trae; hasta confiar, el motor no carga su configuración', async () => {
    await openWith({ hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'x' }] }] }, env: { ANTHROPIC_BASE_URL: 'https://x.example' } });
    const info = await trustInfo();
    expect(info.items.map((i) => `${i.key}: ${i.detail}`)).toEqual(['hooks: 1 comando', 'env: ANTHROPIC_BASE_URL']);
    expect(info.decision).toBeNull();
    expect(JSON.stringify(info)).not.toContain(dir);
    const ctx = ctxs.at(-1)!;
    expect(await ctx.projectConfigTrusted!(project())).toBe(false);
    val(await h.invoke(CHANNELS.setProjectTrust, 'trusted'));
    expect((await trustInfo()).decision).toBe('trusted');
    expect(await ctx.projectConfigTrusted!(project())).toBe(true);
    // Un paso que trabaja en otra carpeta con su propio .claude arriesgado no hereda la confianza.
    const other = join(dir, 'otra');
    await fs.mkdir(join(other, '.claude'), { recursive: true });
    await fs.writeFile(join(other, '.claude', 'settings.json'), JSON.stringify({ apiKeyHelper: 'x' }));
    expect(await ctx.projectConfigTrusted!(other)).toBe(false);
  });

  it('[R88.6][R88.4] E88.b: si cambia lo que trae, se vuelve a preguntar; sin nada arriesgado se carga sin preguntar', async () => {
    await openWith({ env: { A: '1' } });
    val(await h.invoke(CHANNELS.setProjectTrust, 'trusted'));
    await fs.writeFile(join(project(), '.claude', 'settings.json'), JSON.stringify({ env: { A: '1' }, hooks: { Stop: [{ hooks: [{ type: 'command', command: 'y' }] }] } }));
    expect((await trustInfo()).decision).toBeNull();
    expect(await ctxs.at(-1)!.projectConfigTrusted!(project())).toBe(false);
    await fs.writeFile(join(project(), '.claude', 'settings.json'), JSON.stringify({ model: 'x' }));
    expect(await trustInfo()).toEqual({ items: [], decision: null });
    expect(await ctxs.at(-1)!.projectConfigTrusted!(project())).toBe(true);
  });

  it('[R88.6] el contrato solo acepta «trusted» o «ignored»', () => {
    expect(parseRequest(CHANNELS.setProjectTrust, 'ignored')).toBe('ignored');
    expect(() => parseRequest(CHANNELS.setProjectTrust, 'yes')).toThrow(ContractError);
    expect(() => parseRequest(CHANNELS.projectTrust, { x: 1 })).toThrow(ContractError);
  });

  it('[R88.5] las aprobaciones de comprobaciones van a los datos de la app; las del repositorio no cuentan', async () => {
    await openWith({});
    const ctx = ctxs.at(-1)!;
    expect(ctx.checksApprovalsFile).toBe(join(dir, 'datos', 'trust', `${projectKey(project())}-checks.json`));
    const store = await createProject(join(dir, 'repo'), { name: 'repo' });
    await fs.mkdir(join(dir, 'repo', '.orquestador'), { recursive: true });
    await fs.writeFile(store.paths.approvedChecksFile, JSON.stringify({ schemaVersion: 1, approved: ['cualquier-hash'] }));
    const file = join(dir, 'datos', 'trust', 'repo-checks.json');
    const r = checkRunnerFor(store, file);
    expect(await r.approved('npm test')).toBe(false);
    await r.approve('npm test');
    expect(await r.approved('npm test')).toBe(true);
    expect(JSON.parse(await fs.readFile(file, 'utf8')).approved).toHaveLength(1);
    expect(JSON.parse(await fs.readFile(store.paths.approvedChecksFile, 'utf8')).approved).toEqual(['cualquier-hash']);
  });
});
