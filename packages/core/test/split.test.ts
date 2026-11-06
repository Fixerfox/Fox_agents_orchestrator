import { describe, expect, it } from 'vitest';
import { COORDINATOR_ID, checkSplit, composeSplitFix, parseSplit, splitBranchIds, splitInputs, splitRule, validateDiagram, type Diagram, type DiagramNode, type RunEvent } from '../src';
import { ENTRY, OUTPUT, agent, diagram, edge, ofType, setup, waitForEvent } from './helpers';

const good = (a = 'trabajo de A', b = 'trabajo de B') => `Notas para el registro\n\n## Común\n\nUsar el contrato X\n\n## Para a\n\nArchivos: src/a.ts\n${a}\n\n## Para b\n\nArchivos: src/b.ts\n${b}`;
const noB = '## Común\n\nX\n\n## Para a\n\nArchivos: src/a.ts\nhola';

/** entry → origen(split) → [a, b] → junta → output */
const fan = (more: Partial<DiagramNode> = {}, nodes: DiagramNode[] = [agent('a'), agent('b')]): Diagram =>
  diagram(
    [ENTRY, { ...agent('origen'), agentId: COORDINATOR_ID, ...more }, ...nodes, agent('junta'), OUTPUT],
    [edge('entry', 'origen'), ...nodes.flatMap((n) => [edge('origen', n.id), edge(n.id, 'junta')]), edge('junta', 'output')],
  );

const startsOf = (events: readonly RunEvent[]) => ofType(events, 'node.started').map((e) => e.nodeId);

describe('SPEC-059 · lectura de las partes', () => {
  it('[R59.6] da lo común, la parte y los archivos de cada rama', () => {
    const r = parseSplit(good(), ['a', 'b']);
    if (!r.ok) throw new Error('debería valer');
    expect(r.parts.get('a')).toEqual({ common: 'Usar el contrato X', part: 'Archivos: src/a.ts\ntrabajo de A', files: ['src/a.ts'] });
    expect(r.parts.get('b')!.files).toEqual(['src/b.ts']);
  });

  it('[R59.16] sin «## Común» no es un error: se toma vacío', () => {
    const r = parseSplit('## Para a\nArchivos: x\nuno\n## Para b\nArchivos: y\ndos', ['a', 'b']);
    expect(r.ok && r.parts.get('a')!.common).toBe('');
  });

  it('[R59.16] el id no distingue mayúsculas y acepta backticks', () => {
    const r = parseSplit('## para A\nArchivos: x\nuno\n## Para `b`\nArchivos: y\ndos', ['a', 'b']);
    expect(r.ok).toBe(true);
  });

  it('[R59.6] falta una rama o está vacía', () => {
    expect(parseSplit(noB, ['a', 'b'])).toEqual({ ok: false, problems: [{ code: 'missing-part', id: 'b' }] });
    expect(parseSplit('## Para a\nArchivos: x\nuno\n## Para b\n\n', ['a', 'b'])).toEqual({ ok: false, problems: [{ code: 'missing-part', id: 'b' }] });
  });

  it('[R59.6] una sección de un paso que no es una rama', () => {
    expect(parseSplit(`${good()}\n\n## Para otro\nArchivos: z\nhola`, ['a', 'b'])).toEqual({ ok: false, problems: [{ code: 'unknown-part', id: 'otro' }] });
  });

  it('[R59.6] una parte sin «Archivos:»', () => {
    expect(parseSplit('## Para a\nhola\n## Para b\nArchivos: y\ndos', ['a', 'b'])).toEqual({ ok: false, problems: [{ code: 'missing-files', id: 'a' }] });
    expect(parseSplit('## Para a\nArchivos:\nhola\n## Para b\nArchivos: y\ndos', ['a', 'b'])).toEqual({ ok: false, problems: [{ code: 'missing-files', id: 'a' }] });
  });

  it('[R59.16] los choques: mismo archivo, carpeta y rutas con \\', () => {
    const files = (a: string[], b: string[]) => new Map([['a', { files: a }], ['b', { files: b }]]);
    expect(checkSplit(files(['src/a.ts'], ['src/b.ts']))).toEqual([]);
    expect(checkSplit(files(['src/a.ts'], ['src/a.ts']))).toEqual([{ code: 'overlap', id: 'a', other: 'b', file: 'src/a.ts' }]);
    expect(checkSplit(files(['src/a.ts'], ['src/']))).toHaveLength(1);
    expect(checkSplit(files(['src\\a.ts'], ['./src/a.ts']))).toHaveLength(1);
    expect(checkSplit(files(['src/**'], ['src/x/y.ts']))).toHaveLength(1);
    // Que empiecen igual no es estar dentro.
    expect(checkSplit(files(['src/a'], ['src/ab.ts']))).toEqual([]);
  });

  it('[R59.6] los marcadores dentro de un bloque de código no cuentan', () => {
    const r = parseSplit('## Para a\nArchivos: x\n```\n## Para fantasma\n```\n## Para b\nArchivos: y\ndos', ['a', 'b']);
    expect(r.ok && r.parts.get('a')!.part).toContain('## Para fantasma');
  });

  it('[R59.7] la entrada de una rama lleva lo común y su parte, y nada más', () => {
    const parts = splitInputs({ text: good(), files: ['plan.md'] }, ['a', 'b'])!;
    expect(parts.get('a')).toEqual({ text: '## Común\n\nUsar el contrato X\n\n## Para a\n\nArchivos: src/a.ts\ntrabajo de A', files: ['plan.md'] });
    expect(parts.get('a')!.text).not.toContain('trabajo de B');
    expect(parts.get('a')!.text).not.toContain('Notas para el registro');
  });

  it('[R59.8] corregir el reparto repite la entrada con la lista de problemas', () => {
    expect(composeSplitFix({ text: 'Pedido', files: ['f'] }, [{ code: 'missing-part', id: 'b' }])).toEqual({ text: 'Pedido\n\n### Corrige el reparto\n\n- Falta la sección «## Para b» o está vacía.', files: ['f'] });
  });
});

describe('SPEC-059 · modelo y validación', () => {
  it('[R59.2] las ramas son los destinos, sin salidas ni repetidos', () => {
    const d = diagram([ENTRY, agent('o'), agent('a'), agent('b'), OUTPUT], [edge('entry', 'o'), edge('o', 'a'), { ...edge('o', 'a'), id: 'otra' }, edge('o', 'b'), edge('o', 'output'), edge('a', 'output'), edge('b', 'output')]);
    expect(splitBranchIds(d, 'o')).toEqual(['a', 'b']);
  });

  it('[R59.1] reparte el Coordinador; un paso normal no necesita ramas', () => {
    expect(validateDiagram(fan())).toEqual([]);
    expect(validateDiagram(fan({ agentId: 'normal' }))).toEqual([]);
    const normal = diagram([ENTRY, agent('o'), agent('a'), OUTPUT], [edge('entry', 'o'), edge('o', 'a'), edge('a', 'output')]);
    expect(validateDiagram(normal)).toEqual([]);
  });

  it('[R59.3][R59.16] un Coordinador necesita dos ramas', () => {
    const one = diagram([ENTRY, { ...agent('o'), agentId: COORDINATOR_ID }, agent('a'), OUTPUT], [edge('entry', 'o'), edge('o', 'a'), edge('o', 'output'), edge('a', 'output')]);
    expect(validateDiagram(one).map((i) => i.code)).toEqual(['node-split-needs-two']);
  });
});

describe('SPEC-059 · el motor reparte', () => {
  it('[R59.7][R59.11][R59.15] cada rama recibe solo lo suyo y la que junta espera a las dos', async () => {
    const { orch, agents } = setup({ scripts: { [COORDINATOR_ID]: { output: good() }, a: { output: 'hecho A' }, b: { output: 'hecho B' }, junta: { output: 'fin' } } });
    const r = await orch.start(fan(), 'Pedido').result;
    expect(r.status).toBe('succeeded');
    const a = agents.callsOf('a')[0]!.input.text;
    expect(a).toContain('Usar el contrato X');
    expect(a).toContain('trabajo de A');
    expect(a).not.toContain('trabajo de B');
    expect(agents.callsOf('b')[0]!.input.text).not.toContain('trabajo de A');
    const junta = agents.callsOf('junta')[0]!.input.text;
    expect(junta).toContain('hecho A');
    expect(junta).toContain('hecho B');
    expect(startsOf(r.events).indexOf('junta')).toBeGreaterThan(startsOf(r.events).indexOf('b'));
  });

  it('[R59.7] la conexión lleva la parte que se envió', async () => {
    const { orch } = setup({ scripts: { [COORDINATOR_ID]: { output: good() } } });
    const r = await orch.start(fan(), 'Pedido').result;
    const sent = ofType(r.events, 'edge.traversed').find((e) => e.toNodeId === 'b');
    expect(sent?.input?.text).toContain('trabajo de B');
    expect(ofType(r.events, 'edge.traversed').find((e) => e.fromNodeId === 'entry')).not.toHaveProperty('input');
  });

  it('[R59.4][R59.5][R59.15] el prompt lleva la regla con ids, nombres, agentes y tareas, aunque usen el mismo agente', async () => {
    const twins = [{ ...agent('i1'), agentId: 'impl', label: 'Implementador', task: 'Haz el login' }, { ...agent('i2'), agentId: 'impl', label: 'Implementador' }];
    const out = '## Para i1\nArchivos: a\nuno\n## Para i2\nArchivos: b\ndos';
    const { orch, agents } = setup({ scripts: { [COORDINATOR_ID]: { output: out } } });
    const r = await orch.start(fan({}, twins), 'Pedido').result;
    const rule = agents.callsOf(COORDINATOR_ID)[0]!.split!;
    expect(rule).toContain('`i1` · Implementador · agente: impl · tarea: Haz el login');
    expect(rule).toContain('`i2` · Implementador · agente: impl · tarea: sin tarea');
    expect(rule).toContain('2 pasos que trabajan a la vez, aislados y sin hablarse');
    expect(rule).toContain('`## Común`');
    expect(rule).toContain('`Archivos: …`');
    expect(rule).toContain('no llega a ninguna rama');
    expect(ofType(r.events, 'agent.request').find((e) => e.nodeId === 'origen')!.split).toBe(rule);
    expect(agents.callsOf('impl')[0]!.split).toBeUndefined();
  });

  it('[R59.4] la regla no se añade sin reparto', () => {
    expect(splitRule([{ id: 'a', name: 'A' }])).toContain('agente: sin agente · tarea: sin tarea');
  });

  it('[R59.2][R59.15] con una rama hacia la salida, esta recibe el texto entero y las demás su parte', async () => {
    const d = diagram([ENTRY, { ...agent('o'), agentId: COORDINATOR_ID }, agent('a'), agent('b'), OUTPUT], [edge('entry', 'o'), edge('o', 'a'), edge('o', 'b'), edge('o', 'output'), edge('a', 'output'), edge('b', 'output')]);
    const { orch, agents } = setup({ scripts: { [COORDINATOR_ID]: { output: good() }, a: { output: 'A' }, b: { output: 'B' } } });
    const r = await orch.start(d, 'Pedido').result;
    expect(r.status).toBe('succeeded');
    expect(r.output!.text).toContain('Notas para el registro');
    expect(agents.callsOf('a')[0]!.input.text).not.toContain('trabajo de B');
  });

  it('[R59.8][R59.15] si falta una parte se repite con el motivo y, arreglado, sigue', async () => {
    let n = 0;
    const { orch, agents } = setup({ scripts: { [COORDINATOR_ID]: { output: () => (++n === 1 ? noB : good()) } } });
    const r = await orch.start(fan(), 'Pedido').result;
    expect(r.status).toBe('succeeded');
    const calls = agents.callsOf(COORDINATOR_ID);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.input.text).toBe('Pedido\n\n### Corrige el reparto\n\n- Falta la sección «## Para b» o está vacía.');
    expect(ofType(r.events, 'split.rejected')).toEqual([expect.objectContaining({ nodeId: 'origen', attempt: 1, problems: [{ code: 'missing-part', id: 'b' }] })]);
    expect(ofType(r.events, 'agent.request').filter((e) => e.nodeId === 'origen').map((e) => e.attempt)).toEqual([1, 2]);
    expect(ofType(r.events, 'node.finished').filter((e) => e.nodeId === 'origen')).toHaveLength(1);
  });

  it('[R59.8][R59.15] tras 2 repeticiones falla con split-invalid y ninguna rama arranca', async () => {
    const { orch, agents } = setup({ scripts: { [COORDINATOR_ID]: { output: noB } } });
    const r = await orch.start(fan(), 'Pedido').result;
    expect(r).toMatchObject({ status: 'failed', reason: 'split-invalid' });
    expect(agents.callsOf(COORDINATOR_ID)).toHaveLength(3);
    expect(ofType(r.events, 'split.rejected')).toHaveLength(3);
    expect(agents.calls.map((c) => c.agentId)).toEqual([COORDINATOR_ID, COORDINATOR_ID, COORDINATOR_ID]);
    expect(startsOf(r.events)).not.toContain('a');
    expect(ofType(r.events, 'error').at(-1)?.message).toContain('Falta la sección «## Para b»');
  });

  it('[R59.15] dos partes que se cruzan se rechazan como overlap', async () => {
    const out = '## Para a\nArchivos: src/a.ts\nuno\n## Para b\nArchivos: src/\ndos';
    const { orch } = setup({ scripts: { [COORDINATOR_ID]: { output: out } } });
    const r = await orch.start(fan(), 'Pedido').result;
    expect(ofType(r.events, 'split.rejected')[0]!.problems).toEqual([{ code: 'overlap', id: 'a', other: 'b', file: 'src/a.ts' }]);
  });

  it('[R59.15] un paso normal envía lo mismo a todas sus ramas y no hay nada de reparto', async () => {
    const { orch, agents } = setup({ scripts: { normal: { output: 'todo' } } });
    const r = await orch.start(fan({ agentId: 'normal' }), 'Pedido').result;
    expect(r.status).toBe('succeeded');
    expect(agents.callsOf('a')[0]!.input.text).toBe('todo');
    expect(agents.callsOf('b')[0]!.input.text).toBe('todo');
    expect(ofType(r.events, 'edge.traversed').every((e) => !('input' in e))).toBe(true);
    expect(ofType(r.events, 'agent.request').every((e) => !('split' in e))).toBe(true);
  });

  it('[R59.9] con confirmación se reparte lo aprobado', async () => {
    const { orch, agents } = setup({ scripts: { [COORDINATOR_ID]: { output: good() } } });
    const h = orch.start(fan({ confirm: true }), 'Pedido');
    const q = (await waitForEvent(h.bus, (e) => e.type === 'agent.question')) as Extract<RunEvent, { type: 'agent.question' }>;
    expect(agents.callsOf('a')).toHaveLength(0);
    h.answer(q.questionId, 'Aprobar');
    const r = await h.result;
    expect(r.status).toBe('succeeded');
    expect(agents.callsOf('a')[0]!.input.text).toContain('trabajo de A');
  });

  it('[R59.9] al reanudar, lo reutilizado se reparte otra vez', async () => {
    const { orch, agents } = setup({ scripts: {} });
    const r = await orch.start(fan(), 'Pedido', { reuse: { fromRunId: 'antes', outputs: { origen: { text: good(), files: [] } } } }).result;
    expect(r.status).toBe('succeeded');
    expect(agents.callsOf(COORDINATOR_ID)).toHaveLength(0);
    expect(agents.callsOf('a')[0]!.input.text).toContain('trabajo de A');
    expect(agents.callsOf('a')[0]!.input.text).not.toContain('trabajo de B');
  });

  it('[R59.9] si lo reutilizado ya no cumple el formato, el paso se ejecuta de nuevo', async () => {
    const { orch, agents } = setup({ scripts: { [COORDINATOR_ID]: { output: good() } } });
    const r = await orch.start(fan(), 'Pedido', { reuse: { fromRunId: 'antes', outputs: { origen: { text: noB, files: [] } } } }).result;
    expect(r.status).toBe('succeeded');
    expect(agents.callsOf(COORDINATOR_ID)).toHaveLength(1);
    expect(ofType(r.events, 'node.reused')).toEqual([]);
  });

  it('[R59.10] dentro de un bucle, cada pasada se reparte con su propia salida', async () => {
    let n = 0;
    const body = fan();
    const d = diagram([ENTRY, { id: 'l', kind: 'loop', loop: { mode: 'count', count: 2, maxIterations: 3, body } }, OUTPUT], [edge('entry', 'l'), edge('l', 'output')]);
    const { orch, agents } = setup({ scripts: { [COORDINATOR_ID]: { output: () => good(`pasada ${++n}`) }, junta: { output: 'fin' } } });
    const r = await orch.start(d, 'Pedido').result;
    expect(r.status).toBe('succeeded');
    expect(agents.callsOf('a').map((c) => c.input.text.includes(`pasada ${agents.callsOf('a').indexOf(c) + 1}`))).toEqual([true, true]);
  });
});
