import { describe, expect, it } from 'vitest';
import type { AgentAdapter, AgentRequest, RunEvent } from '../src';
import { chain, nodeFinished, ofType, setup, waitForEvent } from './helpers';

describe('SPEC-045 · ficheros y preguntas con su tipo en el registro', () => {
  it('[R45.2] `file.produced` lleva si es nuevo o modificado, y el siguiente paso recibe el documento del anterior', async () => {
    const seen: AgentRequest[] = [];
    const adapter: AgentAdapter = {
      async *run(r) {
        seen.push(r);
        if (r.nodeId === 'spec') {
          yield { type: 'file', path: 'specs/001/spec.md', change: 'created' };
          yield { type: 'file', path: 'README.md', change: 'modified' };
          yield { type: 'file', path: 'viejo.txt' };
        }
        yield { type: 'result', text: `hecho ${r.nodeId}` };
      },
    };
    const { orch } = setup({ adapter });
    const res = await orch.start(chain(['spec', 'plan']), 'idea').result;
    expect(ofType(res.events, 'file.produced').map((e) => [e.path, e.change])).toEqual([
      ['specs/001/spec.md', 'created'],
      ['README.md', 'modified'],
      ['viejo.txt', undefined],
    ]);
    expect(nodeFinished(res.events, 'spec')?.output?.files).toEqual(['specs/001/spec.md', 'README.md', 'viejo.txt']);
    expect(seen.find((r) => r.nodeId === 'plan')?.input.files).toEqual(['specs/001/spec.md', 'README.md', 'viejo.txt']);
  });

  it('[R45.3] `agent.question` lleva el tipo de pregunta que le dio el adaptador', async () => {
    const adapter: AgentAdapter = {
      async *run(r) {
        await r.ask({ text: '¿Puedo modificar a.txt?', options: ['Permitir', 'Denegar'], kind: 'permission' });
        await r.ask({ text: '¿Color?' });
        yield { type: 'result', text: 'ok' };
      },
    };
    const { orch } = setup({ adapter });
    const h = orch.start(chain(['a']), 'x');
    const first = (await waitForEvent(h.bus, (e) => e.type === 'agent.question')) as Extract<RunEvent, { type: 'agent.question' }>;
    expect(first.kind).toBe('permission');
    h.answer(first.questionId, 'Permitir');
    const second = (await waitForEvent(h.bus, (e) => e.type === 'agent.question' && e.questionId !== first.questionId)) as Extract<RunEvent, { type: 'agent.question' }>;
    expect(second.kind).toBeUndefined();
    h.answer(second.questionId, 'rojo');
    expect((await h.result).status).toBe('succeeded');
  });

  it('[R45.2] lo escrito antes de un fallo queda en el registro del paso fallido', async () => {
    const adapter: AgentAdapter = {
      async *run() {
        yield { type: 'file', path: 'medio.md', change: 'created' };
        throw new Error('se cortó');
      },
    };
    const { orch } = setup({ adapter });
    const res = await orch.start(chain(['a']), 'x').result;
    expect(res.status).toBe('failed');
    expect(ofType(res.events, 'file.produced').filter((e) => e.path === 'medio.md').length).toBeGreaterThan(0);
  });
});
