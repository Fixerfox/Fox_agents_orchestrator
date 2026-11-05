import { describe, expect, it } from 'vitest';
import { MODELS, isKnownModel, validateDiagram } from '../src';
import { ENTRY, OUTPUT, agent, diagram, edge, ofType, setup } from './helpers';

const withModel = (model?: string) =>
  diagram([ENTRY, { ...agent('a'), ...(model !== undefined ? { model } : {}) }, OUTPUT], [edge('entry', 'a'), edge('a', 'output')]);

describe('SPEC-040 · modelo por paso', () => {
  it('[R40.1] un modelo conocido es válido; uno desconocido o en un nodo que no es agente es un problema del nodo', () => {
    for (const m of MODELS) expect(validateDiagram(withModel(m.id))).toEqual([]);
    expect(isKnownModel('claude-opus-5-5')).toBe(true);
    expect(isKnownModel('gpt-x')).toBe(false);
    expect(validateDiagram(withModel('gpt-x'))).toEqual([expect.objectContaining({ code: 'node-unknown-model', nodeId: 'a' })]);
    const onOutput = diagram([ENTRY, agent('a'), { ...OUTPUT, model: 'claude-opus-5-5' }], [edge('entry', 'a'), edge('a', 'output')]);
    expect(validateDiagram(onOutput)).toEqual([expect.objectContaining({ code: 'node-model-not-agent', nodeId: 'output' })]);
  });

  it('[R40.3] el modelo del paso llega al motor y queda en agent.request', async () => {
    const { orch, agents } = setup({});
    const res = await orch.start(withModel('claude-haiku-5-5'), 'hola').result;
    expect(res.status).toBe('succeeded');
    expect(agents.callsOf('a')[0]!.model).toBe('claude-haiku-5-5');
    expect(ofType(res.events, 'agent.request')[0]!.model).toBe('claude-haiku-5-5');
  });

  it('[R40.3] sin modelo propio no se envía ninguno: manda la ficha del agente', async () => {
    const { orch, agents } = setup({});
    const res = await orch.start(withModel(), 'hola').result;
    expect(agents.callsOf('a')[0]).not.toHaveProperty('model');
    expect(ofType(res.events, 'agent.request')[0]!).not.toHaveProperty('model');
  });
});
