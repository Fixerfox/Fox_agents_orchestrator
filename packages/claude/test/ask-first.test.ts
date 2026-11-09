import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AgentError, defaultSettings, newAgent, type AgentQuestion, type AgentStreamEvent } from '@orquestador/core';
import { ASK_FIRST_DENY, ASK_FIRST_OK, ASK_FIRST_REDO, ASK_FIRST_RULE, ClaudeAdapter, createWritePolicy, type ClaudeEnvironment, type ClaudeQueryOptions, type QueryFn, type SdkMessage, promptText } from '../src';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'orq-askfirst-'));
  await mkdir(join(dir, 'src'), { recursive: true });
  await writeFile(join(dir, 'src', 'a.ts'), 'x');
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe('SPEC-039 · agentes que preguntan antes de actuar', () => {
  it('[R39.3] la política deniega escribir y ejecutar hasta que el agente pregunta y tiene respuesta', async () => {
    const asked: AgentQuestion[] = [];
    let flagged = 0;
    const canUse = createWritePolicy({ root: dir, level: 'auto', askFirst: true, ask: async (q) => (asked.push(q), 'Adelante'), backup: async () => undefined, onAsked: () => void flagged++ });
    expect(await canUse('Read', { file_path: 'src/a.ts' })).toMatchObject({ behavior: 'allow' });
    expect(await canUse('Write', { file_path: 'nuevo.ts' })).toEqual({ behavior: 'deny', message: ASK_FIRST_DENY });
    expect(await canUse('Bash', { command: 'npm test' })).toEqual({ behavior: 'deny', message: ASK_FIRST_DENY });
    expect(asked).toHaveLength(0);
    expect(await canUse('AskUserQuestion', { questions: [{ question: '¿Hago A o B?', options: [{ label: 'A' }, { label: 'B' }] }] })).toMatchObject({ behavior: 'allow' });
    expect(flagged).toBe(1);
    expect(await canUse('Write', { file_path: 'nuevo.ts' })).toMatchObject({ behavior: 'allow' });
    // sin askFirst, nada cambia
    const free = createWritePolicy({ root: dir, level: 'auto', ask: async () => '', backup: async () => undefined });
    expect(await free('Write', { file_path: 'otro.ts' })).toMatchObject({ behavior: 'allow' });
  });

  function setup(askFirst: boolean, answers: string[], askInTurn = false) {
    const seen: { options?: ClaudeQueryOptions; asked: AgentQuestion[] } = { asked: [] };
    const query: QueryFn = async function* ({ options }) {
      seen.options = options;
      if (askInTurn) await options.canUseTool!('AskUserQuestion', { questions: [{ question: '¿Plan A?', options: [{ label: 'Sí' }] }] });
      yield { type: 'result', subtype: 'success', is_error: false, result: 'Hecho', usage: { input_tokens: 1, output_tokens: 1 } } as SdkMessage;
    };
    const agent = { ...newAgent('dev', 'Dev'), instructions: 'Programa', ...(askFirst ? { askFirst: true } : {}) };
    const env: ClaudeEnvironment = { projectRoot: dir, settings: () => defaultSettings(), apiKey: async () => undefined, loadAgent: async () => agent, loadContexts: async () => [], loadSkills: async () => [] };
    const request = { nodeId: 'n1', agentId: 'dev', runId: 'r1', input: { text: 'haz', files: [] }, attempt: 1, ask: async (q: AgentQuestion) => (seen.asked.push(q), answers.shift() ?? ''), previousAnswers: [] };
    const run = async () => {
      const out: AgentStreamEvent[] = [];
      for await (const e of new ClaudeAdapter(env, query).run(request, new AbortController().signal)) out.push(e);
      return out;
    };
    return { seen, run };
  }

  it('[R39.3] el prompt de un agente supervisado lleva la regla; el de los demás no', async () => {
    const a = setup(true, [ASK_FIRST_OK]);
    await a.run();
    expect(promptText(a.seen.options?.systemPrompt)).toContain(ASK_FIRST_RULE);
    const b = setup(false, []);
    await b.run();
    expect(promptText(b.seen.options?.systemPrompt)).not.toContain(ASK_FIRST_RULE);
    expect(b.seen.asked).toHaveLength(0);
  });

  it('[R39.4] si termina sin preguntar, la app pregunta; «Dar por bueno» sigue y otra respuesta repite el paso', async () => {
    const ok = setup(true, [ASK_FIRST_OK]);
    const out = await ok.run();
    expect(ok.seen.asked[0]).toEqual({ text: '«Dev» ha terminado sin consultarte. ¿Doy por bueno su resultado?', options: [ASK_FIRST_OK, ASK_FIRST_REDO], kind: 'gate', fallback: ASK_FIRST_REDO });
    expect(out.some((e) => e.type === 'result')).toBe(true);
    const redo = setup(true, ['Usa la paleta de 16 colores']);
    await expect(redo.run()).rejects.toMatchObject({ message: 'El usuario pide que lo rehaga: Usa la paleta de 16 colores', retriable: true });
    await expect(setup(true, [ASK_FIRST_REDO]).run()).rejects.toBeInstanceOf(AgentError);
    // si preguntó durante el turno, no hay pregunta extra
    const asked = setup(true, ['Sí'], true);
    await asked.run();
    expect(asked.seen.asked.map((q) => q.text)).toEqual(['¿Plan A?']);
  });
});

describe('SPEC-039 · conocimiento obligatorio del agente', () => {
  it('[R39.12] una skill obligatoria del agente va entera en el prompt; una opcional solo por ruta', async () => {
    let system = '';
    const query: QueryFn = async function* ({ options }) {
      system = promptText(options.systemPrompt);
      yield { type: 'result', subtype: 'success', is_error: false, result: 'Hecho', usage: { input_tokens: 1, output_tokens: 1 } } as SdkMessage;
    };
    const agent = { ...newAgent('imp', 'Implementador'), skillIds: ['impl', 'conv'], required: { skillIds: ['impl'] } };
    const skills = [
      { id: 'impl', name: 'Spec Kit · Implementar', description: 'Ejecuta tasks.md', body: 'PASO UNO: lee tasks.md y marca [X].' },
      { id: 'conv', name: 'Spec Kit · Converger', description: 'Completa lo que falte', body: 'CUERPO OPCIONAL' },
    ];
    const env: ClaudeEnvironment = { projectRoot: dir, settings: () => defaultSettings(), apiKey: async () => undefined, loadAgent: async () => agent, loadContexts: async () => [], loadSkills: async (ids) => skills.filter((k) => ids.includes(k.id)) };
    const request = { nodeId: 'n1', agentId: 'imp', runId: 'r1', input: { text: 'haz', files: [] }, attempt: 1, ask: async () => '', previousAnswers: [] };
    const out: AgentStreamEvent[] = [];
    for await (const e of new ClaudeAdapter(env, query).run(request, new AbortController().signal)) out.push(e);
    expect(system).toContain('Skills obligatorias: síguelas en esta tarea');
    expect(system).toContain('PASO UNO: lee tasks.md y marca [X].');
    expect(system).not.toContain('CUERPO OPCIONAL');
    expect(out).toContainEqual(expect.objectContaining({ type: 'knowledge', kind: 'skill', id: 'impl', required: true }));
  });
});
