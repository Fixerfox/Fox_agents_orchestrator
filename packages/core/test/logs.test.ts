import { describe, expect, it } from 'vitest';
import { reduceRunState, transcriptOf, type RunEvent } from '../src';
import { ENTRY, OUTPUT, agent, chain, diagram, edge, loop, nodeFinished, ofType, router, setup } from './helpers';

const pintorScript = {
  pintor: {
    tokens: ['Hola ', 'mundo'],
    tools: [{ tool: 'Write', input: { path: 'pino.png' }, output: 'ok' }],
    usage: { inputTokens: 100, outputTokens: 20, costUsd: 0.001 },
    files: ['pino.png'],
    output: 'pino listo',
  },
};

describe('SPEC-008 · logs y trazabilidad', () => {
  it('[R8.1] agent.request guarda la entrada exacta, el intento y la foto de la configuración', async () => {
    const snapshot = { model: 'sonnet-5.5', instructions: 'pinta', skillIds: ['s1'], version: 3 };
    const { orch } = setup({ scripts: pintorScript, describeAgent: (id) => (id === 'pintor' ? snapshot : undefined) });
    const res = await orch.start(chain(['pintor']), 'dibuja un pino').result;
    const ev = ofType(res.events, 'agent.request')[0]!;
    expect(ev).toMatchObject({
      nodeId: 'pintor',
      agentId: 'pintor',
      attempt: 1,
      input: { text: 'dibuja un pino', files: [] },
      snapshot,
    });
  });

  it('[R8.2] node.started registra la entrada y node.finished la salida', async () => {
    const { orch } = setup({ scripts: pintorScript });
    const res = await orch.start(chain(['pintor']), 'dibuja un pino').result;
    const started = ofType(res.events, 'node.started').find((e) => e.nodeId === 'pintor')!;
    expect(started.input).toEqual({ text: 'dibuja un pino', files: [] });
    expect(nodeFinished(res.events, 'pintor')?.output).toEqual({ text: 'pino listo\n\nArchivos tocados (registrados por el orquestador):\n- pino.png', files: ['pino.png'] });
  });

  it('[R8.3][R8.5] todo lo que hace un agente queda en su transcripción, en orden', async () => {
    const { orch } = setup({ scripts: pintorScript });
    const res = await orch.start(chain(['pintor']), 'dibuja un pino').result;
    const tr = transcriptOf(res.events, 'pintor');
    expect(tr.map((e) => e.type)).toEqual([
      'node.queued',
      'node.started',
      'agent.request',
      'token.stream',
      'token.stream',
      'tool.called',
      'tool.result',
      'agent.usage',
      'file.produced',
      'node.finished',
    ]);
    expect(tr.every((e) => 'nodeId' in e && e.nodeId === 'pintor')).toBe(true);
    expect(ofType(tr, 'tool.called')[0]).toMatchObject({ tool: 'Write', input: { path: 'pino.png' } });
    expect(ofType(tr, 'tool.result')[0]).toMatchObject({ ok: true, output: 'ok' });
    expect(ofType(tr, 'agent.usage')[0]).toMatchObject({ inputTokens: 100, outputTokens: 20, costUsd: 0.001 });
    expect(ofType(tr, 'file.produced')[0]!.path).toBe('pino.png');
    expect(ofType(tr, 'token.stream').map((e) => e.text).join('')).toBe('Hola mundo');
  });

  it('[R8.5] la transcripción distingue el mismo id en distintos niveles por su nodePath', async () => {
    const d = diagram(
      [ENTRY, loop('L', { mode: 'count', count: 2, maxIterations: 2, body: chain(['a'], 'b') }), OUTPUT],
      [edge('entry', 'L'), edge('L', 'output')],
    );
    const { orch } = setup();
    const res = await orch.start(d, 'x').result;
    expect(transcriptOf(res.events, 'a')).toHaveLength(0);
    const inner = transcriptOf(res.events, 'a', ['L']);
    expect(inner.filter((e) => e.type === 'agent.request')).toHaveLength(2);
  });

  it('[R8.4] las decisiones de IA (enrutado, condición, evaluador) guardan petición y respuesta', async () => {
    const d = diagram(
      [
        ENTRY,
        router('r', 'ai'),
        agent('pintor'),
        loop('L', { mode: 'ai-judge', prompt: 'listo', maxIterations: 2, body: chain(['a'], 'b') }),
        router('rr', 'rules'),
        OUTPUT,
      ],
      [
        edge('entry', 'r'),
        edge('r', 'pintor'),
        edge('pintor', 'L'),
        edge('L', 'rr'),
        edge('rr', 'output', 'siempre'),
      ],
    );
    const { orch } = setup({ scripts: pintorScript });
    const res = await orch.start(d, 'x').result;
    expect(res.status).toBe('succeeded');
    const decisions = ofType(res.events, 'decision');
    expect(decisions.map((e) => [e.nodeId, e.kind]).sort()).toEqual(
      [['L', 'judge'], ['r', 'route'], ['rr', 'condition']].sort(),
    );
    for (const dcs of decisions) {
      expect(dcs.request).toBeDefined();
      expect(dcs.response).toBeDefined();
    }
  });

  it('[R8.6] reduceRunState reconstruye estado, ruta y uso a partir de los eventos', async () => {
    const d = diagram(
      [
        ENTRY,
        router('R', 'ai'),
        agent('pintor'),
        loop('L', { mode: 'count', count: 2, maxIterations: 2, body: chain(['a'], 'b') }),
        OUTPUT,
      ],
      [edge('entry', 'R'), edge('R', 'pintor'), edge('pintor', 'L'), edge('L', 'output')],
    );
    const { orch } = setup({ scripts: { ...pintorScript, a: { usage: { inputTokens: 1, outputTokens: 1 } } } });
    const h = orch.start(d, 'x');
    const live: RunEvent[] = [];
    h.bus.subscribe((e) => live.push(e), { fromSeq: 1 });
    const res = await h.result;
    const state = reduceRunState(res.events);

    expect(state.status).toBe('succeeded');
    expect(state.nodeStatus).toMatchObject({
      entry: 'succeeded',
      R: 'succeeded',
      pintor: 'succeeded',
      L: 'succeeded',
      'L/entry': 'succeeded',
      'L/a': 'succeeded',
      'L/output': 'succeeded',
      output: 'succeeded',
    });
    expect(state.route.visited.slice(0, 3)).toEqual(['entry', 'R', 'pintor']);
    expect(state.route.edges).toContain('R->pintor');
    expect(state.route.edges).toContain('L/entry->a');
    expect(state.route.decisions).toEqual([{ from: 'R', chosen: ['pintor'] }]);
    expect(state.route.loops).toEqual({ L: 2 });
    expect(state.usage).toEqual({ inputTokens: res.usage.inputTokens, outputTokens: res.usage.outputTokens, costUsd: res.usage.costUsd });
    // lo recibido en vivo reproduce exactamente el mismo estado
    expect(reduceRunState(live)).toEqual(state);
  });

  it('[R8.7] los secretos no aparecen en el log pero los datos reales no se alteran', async () => {
    const secret = 'sk-ant-api03-ABCDEFGH12345678';
    const { orch, agents } = setup({ scripts: { a: { output: `la clave es ${secret}` } } });
    const res = await orch.start(chain(['a', 'b']), 'x').result;
    expect(agents.callsOf('b')[0]!.input.text).toContain(secret);
    expect(res.output?.text).toBeDefined();
    expect(JSON.stringify(res.events)).not.toContain('sk-ant-api03');
    expect(JSON.stringify(res.events)).toContain('[REDACTED]');
  });
});
