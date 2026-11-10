import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultSettings, newAgent, newContext, type AgentDefinition, type AgentStreamEvent, type ContextDefinition, type SkillDefinition } from '@orquestador/core';
import { ClaudeAdapter, NO_DISK_SEARCH, promptText, type ClaudeEnvironment, type ClaudeQueryOptions, type QueryFn, type SdkMessage } from '../src';

let project: string;
let work: string;
beforeEach(async () => {
  project = await mkdtemp(path.join(os.tmpdir(), 'orq92-proy-'));
  work = await mkdtemp(path.join(os.tmpdir(), 'orq92-trabajo-'));
  await mkdir(path.join(project, '.orquestador', 'context-files', 'guia'), { recursive: true });
  await writeFile(path.join(project, '.orquestador', 'context-files', 'guia', 'estilo.md'), 'USA FRASES CORTAS');
});
afterEach(async () => {
  await rm(project, { recursive: true, force: true });
  await rm(work, { recursive: true, force: true });
});

const ok: SdkMessage = { type: 'result', subtype: 'success', is_error: false, result: 'Hecho', usage: { input_tokens: 1, output_tokens: 1 }, total_cost_usd: 0 };
const plan: SkillDefinition = { id: 'speckit-plan', name: 'Spec Kit · Plan', description: 'Plan técnico', body: 'Lee la plantilla de referencias/, junto a este SKILL.md: referencias/plan-template.md' };
const guide: ContextDefinition = { ...newContext('guia', 'Guía de estilo', 'file'), value: '.orquestador/context-files/guia/estilo.md' };

function env(agent: AgentDefinition): ClaudeEnvironment {
  return {
    projectRoot: project,
    settings: () => defaultSettings(),
    apiKey: async () => undefined,
    workFolder: async () => work,
    loadAgent: async () => agent,
    loadContexts: async (ids) => [guide].filter((c) => ids.includes(c.id)),
    loadSkills: async (ids) => [plan].filter((s) => ids.includes(s.id)),
  };
}
const agent: AgentDefinition = { ...newAgent('planificador', 'Planificador'), instructions: 'Planifica', skillIds: ['speckit-plan'], contextIds: ['guia'], required: { skillIds: ['speckit-plan'], contextIds: ['guia'] } } as AgentDefinition;
const request = { nodeId: 'n', agentId: 'planificador', input: { text: 'x', files: [] }, attempt: 1, ask: async () => '', previousAnswers: [] };

async function drain(it: AsyncIterable<AgentStreamEvent>): Promise<AgentStreamEvent[]> {
  const out: AgentStreamEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

describe('SPEC-092 · rutas completas', () => {
  it('[R92.2][R92.1] E92.a: la skill pegada entera dice su carpeta absoluta y que referencias/ está ahí', async () => {
    let seen: ClaudeQueryOptions | undefined;
    const query: QueryFn = async function* ({ options }) {
      seen = options;
      yield { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: path.join(project, '.orquestador', 'skills', 'speckit-plan', 'SKILL.md') } }] } } as SdkMessage;
      yield { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't2', name: 'Read', input: { file_path: path.join(project, '.orquestador', 'context-files', 'guia', 'estilo.md') } }] } } as SdkMessage;
      yield ok;
    };
    await drain(new ClaudeAdapter(env(agent), query).run(request, new AbortController().signal));
    const s = promptText(seen!.systemPrompt);
    const folder = path.join(path.resolve(project), '.orquestador', 'skills', 'speckit-plan');
    expect(s).toContain(`Carpeta de esta skill: ${folder}. Lo que la skill llama «junto a este SKILL.md» o «referencias/» está ahí.`);
    expect(s.indexOf('Carpeta de esta skill')).toBeLessThan(s.indexOf('Lee la plantilla de referencias/'));
  });

  it('[R92.3] el contexto de archivo se lee respecto al proyecto aunque se trabaje en otra carpeta, y lleva su ruta entera', async () => {
    let seen: ClaudeQueryOptions | undefined;
    const query: QueryFn = async function* ({ options }) {
      seen = options;
      yield { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: path.join(project, '.orquestador', 'skills', 'speckit-plan', 'SKILL.md') } }] } } as SdkMessage;
      yield ok;
    };
    await drain(new ClaudeAdapter(env(agent), query).run(request, new AbortController().signal));
    const s = promptText(seen!.systemPrompt);
    expect(s).toContain(`Guía de estilo (archivo: ${path.resolve(project, '.orquestador/context-files/guia/estilo.md')}):\nUSA FRASES CORTAS`);
  });

  it('[R92.4] el prompt dice dónde está todo y que no se busque por el disco', async () => {
    let seen: ClaudeQueryOptions | undefined;
    const plain = { ...newAgent('a', 'A'), instructions: 'x' };
    const query: QueryFn = async function* ({ options }) {
      seen = options;
      yield ok;
    };
    await drain(new ClaudeAdapter(env(plain), query).run({ ...request, agentId: 'a' }, new AbortController().signal));
    expect(promptText(seen!.systemPrompt)).toContain(NO_DISK_SEARCH(project));
    expect(NO_DISK_SEARCH(project)).toContain('No busques por todo el disco (find /');
  });
});

describe('SPEC-092 · fin del paso', () => {
  it('[R92.5] E92.b: con el resultado el paso termina aunque el SDK no cierre, y la sesión se aborta', async () => {
    let controller: AbortController | undefined;
    let afterResult = false;
    const plain = { ...newAgent('a', 'A'), instructions: 'x' };
    const query: QueryFn = async function* ({ options }) {
      controller = options.abortController;
      yield ok;
      // Como con una tarea en segundo plano: el flujo no se cierra nunca por sí solo.
      afterResult = true;
      await new Promise(() => undefined);
    };
    const events = await Promise.race([
      drain(new ClaudeAdapter(env(plain), query).run({ ...request, agentId: 'a' }, new AbortController().signal)),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('el paso se quedó colgado')), 3000)),
    ]);
    expect(events.find((e) => e.type === 'result')).toMatchObject({ type: 'result', text: 'Hecho' });
    expect(afterResult).toBe(false);
    expect(controller?.signal.aborted).toBe(true);
  });
});
