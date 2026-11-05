import { describe, expect, it } from 'vitest';
import { MAX_TASK_LENGTH, validateDiagram } from '../src';
import { ENTRY, OUTPUT, agent, diagram, edge, ofType, setup } from './helpers';

const withTask = (task?: string) =>
  diagram([ENTRY, { ...agent('a'), ...(task !== undefined ? { task } : {}) }, OUTPUT], [edge('entry', 'a'), edge('a', 'output')]);

describe('SPEC-032 · tarea por nodo', () => {
  it('[R32.1] una tarea dentro del límite es válida y una más larga es un problema del nodo', () => {
    expect(validateDiagram(withTask('Dibuja la entrada'))).toEqual([]);
    const issues = validateDiagram(withTask('x'.repeat(MAX_TASK_LENGTH + 1)));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: 'task-too-long', nodeId: 'a' });
  });

  it('[R32.2] el agente recibe la tarea del nodo junto a su entrada y queda en agent.request', async () => {
    const { orch, agents } = setup({});
    const res = await orch.start(withTask('  Dibuja cada enemigo  '), 'babosa, dron').result;
    expect(res.status).toBe('succeeded');
    const call = agents.callsOf('a')[0]!;
    expect(call.task).toBe('Dibuja cada enemigo');
    expect(call.input.text).toBe('babosa, dron');
    const req = ofType(res.events, 'agent.request')[0]!;
    expect(req.task).toBe('Dibuja cada enemigo');
  });

  it('[R32.2] sin tarea (o en blanco) el agente recibe solo la entrada, como antes', async () => {
    const { orch, agents } = setup({});
    const res = await orch.start(withTask('   '), 'hola').result;
    expect(agents.callsOf('a')[0]!.task).toBeUndefined();
    expect(ofType(res.events, 'agent.request')[0]!).not.toHaveProperty('task');
  });
});
