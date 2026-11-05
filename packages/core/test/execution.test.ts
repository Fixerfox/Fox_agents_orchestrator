import { describe, expect, it } from 'vitest';
import { ENTRY, OUTPUT, agent, chain, diagram, edge, fan, nodeFinished, ofType, setup, types } from './helpers';

describe('SPEC-003 · ejecución del grafo', () => {
  it('[R3.1][R3.11] la orden entra por el entry y cada nodo recibe exactamente la salida del anterior', async () => {
    const { orch, agents } = setup({
      scripts: {
        a: { output: (r) => `${r.input.text.toUpperCase()} en a.txt`, files: ['a.txt'] },
        b: { output: (r) => `${r.input.text}!` },
      },
    });
    const res = await orch.start(chain(['a', 'b']), 'hola').result;
    expect(res.status).toBe('succeeded');
    expect(agents.callsOf('a')[0]!.input).toEqual({ text: 'hola', files: [] });
    expect(agents.callsOf('b')[0]!.input).toEqual({ text: 'HOLA en a.txt', files: ['a.txt'] });
    // la salida de b es solo lo que b produjo
    expect(res.output).toEqual({ text: 'HOLA en a.txt!', files: [] });
  });

  it('[R3.2] los nodos independientes se ejecutan en paralelo y la unión espera a todos', async () => {
    const d = diagram(
      [ENTRY, agent('a'), agent('b'), agent('j'), OUTPUT],
      [edge('entry', 'a'), edge('entry', 'b'), edge('a', 'j'), edge('b', 'j'), edge('j', 'output')],
    );
    const { orch, agents } = setup({ scripts: { a: { latencyMs: 30 }, b: { latencyMs: 30 } } });
    const res = await orch.start(d, 'x').result;
    expect(res.status).toBe('succeeded');
    expect(agents.maxActive).toBe(2);
    expect(agents.callsOf('j')).toHaveLength(1);
    const idx = (type: string, nodeId: string) =>
      res.events.findIndex((e) => e.type === type && 'nodeId' in e && e.nodeId === nodeId);
    expect(idx('node.finished', 'a')).toBeLessThan(idx('node.started', 'j'));
    expect(idx('node.finished', 'b')).toBeLessThan(idx('node.started', 'j'));
  });

  it('[R3.3] combina varias entradas con cabecera por origen y archivos sin duplicados', async () => {
    const d = diagram(
      [ENTRY, agent('a', 'Alfa'), agent('b', 'Beta'), agent('j'), OUTPUT],
      [edge('entry', 'a'), edge('entry', 'b'), edge('a', 'j'), edge('b', 'j'), edge('j', 'output')],
    );
    const { orch, agents } = setup({
      scripts: {
        a: { output: 'out-a (x, y)', files: ['x', 'y'] },
        b: { output: 'out-b (y, z)', files: ['y', 'z'] },
      },
    });
    await orch.start(d, 'q').result;
    const input = agents.callsOf('j')[0]!.input;
    expect(input.text).toBe('## Alfa\nout-a (x, y)\n\n## Beta\nout-b (y, z)');
    expect(input.files).toEqual(['x', 'y', 'z']);
  });

  it('[R3.3] con una sola entrada el texto pasa sin cabeceras', async () => {
    const { orch, agents } = setup({ scripts: { a: { output: 'salida' } } });
    await orch.start(chain(['a', 'b']), 'q').result;
    expect(agents.callsOf('b')[0]!.input.text).toBe('salida');
  });

  it('[R3.4] nunca supera la concurrencia máxima (4 por defecto, configurable)', async () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
    const scripts = Object.fromEntries(ids.map((i) => [i, { latencyMs: 10 }]));

    const def = setup({ scripts });
    await def.orch.start(fan(ids), 'x').result;
    expect(def.agents.maxActive).toBe(4);

    const one = setup({ scripts });
    await one.orch.start(fan(ids), 'x', { maxConcurrency: 1 }).result;
    expect(one.agents.maxActive).toBe(1);

    const two = setup({ scripts });
    const res = await two.orch.start(fan(ids), 'x', { maxConcurrency: 2 }).result;
    expect(two.agents.maxActive).toBe(2);
    expect(res.status).toBe('succeeded');
  });

  it('[R3.5][R3.6] un fallo omite a sus descendientes, los independientes continúan y el output conserva lo parcial', async () => {
    const d = diagram(
      [ENTRY, agent('a'), agent('c'), OUTPUT],
      [edge('entry', 'a'), edge('entry', 'c'), edge('a', 'output'), edge('c', 'output')],
    );
    const { orch } = setup({
      scripts: { a: { failTimes: 99, failRetriable: false }, c: { output: 'salida-c' } },
    });
    const res = await orch.start(d, 'x').result;
    expect(res.status).toBe('failed');
    expect(nodeFinished(res.events, 'a')?.status).toBe('failed');
    expect(nodeFinished(res.events, 'c')?.status).toBe('succeeded');
    // R3.6: el output se ejecuta solo con la entrada entregada (sin cabeceras)
    expect(res.output?.text).toBe('salida-c');
  });

  it('[R3.8] la omisión se propaga a los descendientes sin llamar a sus adapters', async () => {
    const { orch, agents } = setup({ scripts: { a: { failTimes: 99, failRetriable: false } } });
    const res = await orch.start(chain(['a', 'b', 'c']), 'x').result;
    expect(res.status).toBe('failed');
    expect(agents.callsOf('b')).toHaveLength(0);
    expect(agents.callsOf('c')).toHaveLength(0);
    expect(nodeFinished(res.events, 'b')?.status).toBe('skipped');
    expect(nodeFinished(res.events, 'c')?.status).toBe('skipped');
    expect(nodeFinished(res.events, 'output')?.status).toBe('skipped');
    // un nodo omitido no llega a empezar
    const started = ofType(res.events, 'node.started').map((e) => e.nodeId);
    expect(started).not.toContain('b');
  });

  it('[R3.7] un diagrama inválido no ejecuta ningún nodo y termina failed', async () => {
    const cyclic = diagram(
      [ENTRY, agent('a'), agent('b'), OUTPUT],
      [edge('entry', 'a'), edge('a', 'b'), edge('b', 'a'), edge('b', 'output')],
    );
    const { orch, agents } = setup();
    const res = await orch.start(cyclic, 'x').result;
    expect(res.status).toBe('failed');
    expect(agents.calls).toHaveLength(0);
    expect(types(res.events)).toEqual(['run.started', 'error', 'run.finished']);
    expect(ofType(res.events, 'error')[0]!.message).toContain('Diagrama inválido');
  });

  it('[R3.9] emite queued → started → finished por nodo y edge.traversed por arista entregada', async () => {
    const { orch } = setup();
    const res = await orch.start(chain(['a']), 'x').result;
    const forA = res.events.filter((e) => 'nodeId' in e && e.nodeId === 'a').map((e) => e.type);
    expect(forA.slice(0, 2)).toEqual(['node.queued', 'node.started']);
    expect(forA.at(-1)).toBe('node.finished');
    expect(ofType(res.events, 'edge.traversed').map((e) => e.edgeId)).toEqual(['entry->a', 'a->output']);
  });

  it('[R3.10] el resultado incluye estado, salida, eventos y uso acumulado', async () => {
    const usage = { inputTokens: 10, outputTokens: 5, costUsd: 0.01 };
    const { orch } = setup({ scripts: { a: { usage }, b: { usage } } });
    const handle = orch.start(chain(['a', 'b']), 'x');
    const res = await handle.result;
    expect(res.status).toBe('succeeded');
    expect(res.output).toBeDefined();
    expect(res.events).toBe(handle.bus.history());
    expect(res.usage.inputTokens).toBe(20);
    expect(res.usage.outputTokens).toBe(10);
    expect(res.usage.costUsd).toBeCloseTo(0.02);
  });
});
