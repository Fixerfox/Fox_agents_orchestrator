import { describe, expect, it } from 'vitest';
import { ENTRY, OUTPUT, agent, diagram, edge, nodeFinished, ofType, router, setup } from './helpers';

const routed = (mode: 'ai' | 'rules', conds: Record<string, string | undefined> = {}) =>
  diagram(
    [ENTRY, router('r', mode), agent('sprites'), agent('gameplay'), agent('sonido'), OUTPUT],
    [
      edge('entry', 'r'),
      edge('r', 'sprites', conds.sprites),
      edge('r', 'gameplay', conds.gameplay),
      edge('r', 'sonido', conds.sonido),
      edge('sprites', 'output'),
      edge('gameplay', 'output'),
      edge('sonido', 'output'),
    ],
  );

const pick = (...ids: string[]) => ({
  route: () => ({ edgeIds: ids.map((i) => `r->${i}`), reason: 'porque sí' }),
});

describe('SPEC-004 · enrutado', () => {
  it('[R4.1] modo rules: evalúa las condiciones y una arista sin condición siempre se elige', async () => {
    const d = routed('rules', { sprites: 'quiere sprites', gameplay: 'quiere gameplay' });
    const { orch, agents, decider } = setup({
      decider: { condition: (r) => r.condition === 'quiere sprites' },
    });
    const res = await orch.start(d, 'x').result;
    expect(res.status).toBe('succeeded');
    expect(agents.callsOf('sprites')).toHaveLength(1);
    expect(agents.callsOf('gameplay')).toHaveLength(0);
    expect(agents.callsOf('sonido')).toHaveLength(1);
    expect(decider.conditionCalls).toHaveLength(2);
  });

  it('[R4.2] modo ai: recibe candidatos con etiqueta y entrada, e ignora ids inexistentes', async () => {
    const { orch, agents, decider } = setup({
      decider: { route: () => ({ edgeIds: ['r->sprites', 'no-existe'], reason: 'solo sprites' }) },
    });
    const res = await orch.start(routed('ai'), 'pinta').result;
    expect(res.status).toBe('succeeded');
    const call = decider.routeCalls[0] as { candidates: unknown[]; input: unknown; nodeId: string };
    expect(call.nodeId).toBe('r');
    expect(call.input).toEqual({ text: 'pinta', files: [] });
    expect(call.candidates).toEqual([
      { edgeId: 'r->sprites', to: 'sprites', label: 'sprites' },
      { edgeId: 'r->gameplay', to: 'gameplay', label: 'gameplay' },
      { edgeId: 'r->sonido', to: 'sonido', label: 'sonido' },
    ]);
    expect(agents.callsOf('sprites')).toHaveLength(1);
    expect(agents.callsOf('gameplay')).toHaveLength(0);
  });

  it('[R4.3] varias rutas a la vez: las elegidas corren en paralelo y las demás se omiten', async () => {
    const { orch, agents } = setup({
      decider: pick('sprites', 'sonido'),
      scripts: { sprites: { latencyMs: 20 }, sonido: { latencyMs: 20 } },
    });
    const res = await orch.start(routed('ai'), 'x').result;
    expect(res.status).toBe('succeeded');
    expect(agents.maxActive).toBe(2);
    expect(agents.callsOf('gameplay')).toHaveLength(0);
    expect(nodeFinished(res.events, 'gameplay')?.status).toBe('skipped');
  });

  it('[R4.4] emite route.decided y decision con petición y respuesta completas', async () => {
    const { orch } = setup({ decider: pick('sprites', 'sonido') });
    const res = await orch.start(routed('ai'), 'x').result;
    const routeEv = ofType(res.events, 'route.decided');
    expect(routeEv).toHaveLength(1);
    expect(routeEv[0]).toMatchObject({
      fromNodeId: 'r',
      chosen: ['sprites', 'sonido'],
      mode: 'ai',
      reason: 'porque sí',
    });
    const decision = ofType(res.events, 'decision').find((e) => e.kind === 'route')!;
    expect(decision.nodeId).toBe('r');
    expect(JSON.stringify(decision.request)).toContain('r->gameplay');
    expect(decision.response).toEqual({ edgeIds: ['r->sprites', 'r->sonido'], reason: 'porque sí' });
  });

  it('[R4.5] si no se elige ninguna ruta el router falla', async () => {
    const { orch, agents } = setup({ decider: { route: () => ({ edgeIds: [], reason: 'ninguna' }) } });
    const res = await orch.start(routed('ai'), 'x').result;
    expect(res.status).toBe('failed');
    expect(nodeFinished(res.events, 'r')?.status).toBe('failed');
    expect(ofType(res.events, 'error').some((e) => e.message.includes('no eligió'))).toBe(true);
    expect(agents.calls).toHaveLength(0);
    expect(nodeFinished(res.events, 'sprites')?.status).toBe('skipped');
  });

  it('[R4.6] la unión tras ramas elegidas y no elegidas se ejecuta con las elegidas', async () => {
    const { orch } = setup({
      decider: pick('sprites', 'sonido'),
      scripts: { sprites: { output: 'S' }, sonido: { output: 'N' } },
    });
    const res = await orch.start(routed('ai'), 'x').result;
    expect(res.output?.text).toBe('## sprites\nS\n\n## sonido\nN');
    expect(res.output?.text).not.toContain('gameplay');
  });

  it('[R4.7] el router no modifica el contenido', async () => {
    const { orch, agents } = setup({ decider: pick('sprites') });
    const res = await orch.start(routed('ai'), 'pinta un pino').result;
    expect(nodeFinished(res.events, 'r')?.output).toEqual({ text: 'pinta un pino', files: [] });
    expect(agents.callsOf('sprites')[0]!.input.text).toBe('pinta un pino');
  });
});
