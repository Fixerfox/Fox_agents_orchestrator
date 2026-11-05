import { describe, expect, it } from 'vitest';
import { AgentError, defaultSettings, newContext } from '@orquestador/core';
import { draftWithClaude, parseDraft, type ClaudeQueryOptions, type QueryFn, type SdkMessage } from '../src';

const KEY = 'sk-ant-api03-SECRETSECRETSECRET';
const ok = (text: string): SdkMessage => ({ type: 'result', subtype: 'success', is_error: false, result: text, usage: { input_tokens: 1, output_tokens: 1 }, total_cost_usd: 0 });
const throwing = (message: string): QueryFn => () => ({ [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(new Error(message)) }) });
function fake(text: string) {
  const seen: { options?: ClaudeQueryOptions; prompt?: string } = {};
  const query: QueryFn = async function* ({ prompt, options }) {
    seen.options = options;
    seen.prompt = prompt;
    yield ok(text);
  };
  return { query, seen };
}
const base = {
  settings: defaultSettings(),
  apiKey: undefined,
  cwd: '/proy',
  contexts: [{ ...newContext('guia', 'Guía'), value: 'VALOR-PRIVADO' }],
  skills: [{ id: 'pixel', name: 'Pixel', description: 'Dibuja', body: 'CUERPO-PRIVADO' }],
};

describe('SPEC-026 · borradores con Claude', () => {
  it('[R26.4] el prompt lleva nombres y descripciones, nunca valores, cuerpos ni la clave', async () => {
    const { query, seen } = fake('{"name":"A"}');
    await draftWithClaude({ ...base, apiKey: KEY, query, kind: 'agent', instruction: 'Haz un agente' });
    const sent = JSON.stringify(seen);
    expect(sent).toContain('guia: Guía');
    expect(sent).toContain('pixel: Pixel. Dibuja');
    expect(sent).not.toContain('VALOR-PRIVADO');
    expect(sent).not.toContain('CUERPO-PRIVADO');
    expect(JSON.stringify(seen.options?.systemPrompt)).not.toContain(KEY);
  });

  it('[R26.4] una sola consulta y sin herramientas', async () => {
    const { query, seen } = fake('{"name":"A"}');
    await draftWithClaude({ ...base, query, kind: 'agent', instruction: 'x' });
    expect(seen.options?.maxTurns).toBe(1);
  });

  it('[R26.6] filtra ids desconocidos, modelos no válidos y claves ajenas', () => {
    const r = parseDraft('agent', '{"name":"A","model":"gpt-9","contextIds":["guia","zzz"],"skillIds":["pixel"],"id":"hack","x":1}', base.contexts, base.skills);
    expect(r.fields).toEqual({ name: 'A', contextIds: ['guia'], skillIds: ['pixel'] });
  });

  it('[R26.6] respuestas sin JSON o sin campos lanzan un error claro', () => {
    expect(() => parseDraft('skill', 'nada', [], [])).toThrow(/formato esperado/);
    expect(() => parseDraft('skill', '{"zzz":1}', [], [])).toThrow(/ningún campo/);
  });

  it('[R26.3] al mejorar incluye el borrador actual', async () => {
    const { query, seen } = fake('{"body":"nuevo"}');
    await draftWithClaude({ ...base, query, kind: 'skill', instruction: 'acorta', current: { name: 'S', body: 'largo' } });
    expect(seen.prompt).toContain('Mejora este skill');
    expect(seen.prompt).toContain('"body": "largo"');
  });

  it('[R26.5] un fallo del SDK se explica y no filtra la clave', async () => {
    const e = await draftWithClaude({ ...base, apiKey: KEY, query: throwing(`401 ${KEY}`), kind: 'agent', instruction: 'x' }).catch((err: unknown) => err);
    expect(e).toBeInstanceOf(AgentError);
    expect((e as Error).message).not.toContain('SECRETSECRET');
  });
});
