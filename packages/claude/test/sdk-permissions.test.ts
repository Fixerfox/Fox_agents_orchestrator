import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultSettings, newAgent, type AgentStreamEvent } from '@orquestador/core';
import { ClaudeAdapter, type ClaudeEnvironment, type ClaudeQueryOptions, type QueryFn, type SdkMessage } from '../src';

let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'orq-sdkperm-'));
  await fs.writeFile(path.join(root, 'existente.txt'), 'antes');
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const agent = newAgent('dev', 'Dev');
const env = (over: Partial<ClaudeEnvironment> = {}, autoWrite = false): ClaudeEnvironment => ({
  projectRoot: root,
  settings: () => ({ ...defaultSettings(), permissions: autoWrite ? 'auto' : 'ask' }),
  apiKey: async () => undefined,
  loadAgent: async () => agent,
  loadContexts: async () => [],
  loadSkills: async () => [],
  workFolder: async () => root,
  backup: async () => undefined,
  ...over,
});
const result = (text: string) => ({ type: 'result', subtype: 'success', is_error: false, result: text, usage: { input_tokens: 1, output_tokens: 1 }, total_cost_usd: 0 }) as SdkMessage;

interface Step {
  tool: string;
  input: Record<string, unknown>;
  /** Lo que hace la herramienta si se le deja. */
  effect?: () => Promise<void>;
}

/**
 * Doble del SDK que aplica sus reglas de permisos como el de verdad: una herramienta de `allowedTools` se ejecuta
 * sin llamar a `canUseTool`; el resto pasa por `canUseTool` y solo se ejecuta si lo permite.
 */
function sdkLike(steps: Step[], log: { asked: string[]; ran: string[] }, fail?: Error): QueryFn {
  return async function* ({ options }: { prompt: string; options: ClaudeQueryOptions }) {
    let id = 0;
    for (const s of steps) {
      const useId = `t${++id}`;
      yield { type: 'assistant', message: { content: [{ type: 'tool_use', id: useId, name: s.tool, input: s.input }] } } as SdkMessage;
      let allowed = (options.allowedTools ?? []).includes(s.tool);
      if (!allowed) {
        log.asked.push(s.tool);
        const verdict = await options.canUseTool!(s.tool, s.input);
        allowed = verdict.behavior === 'allow';
      }
      if (allowed) {
        log.ran.push(s.tool);
        await s.effect?.();
      }
      yield { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: useId, content: allowed ? 'ok' : 'denegado', is_error: !allowed }] } } as SdkMessage;
    }
    if (fail) throw fail;
    yield result('Listo');
  };
}

const write = (rel: string, text = 'x') => async () => {
  await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
  await fs.writeFile(path.join(root, rel), text);
};

async function collect(adapter: ClaudeAdapter, ask: (q: { text: string }) => Promise<string> = async () => ''): Promise<{ out: AgentStreamEvent[]; error?: unknown }> {
  const out: AgentStreamEvent[] = [];
  try {
    for await (const e of adapter.run({ nodeId: 'n1', agentId: 'dev', input: { text: 'x', files: [] }, attempt: 1, ask, previousAnswers: [] }, new AbortController().signal)) out.push(e);
  } catch (error) {
    return { out, error };
  }
  return { out };
}

describe('SPEC-045 · el motor real pasa por la política de escritura', () => {
  it('[R45.1][R87.3] nada que lea o escriba se aprueba solo: Read, Write, Edit, Bash y AskUserQuestion se deciden en la política', async () => {
    const log = { asked: [] as string[], ran: [] as string[] };
    let seen: ClaudeQueryOptions | undefined;
    const steps: Step[] = [
      { tool: 'Read', input: { file_path: 'existente.txt' } },
      { tool: 'Write', input: { file_path: 'specs/001/spec.md' }, effect: write('specs/001/spec.md') },
      { tool: 'Bash', input: { command: 'npm test' } },
    ];
    const inner = sdkLike(steps, log);
    const query: QueryFn = (args) => {
      seen = args.options;
      return inner(args);
    };
    const asked: string[] = [];
    const { out } = await collect(new ClaudeAdapter(env(), query), async (q) => {
      asked.push(q.text);
      return 'Denegar';
    });
    for (const t of ['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Write', 'Edit', 'MultiEdit', 'Bash', 'AskUserQuestion']) expect(seen!.allowedTools).not.toContain(t);
    expect(seen!.tools).toEqual(expect.arrayContaining(['Write', 'Edit', 'Bash', 'AskUserQuestion']));
    // Todo pasa por la política; la lectura de dentro no pregunta al usuario y el comando denegado no se ejecuta.
    expect(log.asked).toEqual(['Read', 'Write', 'Bash']);
    expect(log.ran).toEqual(['Read', 'Write']);
    expect(asked).toEqual([expect.stringMatching(/^¿Puedo ejecutar este comando\?\nnpm test/)]);
    // El documento que escribe queda en los archivos del paso.
    expect(out.filter((e) => e.type === 'file')).toEqual([{ type: 'file', path: 'specs/001/spec.md', change: 'created' }]);
  });

  it('[R45.1] modificar un archivo existente pregunta y hace la copia antes', async () => {
    const log = { asked: [] as string[], ran: [] as string[] };
    const backups: string[] = [];
    const steps: Step[] = [{ tool: 'Edit', input: { file_path: 'existente.txt' }, effect: write('existente.txt', 'después') }];
    const asked: string[] = [];
    const { out } = await collect(new ClaudeAdapter(env({ backup: async (_run, _abs, rel) => void backups.push(rel) }), sdkLike(steps, log)), async (q) => {
      asked.push(q.text);
      return 'Permitir';
    });
    expect(asked).toEqual(['¿Puedo modificar existente.txt?']);
    expect(backups).toEqual(['existente.txt']);
    expect(out.filter((e) => e.type === 'file')).toEqual([{ type: 'file', path: 'existente.txt', change: 'modified' }]);
  });

  it('[R45.2] cada archivo sale en cuanto la herramienta termina, antes de la pregunta siguiente y una sola vez', async () => {
    const log = { asked: [] as string[], ran: [] as string[] };
    const steps: Step[] = [
      { tool: 'Write', input: { file_path: 'a.md' }, effect: write('a.md') },
      { tool: 'Edit', input: { file_path: 'a.md' }, effect: write('a.md', 'y') },
      { tool: 'AskUserQuestion', input: { questions: [{ question: '¿Sigo?', options: [{ label: 'Sí' }] }] } },
    ];
    const order: string[] = [];
    const adapter = new ClaudeAdapter(env({}, true), sdkLike(steps, log));
    for await (const e of adapter.run({ nodeId: 'n1', agentId: 'dev', input: { text: 'x', files: [] }, attempt: 1, ask: async (q) => (order.push(`pregunta:${q.text}`), 'Sí'), previousAnswers: [] }, new AbortController().signal)) {
      if (e.type === 'file') order.push(`file:${e.path}:${e.change}`);
    }
    expect(order).toEqual(['file:a.md:created', 'pregunta:¿Sigo?']);
  });

  it('[R45.2] si el intento falla, lo que ya escribió queda registrado; lo nuevo que no llegó a existir, no', async () => {
    const log = { asked: [] as string[], ran: [] as string[] };
    const steps: Step[] = [
      { tool: 'Write', input: { file_path: 'hecho.md' }, effect: write('hecho.md') },
      { tool: 'Write', input: { file_path: 'nunca.md' } },
    ];
    const { out, error } = await collect(new ClaudeAdapter(env({}, true), sdkLike(steps, log, new Error('se cortó'))));
    expect(error).toBeDefined();
    expect(out.filter((e) => e.type === 'file')).toEqual([{ type: 'file', path: 'hecho.md', change: 'created' }]);
  });
});

describe('SPEC-045 · retocar lo que acaba de crear', () => {
  it('[R45.1] un fichero creado por el propio agente se puede retocar sin preguntar ni hacer copia, y sigue siendo nuevo', async () => {
    const log = { asked: [] as string[], ran: [] as string[] };
    const backups: string[] = [];
    const steps: Step[] = [
      { tool: 'Write', input: { file_path: 'specs/001/spec.md' }, effect: write('specs/001/spec.md') },
      { tool: 'Edit', input: { file_path: 'specs/001/spec.md' }, effect: write('specs/001/spec.md', 'v2') },
    ];
    const asked: string[] = [];
    const { out } = await collect(new ClaudeAdapter(env({ backup: async (_run, _abs, rel) => void backups.push(rel) }), sdkLike(steps, log)), async (q) => (asked.push(q.text), 'Denegar'));
    expect(asked).toEqual([]);
    expect(backups).toEqual([]);
    expect(log.ran).toEqual(['Write', 'Edit']);
    expect(out.filter((e) => e.type === 'file')).toEqual([{ type: 'file', path: 'specs/001/spec.md', change: 'created' }]);
  });
});
