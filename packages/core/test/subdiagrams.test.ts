import { describe, expect, it } from 'vitest';
import { ENTRY, OUTPUT, agent, chain, diagram, edge, fan, nodeFinished, ofType, setup, sub } from './helpers';

const root = (templateId = 'pintar', version: number | 'latest' = 'latest', id = 'root') =>
  diagram([ENTRY, sub('S', templateId, version), OUTPUT], [edge('entry', 'S'), edge('S', 'output')], id);
const wrap = (id: string, target: string) =>
  diagram([ENTRY, sub('in', target), OUTPUT], [edge('entry', 'in'), edge('in', 'output')], id);

describe('SPEC-006 · subdiagramas', () => {
  it('[R6.1] ejecuta la plantilla resuelta como una caja negra', async () => {
    const { orch, agents, resolved } = setup({
      templates: { pintar: chain(['p1', 'p2'], 'pintar') },
      scripts: { p1: { output: (r) => `${r.input.text}>p1` }, p2: { output: (r) => `${r.input.text}>p2` } },
    });
    const res = await orch.start(root('pintar', 2), 'x').result;
    expect(res.status).toBe('succeeded');
    expect(res.output?.text).toBe('x>p1>p2');
    expect(resolved).toEqual([['pintar', 2]]);
    expect(agents.callsOf('p1')).toHaveLength(1);
  });

  it('[R6.2] emite subdiagram.started/finished y los eventos internos llevan el nodePath', async () => {
    const { orch } = setup({ templates: { pintar: chain(['p1'], 'pintar') } });
    const res = await orch.start(root('pintar', 2), 'x').result;
    expect(ofType(res.events, 'subdiagram.started')[0]).toMatchObject({ nodeId: 'S', templateId: 'pintar', version: 2 });
    expect(ofType(res.events, 'subdiagram.finished')[0]).toMatchObject({ nodeId: 'S', status: 'succeeded' });
    const p1 = ofType(res.events, 'node.started').find((e) => e.nodeId === 'p1')!;
    expect(p1.nodePath).toEqual(['S']);
  });

  it('[R6.3] se pueden anidar y el nodePath se acumula', async () => {
    const { orch } = setup({
      templates: { outer: wrap('outer', 'pintar'), pintar: chain(['p1'], 'pintar') },
    });
    const res = await orch.start(root('outer'), 'x').result;
    expect(res.status).toBe('succeeded');
    const p1 = ofType(res.events, 'node.started').find((e) => e.nodeId === 'p1')!;
    expect(p1.nodePath).toEqual(['S', 'in']);
  });

  it('[R6.4] rechaza referencias circulares directas, indirectas y al diagrama raíz', async () => {
    const msgs = async (templates: Record<string, ReturnType<typeof wrap>>, start: string) => {
      const { orch, agents } = setup({ templates });
      const res = await orch.start(root(start), 'x').result;
      expect(res.status).toBe('failed');
      expect(agents.calls).toHaveLength(0);
      return ofType(res.events, 'error').map((e) => e.message).join('|');
    };
    expect(await msgs({ a: wrap('a', 'a') }, 'a')).toContain('circular');
    expect(await msgs({ a: wrap('a', 'b'), b: wrap('b', 'a') }, 'a')).toContain('circular');
    expect(await msgs({ back: wrap('back', 'root') }, 'back')).toContain('circular');
  });

  it('[R6.5] superar la profundidad máxima falla el nodo', async () => {
    const { orch } = setup({
      templates: { outer: wrap('outer', 'pintar'), pintar: chain(['p1'], 'pintar') },
    });
    const res = await orch.start(root('outer'), 'x', { maxDepth: 1 }).result;
    expect(res.status).toBe('failed');
    expect(ofType(res.events, 'error').some((e) => e.message.includes('Profundidad máxima'))).toBe(true);
  });

  it('[R6.6] sin resolvedor o con plantilla inválida el nodo falla sin ejecutar nada de la plantilla', async () => {
    const none = setup();
    const r1 = await none.orch.start(root(), 'x').result;
    expect(r1.status).toBe('failed');
    expect(ofType(r1.events, 'error').some((e) => e.message.includes('resolvedor'))).toBe(true);

    const bad = diagram(
      [ENTRY, agent('p1'), agent('p2'), OUTPUT],
      [edge('entry', 'p1'), edge('p1', 'p2'), edge('p2', 'p1'), edge('p2', 'output')],
      'pintar',
    );
    const inv = setup({ templates: { pintar: bad } });
    const r2 = await inv.orch.start(root(), 'x').result;
    expect(r2.status).toBe('failed');
    expect(inv.agents.calls).toHaveLength(0);
    expect(ofType(r2.events, 'error').some((e) => e.message.includes('Diagrama inválido'))).toBe(true);

    const missing = setup({ templates: { otra: chain(['p1']) } });
    const r3 = await missing.orch.start(root('pintar'), 'x').result;
    expect(r3.status).toBe('failed');
    expect(nodeFinished(r3.events, 'S')?.status).toBe('failed');
  });

  it('[R6.7] comparte concurrencia y presupuesto con la ejecución padre', async () => {
    const ids = ['t1', 't2', 't3'];
    const scripts = Object.fromEntries(ids.map((i) => [i, { latencyMs: 15 }]));
    const c = setup({ templates: { pintar: fan(ids, 'pintar') }, scripts });
    const rc = await c.orch.start(root(), 'x', { maxConcurrency: 2 }).result;
    expect(rc.status).toBe('succeeded');
    expect(c.agents.maxActive).toBe(2);

    const d = diagram(
      [ENTRY, sub('S', 'pintar'), agent('after'), OUTPUT],
      [edge('entry', 'S'), edge('S', 'after'), edge('after', 'output')],
    );
    const b = setup({
      templates: { pintar: chain(['t1'], 'pintar') },
      scripts: { t1: { usage: { inputTokens: 60, outputTokens: 40 } } },
    });
    const rb = await b.orch.start(d, 'x', { budget: { maxTokens: 50 } }).result;
    expect(rb.status).toBe('failed');
    expect(rb.reason).toBe('budget_exceeded');
    expect(b.agents.callsOf('after')).toHaveLength(0);
  });
});
