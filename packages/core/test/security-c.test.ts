import { describe, expect, it } from 'vitest';
import { MockAgent, MockDecider, Orchestrator, REDACTED, redactSecrets, redactWith } from '../src';
import { chain, ofType } from './helpers';

describe('SPEC-090 · secretos en los registros', () => {
  it('[R90.4] además de los patrones, se ocultan los valores conocidos de 6 caracteres o más', () => {
    const hide = redactWith(() => ['mi-secreto-mcp', 'abc']);
    expect(hide({ text: 'el token es mi-secreto-mcp y abc', nested: ['mi-secreto-mcp'] })).toEqual({ text: `el token es ${REDACTED} y abc`, nested: [REDACTED] });
    expect(hide({ apiKey: 'x' })).toEqual({ apiKey: REDACTED });
  });

  it('[R90.5] tokens de Slack, Google, AWS, Notion, GitLab y npm, y claves x-api-key, private_key y client_secret', () => {
    const samples = ['xoxb-1234567890-abcdefghij', `AIza${'a'.repeat(35)}`, 'AKIAABCDEFGHIJKLMNOP', `secret_${'A'.repeat(32)}`, `ntn_${'b'.repeat(40)}`, `glpat-${'c'.repeat(20)}`, `npm_${'d'.repeat(36)}`];
    for (const s of samples) expect(redactSecrets(`valor ${s} fin`)).toBe(`valor ${REDACTED} fin`);
    expect(redactSecrets({ 'x-api-key': 'a', private_key: 'b', client_secret: 'c', nombre: 'd' })).toEqual({ 'x-api-key': REDACTED, private_key: REDACTED, client_secret: REDACTED, nombre: 'd' });
  });

  it('[R90.4] el bus de la ejecución usa los valores de OrchestratorDeps.secretValues', async () => {
    const agents = new MockAgent({ a: { output: 'la clave es sk-propia-123456 de verdad' } });
    const orch = new Orchestrator({ getAdapter: () => agents, decider: new MockDecider(), newRunId: () => 'r', secretValues: () => ['sk-propia-123456'] });
    const res = await orch.start(chain(['a']), 'x').result;
    expect(JSON.stringify(res.events)).not.toContain('sk-propia-123456');
    expect(ofType(res.events, 'node.finished').find((e) => e.nodeId === 'a')?.output?.text).toContain(REDACTED);
  });
});
