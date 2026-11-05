import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QueryFn, SdkMessage } from '@orquestador/claude';
import { promptText } from '@orquestador/claude';
import { defaultSettings, newAgent, type AppSettings, type Diagram, type RunEvent } from '@orquestador/core';
import { CHANNELS } from '@orquestador/editor';
import { createEngineOrchestrator } from '@orquestador/runtime';
import { ApiKeyVault, SettingsStore } from '@orquestador/store';
import { DesktopHandlers } from '../src/main/handlers';

let dir: string;
let work: string;
let h: DesktopHandlers;
let pushed: RunEvent[];
let seen: { cwd?: string; system?: string; tools?: string[] };
let script: (canUse: NonNullable<Parameters<QueryFn>[0]['options']['canUseTool']>) => Promise<string>;
let workPick: string | null;

const cipher = { available: () => true, encrypt: (s: string) => Buffer.from(`c:${s}`), decrypt: (b: Buffer) => b.toString().slice(2) };
const query: QueryFn = async function* ({ options }) {
  seen = { ...(options.cwd ? { cwd: options.cwd } : {}), ...(options.systemPrompt ? { system: promptText(options.systemPrompt) } : {}), ...(Array.isArray(options.tools) ? { tools: options.tools } : {}) };
  const text = await script(options.canUseTool!);
  const done: SdkMessage = { type: 'result', subtype: 'success', is_error: false, result: text, usage: { input_tokens: 1, output_tokens: 1 } };
  yield done;
};
const flow: Diagram = {
  id: 'flujo',
  name: 'Flujo',
  schemaVersion: 1,
  nodes: [
    { id: 'entry', kind: 'entry' },
    { id: 'dev', kind: 'agent', agentId: 'dev' },
    { id: 'output', kind: 'output' },
  ],
  edges: [
    { id: 'e1', from: 'entry', to: 'dev' },
    { id: 'e2', from: 'dev', to: 'output' },
  ],
};

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'orq-workfolder-'));
  work = join(dir, 'mi-juego');
  await fs.mkdir(join(work, 'src'), { recursive: true });
  await fs.writeFile(join(work, 'README.md'), '# Mi juego de naves');
  await fs.writeFile(join(work, 'src', 'viejo.ts'), 'original');
  workPick = work;
  pushed = [];
  seen = {};
  script = async () => 'Hecho';
  h = new DesktopHandlers({
    pickFolder: async (purpose) => (purpose === 'work' ? workPick : join(dir, 'proyecto')),
    createOrchestrator: (ctx) => createEngineOrchestrator(ctx, query),
    claudeQuery: query,
    settings: new SettingsStore(join(dir, 'config')),
    vault: new ApiKeyVault(join(dir, 'config'), cipher),
    push: (_id, events) => pushed.push(...events),
    batchMs: 5,
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
async function open(settings: Partial<AppSettings> = {}) {
  val(await h.invoke(CHANNELS.createProject, undefined));
  val(await h.invoke(CHANNELS.saveAgent, { ...newAgent('dev', 'Dev'), instructions: 'Programa el juego' }));
  val(await h.invoke(CHANNELS.saveDiagram, flow));
  val(await h.invoke(CHANNELS.saveSettings, { ...defaultSettings(), engine: 'claude', permissions: 'ask', ...settings }));
}
const startRun = async () => {
  const { runId } = val<{ runId: string }>(await h.invoke(CHANNELS.startRun, { diagramId: 'flujo', order: 'Añade una nave' }));
  val(await h.invoke(CHANNELS.subscribeRun, { runId, fromSeq: 1 }));
  return runId;
};
const finished = () => vi.waitFor(() => expect(pushed.some((e) => e.type === 'run.finished')).toBe(true));
const question = async () => {
  await vi.waitFor(() => expect(pushed.some((e) => e.type === 'agent.question')).toBe(true));
  return pushed.find((e) => e.type === 'agent.question') as Extract<RunEvent, { type: 'agent.question' }>;
};

describe('SPEC-031 · carpeta de trabajo por IPC', () => {
  it('[R31.1] elegir devuelve solo nombre y número de archivos, y se recupera después sin ruta', async () => {
    await open();
    expect(val(await h.invoke(CHANNELS.getWorkFolder, undefined))).toBeNull();
    const picked = val(await h.invoke(CHANNELS.pickWorkFolder, undefined));
    expect(picked).toEqual({ name: 'mi-juego', files: 2 });
    expect(val(await h.invoke(CHANNELS.getWorkFolder, undefined))).toEqual(picked);
    expect(JSON.stringify(picked)).not.toContain(dir);
  });

  it('[R31.1] cancelar el diálogo no cambia nada y quitar la carpeta la deja sin elegir', async () => {
    await open();
    workPick = null;
    expect(val(await h.invoke(CHANNELS.pickWorkFolder, undefined))).toBeNull();
    workPick = work;
    val(await h.invoke(CHANNELS.pickWorkFolder, undefined));
    val(await h.invoke(CHANNELS.clearWorkFolder, undefined));
    expect(val(await h.invoke(CHANNELS.getWorkFolder, undefined))).toBeNull();
  });

  it('[R31.1] la carpeta se recuerda al reabrir el proyecto y desaparece si ya no existe', async () => {
    await open();
    val(await h.invoke(CHANNELS.pickWorkFolder, undefined));
    val(await h.invoke(CHANNELS.closeProject, undefined));
    val(await h.invoke(CHANNELS.openProject, undefined));
    expect(val(await h.invoke(CHANNELS.getWorkFolder, undefined))).toMatchObject({ name: 'mi-juego' });
    await fs.rm(work, { recursive: true, force: true });
    expect(val(await h.invoke(CHANNELS.getWorkFolder, undefined))).toBeNull();
  });

  it('[R31.1] sin proyecto abierto se explica y no se crea nada', async () => {
    expect(await h.invoke(CHANNELS.pickWorkFolder, undefined)).toMatchObject({ ok: false });
    expect(await h.invoke(CHANNELS.getWorkFolder, undefined)).toMatchObject({ ok: false });
  });

  it('[R31.10] el contrato rechaza argumentos de más y campos extra', async () => {
    await open();
    expect(await h.invoke(CHANNELS.pickWorkFolder, '/etc')).toMatchObject({ ok: false, error: { code: 'bad-request' } });
    expect(await h.invoke(CHANNELS.clearWorkFolder, { path: '/' })).toMatchObject({ ok: false, error: { code: 'bad-request' } });
    expect(await h.invoke(CHANNELS.restoreBackup, { runId: 'r1', path: 'a.ts', to: '/x' })).toMatchObject({ ok: false, error: { code: 'bad-request' } });
    expect(await h.invoke(CHANNELS.restoreBackup, { runId: '../r', path: 'a.ts' })).toMatchObject({ ok: false, error: { code: 'bad-request' } });
    expect(await h.invoke(CHANNELS.listBackups, '../r')).toMatchObject({ ok: false, error: { code: 'bad-request' } });
  });

  it('[R31.4][R31.10][R47.8] el nivel de permisos se guarda en Ajustes; el contrato rechaza los campos viejos', async () => {
    expect(val<AppSettings>(await h.invoke(CHANNELS.getSettings, undefined)).permissions).toBeUndefined();
    val(await h.invoke(CHANNELS.saveSettings, { ...defaultSettings(), permissions: 'full' }));
    expect(val<AppSettings>(await h.invoke(CHANNELS.getSettings, undefined)).permissions).toBe('full');
    expect(await h.invoke(CHANNELS.saveSettings, { ...defaultSettings(), permissions: 'readonly' })).toMatchObject({ ok: false });
    expect(await h.invoke(CHANNELS.saveSettings, { ...defaultSettings(), autoWrite: true })).toMatchObject({ ok: false });
  });
});

describe('SPEC-031 · los agentes trabajan sobre la carpeta', () => {
  it('[R31.2] el agente recibe la carpeta como directorio de trabajo y su resumen', async () => {
    await open();
    val(await h.invoke(CHANNELS.pickWorkFolder, undefined));
    await startRun();
    await finished();
    expect(seen.cwd).toBe(work);
    expect(seen.system).toContain('Mi juego de naves');
    expect(seen.system).toContain('src/viejo.ts');
    expect(seen.tools).toContain('Write');
  });

  it('[R31.3] crear un archivo nuevo no genera ninguna pregunta', async () => {
    await open();
    val(await h.invoke(CHANNELS.pickWorkFolder, undefined));
    script = async (canUse) => {
      const r = await canUse('Write', { file_path: 'src/nave.ts', content: 'x' });
      return r.behavior;
    };
    await startRun();
    await finished();
    expect(pushed.some((e) => e.type === 'agent.question')).toBe(false);
    expect(JSON.stringify(pushed)).toContain('allow');
  });

  it('[R31.4][R31.6] modificar uno existente pregunta en el chat del nodo; al permitir se guarda la copia y se puede restaurar', async () => {
    await open();
    val(await h.invoke(CHANNELS.pickWorkFolder, undefined));
    script = async (canUse) => {
      const r = await canUse('Edit', { file_path: 'src/viejo.ts' });
      if (r.behavior === 'allow') await fs.writeFile(join(work, 'src', 'viejo.ts'), 'cambiado por el agente');
      return r.behavior;
    };
    const runId = await startRun();
    const q = await question();
    expect(q.text).toBe('¿Puedo modificar src/viejo.ts?');
    expect(q.options).toEqual(['Permitir', 'Permitir en esta ejecución', 'Denegar']);
    val(await h.invoke(CHANNELS.answerRun, { runId, questionId: q.questionId, text: 'Permitir' }));
    await finished();
    expect(await fs.readFile(join(work, 'src', 'viejo.ts'), 'utf8')).toBe('cambiado por el agente');
    expect(val<string[]>(await h.invoke(CHANNELS.listBackups, runId))).toEqual(['src/viejo.ts']);
    expect(val<boolean>(await h.invoke(CHANNELS.restoreBackup, { runId, path: 'src/viejo.ts' }))).toBe(true);
    expect(await fs.readFile(join(work, 'src', 'viejo.ts'), 'utf8')).toBe('original');
  });

  it('[R31.4] si el usuario deniega, el archivo no se toca y no hay copia', async () => {
    await open();
    val(await h.invoke(CHANNELS.pickWorkFolder, undefined));
    script = async (canUse) => (await canUse('Write', { file_path: 'src/viejo.ts', content: 'x' })).behavior;
    const runId = await startRun();
    const q = await question();
    val(await h.invoke(CHANNELS.answerRun, { runId, questionId: q.questionId, text: 'Denegar' }));
    await finished();
    expect(await fs.readFile(join(work, 'src', 'viejo.ts'), 'utf8')).toBe('original');
    expect(val<string[]>(await h.invoke(CHANNELS.listBackups, runId))).toEqual([]);
  });

  it('[R31.4] con el modo automático no pregunta pero guarda la copia', async () => {
    await open({ permissions: 'auto' });
    val(await h.invoke(CHANNELS.pickWorkFolder, undefined));
    script = async (canUse) => (await canUse('Edit', { file_path: 'src/viejo.ts' })).behavior;
    const runId = await startRun();
    await finished();
    expect(pushed.some((e) => e.type === 'agent.question')).toBe(false);
    expect(val<string[]>(await h.invoke(CHANNELS.listBackups, runId))).toEqual(['src/viejo.ts']);
  });

  it('[R31.5] no se puede escribir ni restaurar fuera de la carpeta', async () => {
    await open({ permissions: 'auto' });
    val(await h.invoke(CHANNELS.pickWorkFolder, undefined));
    let verdict = '';
    script = async (canUse) => {
      verdict = (await canUse('Write', { file_path: join(dir, 'fuera.txt'), content: 'x' })).behavior;
      return verdict;
    };
    const runId = await startRun();
    await finished();
    expect(verdict).toBe('deny');
    await expect(fs.access(join(dir, 'fuera.txt'))).rejects.toThrow();
    expect(await h.invoke(CHANNELS.restoreBackup, { runId, path: '../fuera.txt' })).toMatchObject({ ok: false });
  });

  it('[R31.9] una pregunta de Claude llega al chat del nodo y la respuesta vuelve al agente', async () => {
    await open();
    let answers: unknown;
    script = async (canUse) => {
      const r = await canUse('AskUserQuestion', { questions: [{ question: '¿Qué estilo gráfico?', options: [{ label: 'Pixel art' }, { label: 'Vectorial' }] }] });
      if (r.behavior === 'allow') answers = (r.updatedInput as { answers: unknown }).answers;
      return 'Hecho';
    };
    const runId = await startRun();
    const q = await question();
    expect(q).toMatchObject({ text: '¿Qué estilo gráfico?', options: ['Pixel art', 'Vectorial'] });
    val(await h.invoke(CHANNELS.answerRun, { runId, questionId: q.questionId, text: 'Pixel art' }));
    await finished();
    expect(answers).toEqual({ '¿Qué estilo gráfico?': 'Pixel art' });
  });
});

describe('SPEC-032 · carpeta del proyecto con .claude', () => {
  it('[R32.16] analiza .claude, .mcp.json y los documentos guía de la carpeta sin instalar nada; confirmar instala', async () => {
    await fs.mkdir(join(work, '.claude', 'agents'), { recursive: true });
    await fs.mkdir(join(work, '.claude', 'skills', 'pixel-art'), { recursive: true });
    await fs.writeFile(join(work, '.claude', 'agents', 'pixelador.md'), '---\nname: pixelador\ndescription: Pinta sprites\nskills: pixel-art\n---\nDibuja.\n');
    await fs.writeFile(join(work, '.claude', 'skills', 'pixel-art', 'SKILL.md'), '---\nname: pixel-art\ndescription: Paleta limitada\n---\n# Pasos\n');
    await fs.writeFile(join(work, '.mcp.json'), '{"mcpServers":{"pixelart-mcp":{"command":"npx"}}}');
    await fs.writeFile(join(work, 'CLAUDE.md'), '# Normas\nTodo en español.');
    await open();
    expect(await h.invoke(CHANNELS.inspectWorkFolder, undefined)).toMatchObject({ ok: false });
    val(await h.invoke(CHANNELS.pickWorkFolder, undefined));
    const r = val<{ importId: string; report: { items: { key: string; kind: string; name: string }[]; mcp: { name: string }[] }; folder: { name: string }; summary: string; docs: { name: string; text: string }[] }>(
      await h.invoke(CHANNELS.inspectWorkFolder, undefined),
    );
    expect(r.folder.name).toBe('mi-juego');
    expect(r.report.items.map((i) => `${i.kind}:${i.name}`).sort()).toEqual(['agent:pixelador', 'skill:pixel-art']);
    expect(r.report.mcp.map((m) => m.name)).toEqual(['pixelart-mcp']);
    expect(r.docs).toEqual([{ name: 'CLAUDE.md', text: '# Normas\nTodo en español.' }]);
    expect(r.summary).toContain('Mi juego de naves');
    expect(JSON.stringify(r)).not.toContain(dir);
    expect(val<{ id: string }[]>(await h.invoke(CHANNELS.listAgents, undefined)).map((a) => a.id)).toEqual(['dev']);
    const done = val<{ agents: string[]; skills: string[] }>(await h.invoke(CHANNELS.confirmImport, { importId: r.importId, keys: r.report.items.map((i) => i.key) }));
    expect(done.agents).toEqual(['pixelador']);
    const agents = val<{ id: string; skillIds: string[] }[]>(await h.invoke(CHANNELS.listAgents, undefined));
    expect(agents.find((a) => a.id === 'pixelador')?.skillIds).toEqual(['pixel-art']);
  });

  it('[R32.16] una carpeta sin .claude devuelve un informe vacío con el resumen; el contrato rechaza argumentos', async () => {
    await open();
    val(await h.invoke(CHANNELS.pickWorkFolder, undefined));
    const r = val<{ report: { items: unknown[] }; docs: unknown[] }>(await h.invoke(CHANNELS.inspectWorkFolder, undefined));
    expect(r.report.items).toEqual([]);
    expect(r.docs).toEqual([]);
    expect(await h.invoke(CHANNELS.inspectWorkFolder, { path: '/etc' })).toMatchObject({ ok: false });
  });
});

describe('SPEC-045 · ver los ficheros que tocó una ejecución', () => {
  it('[R45.11] readRunFile da lo de ahora y la copia de antes, solo de ficheros que registró la ejecución', async () => {
    await open({ permissions: 'auto' });
    val(await h.invoke(CHANNELS.pickWorkFolder, undefined));
    await fs.writeFile(join(work, '.env'), 'CLAVE=1');
    script = async (canUse) => {
      await canUse('Edit', { file_path: 'src/viejo.ts' });
      await fs.writeFile(join(work, 'src', 'viejo.ts'), 'cambiado');
      await canUse('Write', { file_path: 'specs/spec.md' });
      await fs.mkdir(join(work, 'specs'), { recursive: true });
      await fs.writeFile(join(work, 'specs', 'spec.md'), '# Spec');
      await canUse('Write', { file_path: '.env.local' });
      await fs.writeFile(join(work, '.env.local'), 'X=1');
      return 'Hecho';
    };
    const runId = await startRun();
    await finished();
    const produced = pushed.filter((e) => e.type === 'file.produced').map((e) => [e.path, (e as { change?: string }).change]);
    expect(produced).toEqual([
      ['src/viejo.ts', 'modified'],
      ['specs/spec.md', 'created'],
      ['.env.local', 'created'],
    ]);
    // Aunque lo escribiera un agente, un secreto no se enseña.
    expect(await h.invoke(CHANNELS.readRunFile, { runId, path: '.env.local' })).toMatchObject({ ok: false, error: { code: 'outside-root' } });
    expect(val(await h.invoke(CHANNELS.readRunFile, { runId, path: 'src/viejo.ts' }))).toEqual({ path: 'src/viejo.ts', missing: false, binary: false, current: { text: 'cambiado', truncated: false }, before: { text: 'original', truncated: false } });
    expect(val(await h.invoke(CHANNELS.readRunFile, { runId, path: 'specs/spec.md' }))).toEqual({ path: 'specs/spec.md', missing: false, binary: false, current: { text: '# Spec', truncated: false } });
    // Lo que la ejecución no tocó, rutas raras, internas o secretos: nunca.
    expect(await h.invoke(CHANNELS.readRunFile, { runId, path: 'README.md' })).toMatchObject({ ok: false, error: { code: 'not-found' } });
    for (const path of ['../fuera.txt', '/etc/passwd', 'src\\viejo.ts', '.orquestador/project.json', '.env', 'a/./b']) {
      expect(await h.invoke(CHANNELS.readRunFile, { runId, path }), path).toMatchObject({ ok: false });
    }
    expect(await h.invoke(CHANNELS.readRunFile, { runId: '../x', path: 'a' })).toMatchObject({ ok: false, error: { code: 'bad-request' } });
    // Si ya no existe, lo dice.
    await fs.rm(join(work, 'specs', 'spec.md'));
    expect(val(await h.invoke(CHANNELS.readRunFile, { runId, path: 'specs/spec.md' }))).toMatchObject({ missing: true });
  });
});
