import { describe, expect, it } from 'vitest';
import { mergeExtra, stepExtra, validateDiagram, type Diagram, type KnowledgeExtra } from '../src';
import { ENTRY, OUTPUT, agent, chain, diagram, edge, loop, ofType, setup } from './helpers';

const flow = (nodeExtra?: KnowledgeExtra, diagramExtra?: KnowledgeExtra): Diagram => ({
  ...diagram([ENTRY, { ...agent('a'), ...(nodeExtra ? { extra: nodeExtra } : {}) }, OUTPUT], [edge('entry', 'a'), edge('a', 'output')]),
  ...(diagramExtra ? { extra: diagramExtra } : {}),
});

describe('SPEC-036 · conocimiento obligatorio (núcleo)', () => {
  it('[R36.1] sin `required` todo es opcional y los diagramas antiguos siguen siendo válidos', () => {
    expect(mergeExtra({ skillIds: ['a'] })).toEqual({ skillIds: ['a'] });
    expect(validateDiagram(flow({ skillIds: ['a'] }))).toEqual([]);
    expect(validateDiagram(flow({ skillIds: ['a'], required: { skillIds: ['a'] } }))).toEqual([]);
  });

  it('[R36.2] la validación rechaza un `required` mal formado o que no sea subconjunto de su lista', () => {
    const bad = (extra: object) => validateDiagram(flow(extra as KnowledgeExtra))[0];
    expect(bad({ skillIds: ['a'], required: { skillIds: ['b'] } })).toMatchObject({ code: 'bad-extra', nodeId: 'a' });
    expect(bad({ skillIds: ['a'], required: { contextIds: ['a'] } })).toMatchObject({ code: 'bad-extra' });
    expect(bad({ skillIds: ['a'], required: ['a'] })).toMatchObject({ code: 'bad-extra' });
    expect(bad({ skillIds: ['a'], required: { otra: ['a'] } })).toMatchObject({ code: 'bad-extra' });
    expect(bad({ skillIds: ['a'], required: { skillIds: ['../fuera'] } })).toMatchObject({ code: 'bad-extra' });
    const many = Array.from({ length: 51 }, (_, i) => `s${i}`);
    expect(bad({ skillIds: many, required: { skillIds: many } })).toMatchObject({ code: 'bad-extra' });
    expect(validateDiagram(flow(undefined, { mcpIds: ['m'], required: { mcpIds: ['x'] } }))[0]).toMatchObject({ code: 'bad-extra' });
  });

  it('[R36.3] mergeExtra une lo obligatorio: obligatorio en una parte lo es en el resultado', () => {
    const merged = mergeExtra({ skillIds: ['a', 'b'], required: { skillIds: ['a'] } }, { skillIds: ['b'], mcpIds: ['m'], required: { skillIds: ['b'], mcpIds: ['m'] } });
    expect(merged).toEqual({ skillIds: ['a', 'b'], mcpIds: ['m'], required: { skillIds: ['a', 'b'], mcpIds: ['m'] } });
    // opcional en el paso y obligatorio en el diagrama → obligatorio
    expect(mergeExtra({ skillIds: ['a'] }, { skillIds: ['a'], required: { skillIds: ['a'] } }).required).toEqual({ skillIds: ['a'] });
  });

  it('[R36.4] lo obligatorio que ya no está en la lista desaparece al unir', () => {
    expect(mergeExtra({ skillIds: ['a'], required: { skillIds: ['a', 'quitada'] } })).toEqual({ skillIds: ['a'], required: { skillIds: ['a'] } });
    expect(mergeExtra({ skillIds: [], required: { skillIds: ['a'] } })).toEqual({});
  });

  it('[R36.13][R36.14] el motor emite knowledge.used por lo obligatorio y agent.request lo marca', async () => {
    const { orch, agents } = setup({});
    const res = await orch.start(flow({ skillIds: ['trazo'], mcpIds: ['pixel'], required: { skillIds: ['trazo'] } }, { contextIds: ['guia'], required: { contextIds: ['guia'] } }), 'hola').result;
    expect(res.status).toBe('succeeded');
    expect(agents.callsOf('a')[0]!.extra).toEqual({ skillIds: ['trazo'], contextIds: ['guia'], mcpIds: ['pixel'], required: { skillIds: ['trazo'], contextIds: ['guia'], mcpIds: ['pixel'] } });
    expect(ofType(res.events, 'agent.request')[0]!.extra).toEqual({
      diagram: { contextIds: ['guia'], required: { contextIds: ['guia'] } },
      node: { skillIds: ['trazo'], mcpIds: ['pixel'], required: { skillIds: ['trazo'], mcpIds: ['pixel'] } },
    });
    const used = ofType(res.events, 'knowledge.used').map((e) => `${e.kind}:${e.id}:${e.via}:${e.required}:${e.attempt}`);
    expect(used.sort()).toEqual(['context:guia:inline:true:1', 'mcp:pixel:inline:true:1', 'skill:trazo:inline:true:1']);
  });

  it('[R36.11][R36.13] lo obligatorio sin usar reintenta con aviso y, al fin, el paso se completa', async () => {
    const { orch, agents } = setup({ scripts: { a: { ignoreRequired: 1 } } });
    const res = await orch.start(flow({ skillIds: ['trazo'], required: { skillIds: ['trazo'] } }), 'hola').result;
    expect(res.status).toBe('succeeded');
    expect(ofType(res.events, 'knowledge.unmet').map((e) => `${e.kind}:${e.id}:${e.attempt}`)).toEqual(['skill:trazo:1']);
    expect(ofType(res.events, 'node.retrying')).toHaveLength(1);
    expect(agents.callsOf('a')[0]!).not.toHaveProperty('missing');
    expect(agents.callsOf('a')[1]!.missing).toEqual([{ kind: 'skill', id: 'trazo' }]);
    expect(ofType(res.events, 'knowledge.used').map((e) => e.attempt)).toEqual([2]);
  });

  it('[R36.11] agotados los intentos el nodo falla: no se da por buena una salida incompleta', async () => {
    const { orch } = setup({ scripts: { a: { ignoreRequired: 99 } } });
    const res = await orch.start(flow({ skillIds: ['trazo'], required: { skillIds: ['trazo'] } }), 'hola').result;
    expect(res.status).toBe('failed');
    expect(ofType(res.events, 'knowledge.unmet')).toHaveLength(3);
  });

  it('[R36.12] sin obligatorios el simulado no emite eventos de conocimiento ni falla', async () => {
    const { orch } = setup({ scripts: { a: { ignoreRequired: 5 } } });
    // Un contexto del paso y una skill del diagrama siguen siendo opcionales si no se marcan [R36.21].
    const res = await orch.start(flow({ contextIds: ['guia'] }, { skillIds: ['trazo'] }), 'hola').result;
    expect(res.status).toBe('succeeded');
    expect(ofType(res.events, 'knowledge.used')).toEqual([]);
    expect(ofType(res.events, 'knowledge.unmet')).toEqual([]);
  });
});

describe('SPEC-036 · lo enchufado a un paso es obligatorio', () => {
  it('[R36.21] stepExtra hace obligatorias todas las skills y MCP del paso; los contextos conservan su marca', () => {
    expect(stepExtra(undefined)).toBeUndefined();
    expect(stepExtra({ skillIds: ['a', 'b'], contextIds: ['c', 'd'], mcpIds: ['m'], required: { contextIds: ['d'] } })).toEqual({
      skillIds: ['a', 'b'],
      contextIds: ['c', 'd'],
      mcpIds: ['m'],
      required: { skillIds: ['a', 'b'], contextIds: ['d'], mcpIds: ['m'] },
    });
    expect(stepExtra({ contextIds: ['c'] })).toEqual({ contextIds: ['c'] });
    // un `required` que dejase fuera una skill enchufada no la hace opcional
    expect(stepExtra({ skillIds: ['a'], required: { skillIds: [] } })!.required).toEqual({ skillIds: ['a'] });
    // no toca el objeto guardado
    const saved: KnowledgeExtra = { skillIds: ['a'] };
    stepExtra(saved);
    expect(saved).toEqual({ skillIds: ['a'] });
  });

  it('[R36.21] una skill enchufada sin marcar que el agente ignora hace reintentar y, si sigue sin usarla, el paso falla', async () => {
    const once = setup({ scripts: { a: { ignoreRequired: 1 } } });
    const ok = await once.orch.start(flow({ skillIds: ['trazo'] }), 'hola').result;
    expect(ok.status).toBe('succeeded');
    expect(ofType(ok.events, 'knowledge.unmet').map((e) => `${e.kind}:${e.id}:${e.attempt}`)).toEqual(['skill:trazo:1']);
    expect(once.agents.callsOf('a')[1]!.missing).toEqual([{ kind: 'skill', id: 'trazo' }]);
    const never = setup({ scripts: { a: { ignoreRequired: 99 } } });
    const bad = await never.orch.start(flow({ mcpIds: ['pixel'] }), 'hola').result;
    expect(bad.status).toBe('failed');
    expect(ofType(bad.events, 'knowledge.unmet').map((e) => e.kind)).toEqual(['mcp', 'mcp', 'mcp']);
  });

  it('[R36.21] también dentro de un bucle, y el diagrama guardado no cambia', async () => {
    const body = chain(['a'], 'b');
    body.nodes = body.nodes.map((n) => (n.id === 'a' ? { ...n, extra: { skillIds: ['trazo'] } } : n));
    const d = diagram([ENTRY, loop('L', { mode: 'count', count: 2, maxIterations: 2, body }), OUTPUT], [edge('entry', 'L'), edge('L', 'output')]);
    const before = JSON.stringify(d);
    const { orch, agents } = setup({});
    const res = await orch.start(d, 'hola').result;
    expect(res.status).toBe('succeeded');
    const calls = agents.callsOf('a');
    expect(calls).toHaveLength(2);
    for (const c of calls) expect(c.extra?.required).toEqual({ skillIds: ['trazo'] });
    expect(JSON.stringify(d)).toBe(before);
  });
});
