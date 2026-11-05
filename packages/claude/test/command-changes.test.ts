import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultSettings, newAgent, type AgentStreamEvent } from '@orquestador/core';
import { ClaudeAdapter, CommandWatch, diffSnapshots, snapshotFolder, type ClaudeEnvironment, type QueryFn, type SdkMessage } from '../src';

let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'orq-cmd-'));
  await fs.writeFile(path.join(root, 'existente.txt'), 'antes');
  await fs.mkdir(path.join(root, 'checks'));
  await fs.writeFile(path.join(root, 'checks/build.py'), 'print(1)');
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const agent = newAgent('dev', 'Dev');
const env = (): ClaudeEnvironment => ({
  projectRoot: root,
  settings: () => ({ ...defaultSettings(), permissions: 'full' }),
  apiKey: async () => undefined,
  loadAgent: async () => agent,
  loadContexts: async () => [],
  loadSkills: async () => [],
  workFolder: async () => root,
  backup: async () => undefined,
});
const result = (text: string) => ({ type: 'result', subtype: 'success', is_error: false, result: text, usage: { input_tokens: 1, output_tokens: 1 }, total_cost_usd: 0 }) as SdkMessage;
let n = 0;
const toolUse = (name: string, input: Record<string, unknown>) => {
  const id = `t${++n}`;
  return { id, msg: { type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } } as SdkMessage };
};
const toolResult = (id: string) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] } }) as SdkMessage;
const bump = async (rel: string, text: string) => {
  await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
  await fs.writeFile(path.join(root, rel), text);
  // Fecha distinta aunque el sistema de archivos tenga poca resolución.
  const t = new Date(Date.now() + 5000);
  await fs.utimes(path.join(root, rel), t, t);
};

async function collect(query: QueryFn): Promise<AgentStreamEvent[]> {
  const out: AgentStreamEvent[] = [];
  for await (const e of new ClaudeAdapter(env(), query).run({ nodeId: 'n1', agentId: 'dev', input: { text: 'x', files: [] }, attempt: 1, ask: async () => '', previousAnswers: [] }, new AbortController().signal)) out.push(e);
  return out;
}

describe('SPEC-055 · lo que cambian los comandos también se registra', () => {
  it('[R55.2] la foto de la carpeta no entra en .git, node_modules ni .orquestador y se corta en el tope', async () => {
    await bump('.git/HEAD', 'x');
    await bump('node_modules/a/index.js', 'x');
    await bump('.orquestador/runs/r.json', 'x');
    const snap = await snapshotFolder(root);
    expect([...snap.files.keys()].sort()).toEqual(['checks/build.py', 'existente.txt']);
    expect(snap.truncated).toBe(false);
    const cut = await snapshotFolder(root, 1);
    expect(cut.files.size).toBe(1);
    expect(cut.truncated).toBe(true);
  });

  it('[R55.3] la diferencia distingue lo nuevo de lo modificado; con la foto previa recortada no afirma que algo sea nuevo', async () => {
    const before = await snapshotFolder(root);
    await bump('existente.txt', 'después');
    await bump('_raiz/test/index.html', '<html>');
    const after = await snapshotFolder(root);
    expect(diffSnapshots(before, after)).toEqual([
      { path: '_raiz/test/index.html', change: 'created' },
      { path: 'existente.txt', change: 'modified' },
    ]);
    expect(diffSnapshots({ ...before, truncated: true }, after)).toEqual([{ path: 'existente.txt', change: 'modified' }]);
  });

  it('[R55.1] [R55.3] un script ejecutado con Bash que genera páginas: salen como archivos del paso, marcados «con un comando»', async () => {
    const query: QueryFn = async function* ({ options }) {
      const run = toolUse('Bash', { command: 'python -I checks/build.py' });
      yield run.msg;
      expect(await options.canUseTool!('Bash', { command: 'python -I checks/build.py' }, { toolUseID: run.id } as never)).toMatchObject({ behavior: 'allow' });
      // Lo que hace el script, después de permitirlo y antes de que vuelva su resultado.
      await bump('_raiz/test/index.html', '<html lang="en">');
      await bump('_raiz/es/test/index.html', '<html lang="es">');
      await bump('existente.txt', 'reescrito');
      yield toolResult(run.id);
      yield result('Listo');
    };
    const out = await collect(query);
    expect(out.filter((e) => e.type === 'file')).toEqual([
      { type: 'file', path: '_raiz/es/test/index.html', change: 'created', via: 'command' },
      { type: 'file', path: '_raiz/test/index.html', change: 'created', via: 'command' },
      { type: 'file', path: 'existente.txt', change: 'modified', via: 'command' },
    ]);
    // Salen justo tras el resultado del comando, antes del resultado del paso.
    expect(out.findIndex((e) => e.type === 'file')).toBeGreaterThan(out.findIndex((e) => e.type === 'tool_result'));
    expect(out.findIndex((e) => e.type === 'result')).toBeGreaterThan(out.findIndex((e) => e.type === 'file'));
  });

  it('[R55.4] lo escrito con Write no se repite como comando, y lo cambiado fuera de una ventana de comando no se atribuye al paso', async () => {
    const query: QueryFn = async function* ({ options }) {
      const use = options.canUseTool!;
      // Otro paso escribe en la carpeta mientras este no ejecuta comandos: no es suyo.
      await bump('ajeno.txt', 'de otro paso');
      const w = toolUse('Write', { file_path: 'checks/build.py' });
      yield w.msg;
      expect(await use('Write', { file_path: 'checks/build.py' }, { toolUseID: w.id } as never)).toMatchObject({ behavior: 'allow' });
      const run = toolUse('Bash', { command: 'python -I checks/build.py' });
      expect(await use('Bash', { command: 'python -I checks/build.py' }, { toolUseID: run.id } as never)).toMatchObject({ behavior: 'allow' });
      await bump('checks/build.py', 'print(2)');
      await bump('salida.html', '<p>');
      yield toolResult(w.id);
      yield run.msg;
      yield toolResult(run.id);
      yield result('Listo');
    };
    const files = (await collect(query)).filter((e) => e.type === 'file');
    expect(files).toEqual([
      { type: 'file', path: 'checks/build.py', change: 'modified' },
      { type: 'file', path: 'salida.html', change: 'created', via: 'command' },
    ]);
  });

  it('[R55.4] un comando sin resultado (subagente, comando en segundo plano o paso que falla) se recoge al terminar', async () => {
    const query: QueryFn = async function* ({ options }) {
      const run = toolUse('Bash', { command: 'npm run build' });
      expect(await options.canUseTool!('Bash', { command: 'npm run build' }, { toolUseID: run.id } as never)).toMatchObject({ behavior: 'allow' });
      yield run.msg;
      await bump('dist/app.js', 'x');
      throw new Error('se cortó');
    };
    const out: AgentStreamEvent[] = [];
    await expect(async () => {
      for await (const e of new ClaudeAdapter(env(), query).run({ nodeId: 'n1', agentId: 'dev', input: { text: 'x', files: [] }, attempt: 1, ask: async () => '', previousAnswers: [] }, new AbortController().signal)) out.push(e);
    }).rejects.toThrow();
    expect(out.filter((e) => e.type === 'file')).toEqual([{ type: 'file', path: 'dist/app.js', change: 'created', via: 'command' }]);
  });

  it('[R55.2] dos comandos a la vez: una sola foto de partida, cada resultado cierra el suyo y nada se cuenta dos veces', async () => {
    let snaps = 0;
    const watch = new CommandWatch(root, async (r) => {
      snaps++;
      return snapshotFolder(r);
    });
    await Promise.all([watch.opening('a'), watch.opening('b')]);
    expect(snaps).toBe(1);
    await bump('a.txt', 'a');
    // El resultado de un comando que no abrió ventana (uno que solo lee) no cierra la de otro.
    expect(await watch.closing('done', 'ls')).toEqual([]);
    expect(await watch.closing('done', 'a')).toEqual([{ path: 'a.txt', change: 'created' }]);
    await bump('b.txt', 'b');
    expect(await watch.closing('done', 'b')).toEqual([{ path: 'b.txt', change: 'created' }]);
    // Sin ventana abierta no hay nada que mirar.
    await bump('c.txt', 'c');
    expect(await watch.closing('final')).toEqual([]);
  });

  it('[R55.2] un comando que solo lee no abre ventana: lo que cambie mientras tanto no se atribuye al paso', async () => {
    const query: QueryFn = async function* ({ options }) {
      const run = toolUse('Bash', { command: 'ls checks' });
      yield run.msg;
      expect(await options.canUseTool!('Bash', { command: 'ls checks' }, { toolUseID: run.id } as never)).toMatchObject({ behavior: 'allow' });
      await bump('de-otro-paso.txt', 'x');
      yield toolResult(run.id);
      yield result('Listo');
    };
    expect((await collect(query)).filter((e) => e.type === 'file')).toEqual([]);
  });
});
