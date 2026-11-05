import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultSettings, newAgent, type AgentStreamEvent } from '@orquestador/core';
import { ClaudeAdapter, buildSystemPrompt, type ClaudeEnvironment, type QueryFn, type SdkMessage } from '../src';

let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'orq-touched-'));
  await fs.writeFile(path.join(root, 'existente.txt'), 'antes');
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const agent = newAgent('dev', 'Dev');
const env = (): ClaudeEnvironment => ({
  projectRoot: root,
  settings: () => ({ ...defaultSettings(), permissions: 'auto' }),
  apiKey: async () => undefined,
  loadAgent: async () => agent,
  loadContexts: async () => [],
  loadSkills: async () => [],
  workFolder: async () => root,
  backup: async () => undefined,
});
const result = (text: string) => ({ type: 'result', subtype: 'success', is_error: false, result: text, usage: { input_tokens: 1, output_tokens: 1 }, total_cost_usd: 0 }) as SdkMessage;

describe('SPEC-031 · el adaptador de Claude informa de todo lo que toca', () => {
  it('[R31.12] lo creado y lo modificado sale como eventos `file` antes del resultado; lo denegado y lo que no llegó a crearse, no', async () => {
    const query: QueryFn = async function* ({ options }) {
      const use = options.canUseTool!;
      expect(await use('Write', { file_path: 'nuevo/mapa.json' })).toMatchObject({ behavior: 'allow' });
      await fs.mkdir(path.join(root, 'nuevo'));
      await fs.writeFile(path.join(root, 'nuevo/mapa.json'), '{}');
      // Se crea y luego se retoca: sigue contando como creado.
      expect(await use('Edit', { file_path: 'nuevo/mapa.json' })).toMatchObject({ behavior: 'allow' });
      expect(await use('Edit', { file_path: 'existente.txt' })).toMatchObject({ behavior: 'allow' });
      // Permitido pero la escritura nunca ocurrió.
      expect(await use('Write', { file_path: 'fantasma.txt' })).toMatchObject({ behavior: 'allow' });
      expect(await use('Write', { file_path: '../fuera.txt' })).toMatchObject({ behavior: 'deny' });
      yield result('Listo');
    };
    const out: AgentStreamEvent[] = [];
    for await (const e of new ClaudeAdapter(env(), query).run({ nodeId: 'n1', agentId: 'dev', input: { text: 'x', files: [] }, attempt: 1, ask: async () => '', previousAnswers: [] }, new AbortController().signal)) out.push(e);
    const files = out.filter((e) => e.type === 'file');
    expect(files).toEqual([
      { type: 'file', path: 'nuevo/mapa.json', change: 'created' },
      { type: 'file', path: 'existente.txt', change: 'modified' },
    ]);
    expect(out.findIndex((e) => e.type === 'result')).toBeGreaterThan(out.findIndex((e) => e.type === 'file'));
  });

  it('[R31.13] el prompt exige terminar con «Cambios realizados» explicando archivos y comandos', () => {
    const prompt = buildSystemPrompt(agent, [], [], { text: '(carpeta)' });
    expect(prompt).toContain('«Cambios realizados»');
    expect(prompt).toMatch(/creado, modificado o borrado/);
    expect(prompt).toMatch(/comandos que hayas ejecutado/);
  });
});
