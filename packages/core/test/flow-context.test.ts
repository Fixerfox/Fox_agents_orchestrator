import { describe, expect, it } from 'vitest';
import { COORDINATOR_ID, FLOW_HEADING, FLOW_ONLY_YOURS, flowContext, type DiagramNode, type Edge, type Id, type ReviewPort } from '../src';
import { ENTRY, OUTPUT, agent, diagram, edge, loop, ofType, router, setup, sub } from './helpers';

const withTask = (id: Id, task: string): DiagramNode => ({ ...agent(id), task });
const review = (id: Id, maxRounds = 3, mode: 'verdict' | 'ai' | 'human' = 'ai', criteria?: string): DiagramNode => ({ id, kind: 'review', label: id, review: { maxRounds, mode, ...(criteria ? { criteria } : {}) } });
const port = (from: Id, to: Id, p: ReviewPort, id = `${from}->${to}:${p}`): Edge => ({ id, from, to, port: p });

/** Entrada → prog → qa → rev (✓ → Salida, ✗ → prog). */
const qaFlow = () =>
  diagram(
    [ENTRY, withTask('prog', 'Implementa el login'), withTask('qa', 'Prueba el login y escribe los tests'), review('rev', 3, 'ai', 'Que pasen los tests'), OUTPUT],
    [edge('entry', 'prog'), edge('prog', 'qa'), edge('qa', 'rev'), port('rev', 'output', 'approved'), port('rev', 'prog', 'rejected')],
  );

describe('SPEC-080 · qué se cuenta', () => {
  it('[R80.1][R80.2][R80.4][R80.5] E80.a: el programador sabe quién va después y que su tramo pasa por una revisión', () => {
    const text = flowContext({ diagram: qaFlow(), nodeId: 'prog', agentName: (id) => (id === 'qa' ? 'Tester' : undefined) })!;
    expect(text.startsWith(FLOW_HEADING)).toBe(true);
    expect(text).toContain('- «qa», agente «Tester»: Prueba el login y escribe los tests');
    expect(text).toContain('Tu trabajo pasa después por la revisión «rev» (como mucho 3 vueltas): si la rechaza, vuelve a «prog» con las correcciones.');
    expect(text.endsWith(FLOW_ONLY_YOURS)).toBe(true);
  });

  it('[R80.2][R80.5] el que va directo a la revisión ve su criterio y el retorno en su línea, sin repetirlo', () => {
    const text = flowContext({ diagram: qaFlow(), nodeId: 'qa' })!;
    expect(text).toContain('- La revisión «rev», que decide si se aprueba con este criterio: Que pasen los tests (como mucho 3 vueltas); si se rechaza, vuelve a «prog» con las correcciones.');
    expect(text).not.toContain('Tu trabajo pasa después');
    expect(text).not.toContain('VEREDICTO');
  });

  it('[R80.2] una revisión de la persona se dice tal cual', () => {
    const d = diagram([ENTRY, agent('a'), review('rev', 2, 'human'), OUTPUT], [edge('entry', 'a'), edge('a', 'rev'), port('rev', 'output', 'approved')]);
    expect(flowContext({ diagram: d, nodeId: 'a' })).toContain('- La revisión «rev»: la revisa la persona.');
  });

  it('[R80.2] E80.b: un router por reglas enseña sus opciones con su condición', () => {
    const d = diagram(
      [ENTRY, agent('a'), router('r', 'rules'), { ...agent('fix'), label: 'Arreglar' }, { ...agent('pub'), label: 'Publicar' }, OUTPUT],
      [edge('entry', 'a'), edge('a', 'r'), edge('r', 'fix', 'hay errores'), edge('r', 'pub'), edge('fix', 'output'), edge('pub', 'output')],
    );
    const text = flowContext({ diagram: d, nodeId: 'a' })!;
    expect(text).toContain('- El router «r», que elige por reglas por dónde sigue entre: «Arreglar» (si: hay errores), «Publicar»');
    expect(text).toContain(FLOW_ONLY_YOURS);
  });

  it('[R80.2] transformar, sin tarea y salida final; sin nadie que trabaje después no se añade la regla', () => {
    const d = diagram(
      [ENTRY, agent('a'), { id: 't', kind: 'transform', label: 'A JSON', transform: { mode: 'rules', format: 'json', template: '{{entrada}}' } }, OUTPUT],
      [edge('entry', 'a'), edge('a', 't'), edge('a', 'output'), edge('t', 'output')],
    );
    const text = flowContext({ diagram: d, nodeId: 'a' })!;
    expect(text).toContain('- «A JSON», que la convierte a JSON.');
    expect(text).toContain('- La salida final de la ejecución.');
    expect(text).not.toContain(FLOW_ONLY_YOURS);
    const two = diagram([ENTRY, agent('a'), agent('b'), OUTPUT], [edge('entry', 'a'), edge('a', 'b'), edge('b', 'output')]);
    expect(flowContext({ diagram: two, nodeId: 'a' })).toContain('- «b», agente «b»: sin tarea');
  });

  it('[R80.2] como mucho 6 destinos y luego cuántos faltan; la tarea se recorta', () => {
    const ids = ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8'];
    const d = diagram([ENTRY, agent('a'), ...ids.map((i) => withTask(i, 'x'.repeat(300))), OUTPUT], [edge('entry', 'a'), ...ids.flatMap((i) => [edge('a', i), edge(i, 'output')])]);
    const text = flowContext({ diagram: d, nodeId: 'a' })!;
    expect(text.match(/^- «b/gm)).toHaveLength(6);
    expect(text).toContain('- (y 2 más)');
    expect(text).toContain(`${'x'.repeat(159)}…`);
    expect(text).not.toContain('x'.repeat(160));
  });

  it('[R80.3] un Coordinador no repite sus ramas, que ya van en la regla de reparto', () => {
    const d = diagram(
      [ENTRY, { id: 'c', kind: 'agent', agentId: COORDINATOR_ID, label: 'Coordinador' }, agent('x'), agent('y'), OUTPUT],
      [edge('entry', 'c'), edge('c', 'x'), edge('c', 'y'), edge('c', 'output'), edge('x', 'output'), edge('y', 'output')],
    );
    const text = flowContext({ diagram: d, nodeId: 'c' })!;
    expect(text).not.toContain('«x»');
    expect(text).toContain('- La salida final de la ejecución.');
  });

  it('[R80.6] dentro de un bucle: la vuelta, el máximo y la condición; la salida del cuerpo cierra la vuelta', () => {
    const body = diagram([ENTRY, agent('a'), OUTPUT], [edge('entry', 'a'), edge('a', 'output')], 'body');
    const count = loop('L', { mode: 'count', count: 3, maxIterations: 5, body });
    const text = flowContext({ diagram: body, nodeId: 'a', containers: [count], loopRound: 2 })!;
    expect(text).toContain('- El final de esta vuelta del bucle «L».');
    expect(text).toContain('Estás dentro del bucle «L»: vuelta 2 de 3. Lo que entregues en esta vuelta será la entrada de la siguiente.');
    const judge = loop('L', { mode: 'ai-judge', prompt: 'que compile', maxIterations: 4, body });
    expect(flowContext({ diagram: body, nodeId: 'a', containers: [judge], loopRound: 1 })).toContain('Estás dentro del bucle «L»: vuelta 1, como mucho 4. Se repite hasta que: que compile Lo que entregues');
  });

  it('[R80.6] en un subdiagrama dentro de un bucle: sale del subdiagrama y se describe el bucle más cercano', () => {
    const body = diagram([ENTRY, agent('a'), OUTPUT], [edge('entry', 'a'), edge('a', 'output')], 't');
    const text = flowContext({ diagram: body, nodeId: 'a', containers: [sub('S', 't'), loop('L', { mode: 'count', count: 2, maxIterations: 2, body })], loopRound: 1 })!;
    expect(text).toContain('- La salida del subdiagrama «S».');
    expect(text).toContain('Estás dentro del bucle «L»: vuelta 1 de 2.');
  });

  it('[R80.7] sin salidas, sin revisión y fuera de bucles no hay sección', () => {
    const d = diagram([ENTRY, agent('a')], [edge('entry', 'a')]);
    expect(flowContext({ diagram: d, nodeId: 'a' })).toBeUndefined();
  });
});

describe('SPEC-080 · cómo llega', () => {
  it('[R80.8][R80.10] con flow, la petición y agent.request llevan lo mismo y no cambia entre intentos', async () => {
    const { orch, agents } = setup({ flow: true, scripts: { a: { output: 'ok', failTimes: 1 } } });
    const d = diagram([ENTRY, agent('a'), withTask('b', 'Revisa'), OUTPUT], [edge('entry', 'a'), edge('a', 'b'), edge('b', 'output')]);
    const res = await orch.start(d, 'x').result;
    expect(res.status).toBe('succeeded');
    const calls = agents.callsOf('a');
    expect(calls).toHaveLength(2);
    expect(calls[0]!.flow).toContain('- «b», agente «b»: Revisa');
    expect(calls[1]!.flow).toBe(calls[0]!.flow);
    const reqs = ofType(res.events, 'agent.request').filter((e) => e.nodeId === 'a');
    expect(reqs.map((e) => e.flow)).toEqual([calls[0]!.flow, calls[0]!.flow]);
    expect(agents.callsOf('b')[0]!.flow).toContain('- La salida final de la ejecución.');
  });

  it('[R80.6][R80.8] E80.c: en un bucle count 3, cada vuelta recibe su número', async () => {
    const { orch, agents } = setup({ flow: true, scripts: { a: { output: 'ok' } } });
    const body = diagram([ENTRY, agent('a'), OUTPUT], [edge('entry', 'a'), edge('a', 'output')], 'body');
    const d = diagram([ENTRY, loop('L', { mode: 'count', count: 3, maxIterations: 3, body }), OUTPUT], [edge('entry', 'L'), edge('L', 'output')]);
    await orch.start(d, 'x').result;
    expect(agents.callsOf('a').map((c) => /vuelta (\d) de 3/.exec(c.flow ?? '')?.[1])).toEqual(['1', '2', '3']);
  });

  it('[R80.10] E80.d: sin flow, ni la petición ni el evento lo llevan', async () => {
    const { orch, agents } = setup({ scripts: { a: { output: 'ok' } } });
    const res = await orch.start(diagram([ENTRY, agent('a'), agent('b'), OUTPUT], [edge('entry', 'a'), edge('a', 'b'), edge('b', 'output')]), 'x').result;
    expect(agents.calls).toHaveLength(2);
    expect(agents.calls.every((c) => c.flow === undefined)).toBe(true);
    expect(ofType(res.events, 'agent.request').every((e) => e.flow === undefined)).toBe(true);
  });
});
