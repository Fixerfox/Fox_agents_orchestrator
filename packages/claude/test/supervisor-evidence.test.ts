import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultSettings, newAgent, type AgentQuestion, type AppSettings } from '@orquestador/core';
import { ClaudeAdapter, ClaudeDecider, DENY, VERIFIER_DENY, type ClaudeEnvironment, type ClaudeQueryOptions, type QueryFn, type SdkMessage } from '../src';

const result = (text: string): SdkMessage => ({ type: 'result', subtype: 'success', is_error: false, result: text, usage: { input_tokens: 30, output_tokens: 4 }, total_cost_usd: 0.0001 });
const sig = new AbortController().signal;

function decider(reply: string, settings: Partial<AppSettings> = {}) {
  const seen: { prompt: string; system: string; model?: string | undefined }[] = [];
  const query: QueryFn = async function* ({ prompt, options }) {
    seen.push({ prompt: String(prompt), system: typeof options.systemPrompt === 'string' ? options.systemPrompt : '', model: options.model });
    yield result(reply);
  };
  return { seen, d: new ClaudeDecider({ query, projectRoot: '/p', settings: () => ({ ...defaultSettings(), ...settings }), apiKey: async () => undefined }) };
}

const review = {
  step: 'Documentador',
  input: { text: 'Documenta la API', files: [] },
  actions: ['Write: {"file":"src/api.ts"}'],
  output: { text: 'Añadí la documentación', files: ['src/api.ts'] },
  evidence: { diff: '+++ b/src/api.ts\n+export const x = 1;', checks: [{ label: 'Docs', ok: false, detail: 'No existe: docs/*.md' }], toolErrors: { count: 1, last: ['Bash: no existe'] }, stats: { created: 0, modified: 1, removed: 0 }, verification: { met: false, findings: [{ severity: 'high' as const, where: 'docs/', what: 'no hay docs' }] } },
};

describe('SPEC-075 · revisión con evidencia en Claude', () => {
  it('[R75.8] el prompt pide decidir por la evidencia, citarla y no premiar el tono; la evidencia va en los datos', async () => {
    const { d, seen } = decider('{"ok":true,"severity":"none","problems":[],"summary":"bien"}');
    await d.supervise(review, sig);
    const all = `${seen[0]!.system}\n${seen[0]!.prompt}`;
    expect(all).toContain('Decide por la evidencia');
    expect(all).toContain('no cuenta como hecha');
    expect(all).toContain('tiene que citar su evidencia');
    expect(all).toContain('No premies la longitud ni el tono seguro');
    expect(seen[0]!.prompt).toContain('+export const x = 1;');
    expect(seen[0]!.prompt).toContain('✗ Docs: No existe: docs/*.md');
    expect(seen[0]!.prompt).toContain('Herramientas que fallaron: 1');
    expect(seen[0]!.prompt).toContain('[high] docs/ — no hay docs');
  });

  it('[R75.9] lee la gravedad y los problemas con su evidencia', async () => {
    const { d } = decider('{"ok":false,"severity":"high","problems":[{"text":"Sin docs","evidence":"ningún .md en el diff"},{"nope":1}],"reason":"Faltan","summary":"s"}');
    expect(await d.supervise(review, sig)).toMatchObject({ ok: false, severity: 'high', problems: [{ text: 'Sin docs', evidence: 'ningún .md en el diff' }] });
    const { d: old } = decider('{"ok":false,"reason":"Faltan","summary":"s"}');
    const v = await old.supervise(review, sig);
    expect(v.severity).toBeUndefined();
  });

  it('[R75.19] la comprobación final usa el modelo de la comprobación final (Sonnet por defecto)', async () => {
    const { d, seen } = decider('{"met":true,"missing":""}');
    await d.verifyRun({ order: { text: 'x', files: [] }, steps: [], files: [{ path: 'a.ts', added: 3, removed: 1 }], checks: [{ label: 'tests', ok: true, detail: '' }], reviews: [{ step: 'Plan', severity: 'low', problems: ['estilo'] }] }, sig);
    expect(seen[0]!.model).toBe('claude-sonnet-5-5');
    expect(seen[0]!.prompt).toContain('a.ts (+3 −1)');
    expect(seen[0]!.prompt).toContain('Plan: low — estilo');
    const other = decider('{"met":true,"missing":""}', { supervisorVerifyModel: 'claude-opus-5-5' });
    await other.d.verifyRun({ order: { text: 'x', files: [] }, steps: [] }, sig);
    expect(other.seen[0]!.model).toBe('claude-opus-5-5');
    // La de cada paso sigue con el modelo del Supervisor.
    const step = decider('{"ok":true,"summary":"s"}');
    await step.d.supervise(review, sig);
    expect(step.seen[0]!.model).toBe('claude-haiku-5-5');
  });
});

describe('SPEC-075 · el verificador en Claude', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'orq-ver-'));
    await mkdir(join(dir, 'w'), { recursive: true });
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('[R75.14] no puede editar archivos, también con «Sin preguntar nunca»; los comandos sí', async () => {
    let options: ClaudeQueryOptions | undefined;
    const query: QueryFn = async function* ({ options: o }) {
      options = o;
      expect(await o.canUseTool!('Write', { file_path: 'x.ts', content: 'x' }, { signal: sig, toolUseID: 't1' })).toEqual({ behavior: 'deny', message: VERIFIER_DENY });
      expect(await o.canUseTool!('Edit', { file_path: 'x.ts' }, { signal: sig, toolUseID: 't2' })).toMatchObject({ behavior: 'deny' });
      expect(await o.canUseTool!('Bash', { command: 'npm test' }, { signal: sig, toolUseID: 't3' })).toMatchObject({ behavior: 'allow' });
      yield result('## Verificación\nResultado: cumple');
    };
    const env: ClaudeEnvironment = { projectRoot: dir, settings: () => ({ ...defaultSettings(), permissions: 'full' }), apiKey: async () => undefined, loadAgent: async () => ({ ...newAgent('verificador', 'Verificador'), instructions: 'v' }), loadContexts: async () => [], loadSkills: async () => [], workFolder: async () => join(dir, 'w') };
    const req = { nodeId: 'n', agentId: 'verificador', runId: 'r', input: { text: 'verifica', files: [] }, attempt: 1, ask: async (_q: AgentQuestion) => DENY, previousAnswers: [], verify: true };
    for await (const _ of new ClaudeAdapter(env, query).run(req, sig)) void _;
    expect(options).toBeDefined();
  });
});
