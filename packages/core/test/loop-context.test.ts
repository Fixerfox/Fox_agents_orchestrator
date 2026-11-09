import { describe, expect, it } from 'vitest';
import { LOOP_HEADING, LOOP_REFINE, LOOP_REQUEST_MAX, MockAgent, MockDecider, Orchestrator, loopContext, type Diagram, type LoopFrame } from '../src';
import { ENTRY, OUTPUT, agent, chain, diagram, edge, loop, ofType } from './helpers';

const judged = (over: Partial<LoopFrame> = {}): LoopFrame => ({ label: 'Hasta que cumpla', round: 1, max: 3, mode: 'ai-judge', criterion: 'Menciona «azul».', request: 'Un haiku sobre un zorro', ...over });

describe('SPEC-084 · el texto del bucle', () => {
  it('[R84.1] vuelta, máximo, criterio y petición; sin marcos no hay bloque', () => {
    expect(loopContext([])).toBeUndefined();
    const text = loopContext([judged()])!;
    expect(text.startsWith(LOOP_HEADING)).toBe(true);
    expect(text).toContain('Bucle «Hasta que cumpla»: vuelta 1 de 3 como máximo.');
    expect(text).toContain('Termina cuando un evaluador confirme: Menciona «azul».');
    expect(text).toContain('Petición con la que empezó el bucle:\nUn haiku sobre un zorro');
    expect(text).not.toContain(LOOP_REFINE);
  });

  it('[R84.1] desde la vuelta 2: mejorar lo anterior y el motivo del evaluador; en modo count, sin criterio', () => {
    const text = loopContext([judged({ round: 2, lastReason: 'No dice «azul».' })])!;
    expect(text).toContain('vuelta 2 de 3 como máximo');
    expect(text).toContain(LOOP_REFINE);
    expect(text).toContain('En la vuelta anterior el evaluador dijo que aún no basta: No dice «azul».');
    const count = loopContext([{ label: 'Tres veces', round: 2, max: 3, mode: 'count', request: 'x' }])!;
    expect(count).toContain('Bucle «Tres veces»: vuelta 2 de 3.');
    expect(count).not.toContain('evaluador');
  });

  it('[R84.1] la petición se recorta a LOOP_REQUEST_MAX caracteres; varios bucles van de fuera a dentro', () => {
    const text = loopContext([judged({ label: 'Fuera', request: 'a'.repeat(LOOP_REQUEST_MAX + 50) }), judged({ label: 'Dentro', request: 'b' })])!;
    expect(text).toContain(`${'a'.repeat(LOOP_REQUEST_MAX)}…`);
    expect(text).not.toContain('a'.repeat(LOOP_REQUEST_MAX + 1));
    expect(text.indexOf('«Fuera»')).toBeLessThan(text.indexOf('«Dentro»'));
  });

  it('[R84.2] la petición se omite si es justo la entrada del paso', () => {
    expect(loopContext([judged()], '  Un haiku sobre un zorro ')).not.toContain('Petición con la que empezó');
    expect(loopContext([judged()], 'Otra cosa')).toContain('Petición con la que empezó');
  });
});

function poetLoop(): Diagram {
  return diagram(
    [ENTRY, loop('l', { mode: 'ai-judge', prompt: 'Menciona «azul».', maxIterations: 3, body: chain(['poeta'], 'cuerpo') }), OUTPUT],
    [edge('entry', 'l'), edge('l', 'output')],
  );
}

function orchestrator(loopContextOn: boolean) {
  const agents = new MockAgent({ poeta: { output: (r) => `haiku ${r.attempt}-${r.input.text.length}` } });
  let n = 0;
  const decider = new MockDecider({ judge: () => (++n === 1 ? { done: false, reason: 'No dice «azul».' } : { done: true, reason: 'Cumple' }) });
  return { agents, orch: new Orchestrator({ getAdapter: () => agents, decider, newRunId: () => 'run-1', ...(loopContextOn ? { loopContext: true } : {}) }) };
}

describe('SPEC-084 · el bucle lo pasa a sus agentes', () => {
  it('[R84.3][R84.4] E84.a: la vuelta 1 recibe el criterio; la 2, además, la petición original y el motivo del «no»', async () => {
    const { orch, agents } = orchestrator(true);
    const res = await orch.start(poetLoop(), 'Un haiku sobre un zorro').result;
    expect(res.status).toBe('succeeded');
    const [first, second] = agents.callsOf('poeta');
    expect(first!.loop).toContain('vuelta 1 de 3 como máximo');
    expect(first!.loop).toContain('Menciona «azul».');
    expect(first!.loop).not.toContain('Petición con la que empezó');
    expect(second!.loop).toContain('vuelta 2 de 3 como máximo');
    expect(second!.loop).toContain('Petición con la que empezó el bucle:\nUn haiku sobre un zorro');
    expect(second!.loop).toContain('No dice «azul».');
    const events = ofType(res.events, 'agent.request');
    expect(events.map((e) => e.loop)).toEqual([first!.loop, second!.loop]);
  });

  it('[R84.4] sin loopContext, o fuera de un bucle, no hay campo loop', async () => {
    const off = orchestrator(false);
    await off.orch.start(poetLoop(), 'x').result;
    expect(off.agents.callsOf('poeta').every((c) => c.loop === undefined)).toBe(true);
    const on = orchestrator(true);
    const res = await on.orch.start(diagram([ENTRY, agent('poeta'), OUTPUT], [edge('entry', 'poeta'), edge('poeta', 'output')]), 'x').result;
    expect(ofType(res.events, 'agent.request')[0]!.loop).toBeUndefined();
  });
});
