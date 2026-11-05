import { describe, expect, it } from 'vitest';
import { AgentError, reduceRunState, transcriptOf, type RunEvent } from '../src';
import { ENTRY, OUTPUT, chain, diagram, edge, fan, loop, nodeFinished, ofType, setup, sleepMs, sub, waitForEvent } from './helpers';

const isQuestion = (id?: string) => (e: RunEvent) =>
  e.type === 'agent.question' && (id === undefined || e.questionId === id);
const asQuestion = (e: RunEvent) => e as Extract<RunEvent, { type: 'agent.question' }>;
const ask = (question: string, options?: string[]) => ({ question, ...(options ? { options } : {}) });

describe('SPEC-018 · preguntas de los agentes y chat', () => {
  it('[R18.1][R18.3] el agente pregunta, el usuario responde y el agente continúa con la respuesta', async () => {
    const { orch } = setup({
      scripts: {
        a: {
          asks: [ask('¿Estilo?', ['pixel art', 'vectorial'])],
          output: (_r, answers) => `estilo:${answers[0]}`,
        },
      },
    });
    const h = orch.start(chain(['a']), 'x');
    const q = asQuestion(await waitForEvent(h.bus, isQuestion()));
    expect(q).toMatchObject({ nodeId: 'a', questionId: 'q-1', text: '¿Estilo?', options: ['pixel art', 'vectorial'] });

    expect(h.answer(q.questionId, 'pixel art')).toBe(true);
    expect(h.answer(q.questionId, 'otra')).toBe(false); // ya respondida
    expect(h.answer('q-99', 'x')).toBe(false); // inexistente

    const res = await h.result;
    expect(res.status).toBe('succeeded');
    expect(res.output?.text).toBe('estilo:pixel art');
    expect(ofType(res.events, 'agent.answer')).toHaveLength(1);
  });

  it('[R18.2] el nodo queda waiting_input y los independientes siguen sin esperar', async () => {
    const { orch } = setup({ scripts: { a: { asks: [ask('¿Y ahora?')] }, b: { output: 'hecho' } } });
    const h = orch.start(fan(['a', 'b']), 'x');
    await waitForEvent(h.bus, isQuestion());
    await waitForEvent(h.bus, (e) => e.type === 'node.finished' && e.nodeId === 'b');
    const state = reduceRunState(h.bus.history());
    expect(state.nodeStatus['a']).toBe('waiting_input');
    expect(state.nodeStatus['b']).toBe('succeeded');
    expect(await Promise.race([h.result, sleepMs(30).then(() => 'pendiente')])).toBe('pendiente');

    h.answer('q-1', 'vale');
    expect((await h.result).status).toBe('succeeded');
    expect(reduceRunState(h.bus.history()).nodeStatus['a']).toBe('succeeded');
  });

  it('[R18.3] tras responder el nodo vuelve a running', async () => {
    const { orch } = setup({ scripts: { a: { asks: [ask('?')], latencyMs: 0, waitFor: undefined } } });
    const h = orch.start(chain(['a']), 'x');
    await waitForEvent(h.bus, isQuestion());
    h.answer('q-1', 'si');
    await waitForEvent(h.bus, (e) => e.type === 'agent.answer');
    expect(reduceRunState(h.bus.history()).nodeStatus['a']).toMatch(/running|succeeded/);
    await h.result;
  });

  it('[R18.4] mientras espera libera su hueco de concurrencia', async () => {
    const { orch } = setup({ scripts: { a: { asks: [ask('?')] }, b: { output: 'b-ok' } } });
    const h = orch.start(fan(['a', 'b']), 'x', { maxConcurrency: 1 });
    await waitForEvent(h.bus, isQuestion());
    // con un solo hueco, b solo puede ejecutarse si a lo liberó al preguntar
    await waitForEvent(h.bus, (e) => e.type === 'node.finished' && e.nodeId === 'b');
    h.answer('q-1', 'ok');
    expect((await h.result).status).toBe('succeeded');
  });

  it('[R18.4] sin límite de tiempo por defecto; con questionTimeoutMs el nodo falla al vencer', async () => {
    const slow = setup({ scripts: { a: { asks: [ask('?')] } } });
    const h = slow.orch.start(chain(['a']), 'x');
    await waitForEvent(h.bus, isQuestion());
    expect(await Promise.race([h.result, sleepMs(60).then(() => 'sigue')])).toBe('sigue');
    h.cancel();
    await h.result;

    const { orch } = setup({ scripts: { a: { asks: [ask('?')] } } });
    const res = await orch.start(chain(['a']), 'x', { questionTimeoutMs: 20 }).result;
    expect(res.status).toBe('failed');
    expect(nodeFinished(res.events, 'a')?.status).toBe('failed');
    expect(ofType(res.events, 'error').some((e) => e.message.includes('Tiempo de espera'))).toBe(true);
  });

  it('[R18.4] esperar al usuario no consume presupuesto', async () => {
    const { orch } = setup({
      scripts: { a: { asks: [ask('?')], usage: { inputTokens: 5, outputTokens: 5 } } },
    });
    const h = orch.start(chain(['a']), 'x', { budget: { maxTokens: 100 } });
    await waitForEvent(h.bus, isQuestion());
    await sleepMs(20);
    expect(ofType(h.bus.history(), 'run.budget_reached')).toHaveLength(0);
    h.answer('q-1', 'ok');
    const res = await h.result;
    expect(res.status).toBe('succeeded');
    expect(res.usage.inputTokens + res.usage.outputTokens).toBe(10);
  });

  it('[R18.5] varias preguntas seguidas forman una conversación con ids únicos', async () => {
    const { orch } = setup({
      scripts: {
        a: { asks: [ask('uno'), ask('dos')], output: (_r, answers) => answers.join('+') },
      },
    });
    const h = orch.start(chain(['a']), 'x');
    const q1 = asQuestion(await waitForEvent(h.bus, isQuestion('q-1')));
    h.answer(q1.questionId, 'r1');
    const q2 = asQuestion(await waitForEvent(h.bus, isQuestion('q-2')));
    expect(q2.text).toBe('dos');
    h.answer(q2.questionId, 'r2');
    const res = await h.result;
    expect(res.output?.text).toBe('r1+r2');
    expect(new Set(ofType(res.events, 'agent.question').map((e) => e.questionId)).size).toBe(2);
  });

  it('[R18.6] cancelar mientras se espera libera la espera', async () => {
    const { orch } = setup({ scripts: { a: { asks: [ask('?')] } } });
    const h = orch.start(chain(['a']), 'x');
    await waitForEvent(h.bus, isQuestion());
    h.cancel();
    const res = await h.result;
    expect(res.status).toBe('cancelled');
    expect(nodeFinished(res.events, 'a')?.status).toBe('cancelled');
    expect(h.pendingQuestions()).toEqual([]);
  });

  it('[R18.7] una respuesta durante una pausa se registra y el agente sigue al reanudar', async () => {
    const { orch } = setup({ scripts: { a: { asks: [ask('?')], output: (_r, answers) => `got:${answers[0]}` } } });
    const h = orch.start(chain(['a']), 'x');
    await waitForEvent(h.bus, isQuestion());
    h.pause();
    h.answer('q-1', 'respuesta');
    expect(ofType(h.bus.history(), 'agent.answer')).toHaveLength(1); // registrada ya
    expect(await Promise.race([h.result, sleepMs(40).then(() => 'en pausa')])).toBe('en pausa');
    h.resume();
    const res = await h.result;
    expect(res.output?.text).toBe('got:respuesta');
  });

  it('[R18.8] pendingQuestions lista las preguntas sin responder', async () => {
    const { orch } = setup({ scripts: { a: { asks: [ask('¿Color?', ['rojo', 'azul'])] } } });
    const h = orch.start(chain(['a']), 'x');
    await waitForEvent(h.bus, isQuestion());
    expect(h.pendingQuestions()).toEqual([
      { questionId: 'q-1', nodeId: 'a', nodePath: [], text: '¿Color?', options: ['rojo', 'azul'] },
    ]);
    h.answer('q-1', 'rojo');
    expect(h.pendingQuestions()).toEqual([]);
    await h.result;
  });

  it('[R18.9] preguntas y respuestas quedan en el log y la transcripción, sin secretos', async () => {
    const secret = 'sk-ant-api03-ABCDEFGH12345678';
    const { orch } = setup({ scripts: { a: { asks: [ask('¿Clave?')], output: (_r, answers) => `usé ${answers[0]}` } } });
    const h = orch.start(chain(['a']), 'x');
    await waitForEvent(h.bus, isQuestion());
    h.answer('q-1', `mi clave ${secret}`);
    const res = await h.result;
    expect(res.output?.text).toContain(secret); // el agente recibió la respuesta real
    expect(JSON.stringify(res.events)).not.toContain('sk-ant-api03');
    const types = transcriptOf(res.events, 'a').map((e) => e.type);
    expect(types.indexOf('agent.question')).toBeGreaterThan(types.indexOf('agent.request'));
    expect(types.indexOf('agent.answer')).toBeGreaterThan(types.indexOf('agent.question'));
    expect(reduceRunState(res.events).nodeStatus['a']).toBe('succeeded');
  });

  it('[R18.10] funciona dentro de bucles y subdiagramas con el nodePath correcto', async () => {
    const d = diagram(
      [ENTRY, loop('L', { mode: 'count', count: 2, maxIterations: 2, body: chain(['a'], 'b') }), OUTPUT],
      [edge('entry', 'L'), edge('L', 'output')],
    );
    const l = setup({ scripts: { a: { asks: [ask('vuelta?')] } } });
    const h = l.orch.start(d, 'x');
    const q1 = asQuestion(await waitForEvent(h.bus, isQuestion('q-1')));
    expect(q1.nodePath).toEqual(['L']);
    expect(h.pendingQuestions()[0]!.nodePath).toEqual(['L']);
    h.answer('q-1', 'a');
    await waitForEvent(h.bus, isQuestion('q-2'));
    h.answer('q-2', 'b');
    expect((await h.result).status).toBe('succeeded');

    const root = diagram([ENTRY, sub('S', 'p'), OUTPUT], [edge('entry', 'S'), edge('S', 'output')]);
    const s = setup({ templates: { p: chain(['a'], 'p') }, scripts: { a: { asks: [ask('?')] } } });
    const h2 = s.orch.start(root, 'x');
    const q = asQuestion(await waitForEvent(h2.bus, isQuestion()));
    expect(q.nodePath).toEqual(['S']);
    h2.answer(q.questionId, 'ok');
    expect((await h2.result).status).toBe('succeeded');
  });

  it('[R18.11] en un reintento no se repiten las preguntas ya respondidas', async () => {
    let calls = 0;
    const { orch } = setup({
      scripts: {
        a: {
          asks: [ask('¿Estilo?')],
          output: (_r, answers) => {
            if (++calls === 1) throw new AgentError('caída temporal', true);
            return `estilo:${answers[0]}`;
          },
        },
      },
    });
    const h = orch.start(chain(['a']), 'x', { retry: { maxAttempts: 3, baseDelayMs: 1 } });
    await waitForEvent(h.bus, isQuestion());
    h.answer('q-1', 'pixel');
    const res = await h.result;
    expect(res.status).toBe('succeeded');
    expect(res.output?.text).toBe('estilo:pixel');
    expect(ofType(res.events, 'agent.question')).toHaveLength(1);
    const requests = ofType(res.events, 'agent.request');
    expect(requests).toHaveLength(2);
    expect(requests[1]!.previousAnswers).toEqual([{ question: '¿Estilo?', answer: 'pixel' }]);
  });
});
