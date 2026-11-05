import { describe, expect, it } from 'vitest';
import { mergeExtra, validateDiagram, type Diagram } from '../src';
import { ENTRY, OUTPUT, agent, diagram, edge, ofType, setup } from './helpers';

const flow = (nodeExtra?: object, diagramExtra?: object): Diagram => ({
  ...diagram([ENTRY, { ...agent('a'), ...(nodeExtra ? { extra: nodeExtra } : {}) }, OUTPUT], [edge('entry', 'a'), edge('a', 'output')]),
  ...(diagramExtra ? { extra: diagramExtra } : {}),
});

describe('SPEC-033 · conocimiento añadido', () => {
  it('[R33.1][R33.3] mergeExtra une sin repetir y quita listas vacías', () => {
    expect(mergeExtra({ skillIds: ['a', 'b'] }, { skillIds: ['b', 'c'], contextIds: [] }, undefined)).toEqual({ skillIds: ['a', 'b', 'c'] });
    expect(mergeExtra()).toEqual({});
  });

  it('[R33.2] la validación rechaza conocimiento añadido mal formado', () => {
    expect(validateDiagram(flow({ skillIds: ['pixel'] }, { contextIds: ['glosario'] }))).toEqual([]);
    expect(validateDiagram(flow({ skillIds: ['../fuera'] }))[0]).toMatchObject({ code: 'bad-extra', nodeId: 'a' });
    expect(validateDiagram(flow({ otra: [] }))[0]).toMatchObject({ code: 'bad-extra' });
    expect(validateDiagram(flow(undefined, { mcpIds: Array.from({ length: 51 }, (_, i) => `m${i}`) }))[0]).toMatchObject({ code: 'bad-extra' });
  });

  it('[R33.3][R33.4] el paso recibe lo del diagrama y lo suyo, y el registro dice de dónde viene', async () => {
    const { orch, agents } = setup({});
    const res = await orch.start(flow({ skillIds: ['trazo'], mcpIds: ['pixelart'] }, { skillIds: ['paleta', 'trazo'], contextIds: ['glosario'] }), 'hola').result;
    expect(res.status).toBe('succeeded');
    // Lo enchufado al paso llega como obligatorio [R36.21]; lo del diagrama, no.
    expect(agents.callsOf('a')[0]!.extra).toEqual({ skillIds: ['paleta', 'trazo'], contextIds: ['glosario'], mcpIds: ['pixelart'], required: { skillIds: ['trazo'], mcpIds: ['pixelart'] } });
    expect(ofType(res.events, 'agent.request')[0]!.extra).toEqual({
      diagram: { skillIds: ['paleta', 'trazo'], contextIds: ['glosario'] },
      node: { skillIds: ['trazo'], mcpIds: ['pixelart'], required: { skillIds: ['trazo'], mcpIds: ['pixelart'] } },
    });
  });

  it('[R33.3] sin nada añadido la petición y el evento no llevan extra', async () => {
    const { orch, agents } = setup({});
    const res = await orch.start(flow(), 'hola').result;
    expect(agents.callsOf('a')[0]!).not.toHaveProperty('extra');
    expect(ofType(res.events, 'agent.request')[0]!).not.toHaveProperty('extra');
  });
});
