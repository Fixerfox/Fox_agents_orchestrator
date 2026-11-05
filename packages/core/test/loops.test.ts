import { describe, expect, it } from 'vitest';
import type { Diagram, LoopConfig } from '../src';
import { ENTRY, OUTPUT, chain, diagram, edge, loop, nodeFinished, ofType, setup, waitForEvent } from './helpers';

const plus = { a: { output: (r: { input: { text: string } }) => `${r.input.text}+` } };
const withLoop = (cfg: Partial<LoopConfig> & Pick<LoopConfig, 'mode' | 'maxIterations'>, body = chain(['a'], 'body')): Diagram =>
  diagram(
    [ENTRY, loop('L', { body, ...cfg }), OUTPUT],
    [edge('entry', 'L'), edge('L', 'output')],
  );

describe('SPEC-005 · bucles', () => {
  it('[R5.1][R5.3] modo count: ejecuta el cuerpo completo exactamente count veces', async () => {
    const { orch, agents } = setup({ scripts: plus });
    const res = await orch.start(withLoop({ mode: 'count', count: 3, maxIterations: 5 }), 'x').result;
    expect(res.status).toBe('succeeded');
    expect(agents.callsOf('a')).toHaveLength(3);
    const bodyEntries = ofType(res.events, 'node.started').filter(
      (e) => e.nodeId === 'entry' && e.nodePath?.[0] === 'L',
    );
    expect(bodyEntries).toHaveLength(3);

    const one = setup({ scripts: plus });
    await one.orch.start(withLoop({ mode: 'count', count: 1, maxIterations: 5 }), 'x').result;
    expect(one.agents.callsOf('a')).toHaveLength(1);
  });

  it('[R5.2] la entrada de cada vuelta es la salida de la anterior', async () => {
    const { orch, agents } = setup({ scripts: plus });
    const res = await orch.start(withLoop({ mode: 'count', count: 3, maxIterations: 3 }), 'x').result;
    expect(agents.callsOf('a').map((c) => c.input.text)).toEqual(['x', 'x+', 'x++']);
    expect(res.output?.text).toBe('x+++');
  });

  it('[R5.4] modo ai-judge: termina cuando el evaluador dice done', async () => {
    const { orch, agents, decider } = setup({
      scripts: plus,
      decider: { judge: (r) => ({ done: r.iteration === 2, reason: `vuelta ${r.iteration}` }) },
    });
    const res = await orch
      .start(withLoop({ mode: 'ai-judge', prompt: 'se ve bien', maxIterations: 5 }), 'x')
      .result;
    expect(res.status).toBe('succeeded');
    expect(agents.callsOf('a')).toHaveLength(2);
    expect(decider.judgeCalls).toEqual([
      { prompt: 'se ve bien', output: { text: 'x+', files: [] }, iteration: 1 },
      { prompt: 'se ve bien', output: { text: 'x++', files: [] }, iteration: 2 },
    ]);
  });

  it('[R5.5] al alcanzar maxIterations sin done termina con éxito e indica el máximo', async () => {
    const { orch, agents } = setup({
      scripts: plus,
      decider: { judge: () => ({ done: false, reason: 'aún no' }) },
    });
    const res = await orch
      .start(withLoop({ mode: 'ai-judge', prompt: 'listo', maxIterations: 3 }), 'x')
      .result;
    expect(res.status).toBe('succeeded');
    expect(agents.callsOf('a')).toHaveLength(3);
    const its = ofType(res.events, 'loop.iteration');
    expect(its.map((e) => e.verdict)).toEqual(['continue', 'continue', 'done']);
    expect(its[2]!.reason).toContain('máximo de iteraciones alcanzado');
  });

  it('[R5.6] emite loop.iteration por vuelta y decision del evaluador', async () => {
    const { orch } = setup({
      scripts: plus,
      decider: { judge: (r) => ({ done: r.iteration === 2, reason: 'motivo' }) },
    });
    const res = await orch
      .start(withLoop({ mode: 'ai-judge', prompt: 'p', maxIterations: 4 }), 'x')
      .result;
    expect(ofType(res.events, 'loop.iteration').map(({ loopId, n, max, verdict, reason }) => ({ loopId, n, max, verdict, reason }))).toEqual([
      { loopId: 'L', n: 1, max: 4, verdict: 'continue', reason: 'motivo' },
      { loopId: 'L', n: 2, max: 4, verdict: 'done', reason: 'motivo' },
    ]);
    const judges = ofType(res.events, 'decision').filter((e) => e.kind === 'judge');
    expect(judges).toHaveLength(2);
    expect(judges[0]!.response).toEqual({ done: false, reason: 'motivo' });

    const count = setup({ scripts: plus });
    const r2 = await count.orch.start(withLoop({ mode: 'count', count: 2, maxIterations: 2 }), 'x').result;
    expect(ofType(r2.events, 'loop.iteration').map((e) => [e.n, e.verdict])).toEqual([
      [1, 'continue'],
      [2, 'done'],
    ]);
    expect(ofType(r2.events, 'decision')).toHaveLength(0);
  });

  it('[R5.7] los eventos del cuerpo llevan nodePath del bucle (acumulado si hay anidación)', async () => {
    const innerBody = chain(['a'], 'ib');
    const outerBody = diagram(
      [ENTRY, loop('L2', { mode: 'count', count: 2, maxIterations: 2, body: innerBody }), OUTPUT],
      [edge('entry', 'L2'), edge('L2', 'output')],
      'ob',
    );
    const { orch, agents } = setup({ scripts: plus });
    const res = await orch
      .start(withLoop({ mode: 'count', count: 1, maxIterations: 1 }, outerBody), 'x')
      .result;
    expect(res.status).toBe('succeeded');
    expect(agents.callsOf('a')).toHaveLength(2);
    const aStarted = ofType(res.events, 'node.started').filter((e) => e.nodeId === 'a');
    expect(aStarted.every((e) => JSON.stringify(e.nodePath) === JSON.stringify(['L', 'L2']))).toBe(true);
    const outerIt = ofType(res.events, 'loop.iteration').find((e) => e.loopId === 'L')!;
    expect('nodePath' in outerIt).toBe(false);
    const innerIt = ofType(res.events, 'loop.iteration').find((e) => e.loopId === 'L2')!;
    expect(innerIt.nodePath).toEqual(['L']);
  });

  it('[R5.8] si el cuerpo falla, el bucle falla y no hay más vueltas', async () => {
    let n = 0;
    const { orch, agents } = setup({
      scripts: {
        a: {
          output: () => {
            if (++n === 2) throw new Error('boom');
            return 'ok';
          },
        },
      },
    });
    const res = await orch.start(withLoop({ mode: 'count', count: 5, maxIterations: 5 }), 'x').result;
    expect(res.status).toBe('failed');
    expect(nodeFinished(res.events, 'L')?.status).toBe('failed');
    expect(agents.callsOf('a')).toHaveLength(2);
    expect(ofType(res.events, 'loop.iteration')).toHaveLength(1);
  });

  it('[R5.9] cancelar durante el bucle lo detiene sin más vueltas', async () => {
    const { orch, agents } = setup({ scripts: { a: { latencyMs: 15, output: (r) => `${r.input.text}+` } } });
    const h = orch.start(withLoop({ mode: 'count', count: 50, maxIterations: 50 }), 'x');
    await waitForEvent(h.bus, (e) => e.type === 'loop.iteration' && e.n === 1);
    h.cancel();
    const res = await h.result;
    expect(res.status).toBe('cancelled');
    expect(agents.callsOf('a').length).toBeLessThanOrEqual(2);
    expect(ofType(res.events, 'loop.iteration').length).toBeLessThanOrEqual(2);
  });

  it('[R5.10] superar la profundidad máxima hace fallar el nodo', async () => {
    const inner = diagram(
      [ENTRY, loop('L2', { mode: 'count', count: 1, maxIterations: 1, body: chain(['a'], 'ib') }), OUTPUT],
      [edge('entry', 'L2'), edge('L2', 'output')],
      'mid',
    );
    const { orch, agents } = setup();
    const res = await orch
      .start(withLoop({ mode: 'count', count: 1, maxIterations: 1 }, inner), 'x', { maxDepth: 1 })
      .result;
    expect(res.status).toBe('failed');
    expect(ofType(res.events, 'error').some((e) => e.message.includes('Profundidad máxima'))).toBe(true);
    expect(agents.calls).toHaveLength(0);
  });
});
