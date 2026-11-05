import { describe, expect, it } from 'vitest';
import {
  AgentError,
  collectLinks,
  deliverableBrief,
  deliverableGoal,
  deliverableProblems,
  finalSteps,
  resumePlan,
  validateDiagram,
  type DeliverableSpec,
  type Diagram,
  type DiagramNode,
  type Edge,
  type Id,
  type ReviewPort,
  type RunEvent,
} from '../src';
import { ENTRY, OUTPUT, agent, chain, diagram, edge, fan, loop, ofType, setup, sub } from './helpers';

const review = (id: Id): DiagramNode => ({ id, kind: 'review', label: id, review: { maxRounds: 3, mode: 'verdict' } });
const port = (from: Id, to: Id, p: ReviewPort): Edge => ({ id: `${from}->${to}:${p}`, from, to, port: p });
/** Entrada → Diseñador → Programador → QA → Revisión (✓/⏱ → Salida, ✗ → Programador). */
const reservas = (): Diagram =>
  diagram(
    [ENTRY, agent('dis', 'Diseñador'), agent('pro', 'Programador'), agent('qa', 'QA'), review('rev'), OUTPUT],
    [edge('entry', 'dis'), edge('dis', 'pro'), edge('pro', 'qa'), edge('qa', 'rev'), port('rev', 'output', 'approved'), port('rev', 'pro', 'rejected'), port('rev', 'output', 'exhausted')],
  );
const withD = (d: Diagram, deliverable: DeliverableSpec): Diagram => ({ ...d, deliverable });
const SPEC: DeliverableSpec = { items: [{ kind: 'links' }, { kind: 'summary' }, { kind: 'custom', title: 'Cómo arrancarlo', instructions: 'Pasos para abrirla en local' }] };
const codes = (spec: unknown) => deliverableProblems(spec).map((p) => p.code);

describe('SPEC-046 · entregable: modelo, validación y pasos finales', () => {
  it('[R46.1] valida elementos, esquema, sección propia, opciones y nombre de archivo', () => {
    expect(deliverableProblems(SPEC)).toEqual([]);
    expect(deliverableProblems({ items: [{ kind: 'json', schema: '{"type":"object"}' }], notify: 'all', onMissing: 'fail', fileName: 'web_entrega-1' })).toEqual([]);
    expect(codes({ items: [] })).toEqual(['deliverable-invalid']);
    expect(codes({ items: Array.from({ length: 7 }, () => ({ kind: 'json' })) })).toEqual(['deliverable-invalid']);
    expect(codes({ items: [{ kind: 'links' }, { kind: 'links' }] })).toEqual(['deliverable-invalid']);
    expect(codes({ items: [{ kind: 'pdf' }] })).toEqual(['deliverable-invalid']);
    expect(codes({ items: [{ kind: 'json', schema: '{no' }] })).toEqual(['deliverable-bad-schema']);
    expect(codes({ items: [{ kind: 'custom', title: '  ', instructions: 'x' }] })).toEqual(['deliverable-empty']);
    expect(codes({ items: [{ kind: 'summary', instructions: 'x'.repeat(20_001) }] })).toEqual(['deliverable-invalid']);
    expect(codes({ items: [{ kind: 'links' }], notify: 'todos' })).toEqual(['deliverable-invalid']);
    expect(codes({ items: [{ kind: 'links' }], onMissing: 'ignore' })).toEqual(['deliverable-invalid']);
    expect(codes({ items: [{ kind: 'links' }], fileName: '../x' })).toEqual(['deliverable-bad-name']);
    expect(codes({ items: [{ kind: 'links' }], extra: 1 })).toEqual(['deliverable-invalid']);
    expect(codes(null)).toEqual(['deliverable-invalid']);
    // En el diagrama, los mismos problemas.
    expect(validateDiagram(withD(chain(['a']), SPEC))).toEqual([]);
    expect(validateDiagram(withD(chain(['a']), { items: [{ kind: 'json', schema: '{no' }] })).map((i) => i.code)).toEqual(['deliverable-bad-schema']);
  });

  it('[R46.2] pasos finales: las revisiones, routers y transformar no cortan; los retornos no cuentan', () => {
    expect(finalSteps(reservas())).toEqual(['qa']);
    expect(finalSteps(chain(['a', 'b']))).toEqual(['b']);
    expect(finalSteps(fan(['a', 'b', 'c']))).toEqual(['a', 'b', 'c']);
    const viaRouter = diagram(
      [ENTRY, agent('a'), agent('b'), { id: 'r', kind: 'router', label: 'r', router: { mode: 'ai' } }, { id: 't', kind: 'transform', label: 't', transform: { mode: 'rules', format: 'text', template: '{{entrada}}' } }, OUTPUT],
      [edge('entry', 'a'), edge('entry', 'b'), edge('a', 'r'), edge('b', 'r'), edge('r', 't'), edge('t', 'output')],
    );
    expect(finalSteps(viaRouter)).toEqual(['a', 'b']);
    const withSub = diagram([ENTRY, agent('a'), sub('s', 'tpl'), OUTPUT], [edge('entry', 'a'), edge('a', 's'), edge('s', 'output')]);
    expect(finalSteps(withSub)).toEqual(['s']);
    expect(finalSteps(diagram([ENTRY, OUTPUT], [edge('entry', 'output')]))).toEqual([]);
  });

  it('[R46.4] texto completo para los pasos finales y una línea para el resto', () => {
    const brief = deliverableBrief(SPEC);
    expect(brief).toContain('Al terminar esta ejecución se entregará al usuario:');
    expect(brief).toContain('- la lista de archivos creados o modificados');
    expect(brief).toContain('- un resumen en Markdown de lo hecho');
    expect(brief).toContain('- una sección «Cómo arrancarlo»: Pasos para abrirla en local');
    const goal = deliverableGoal(SPEC);
    expect(goal.startsWith('Objetivo final de la ejecución:')).toBe(true);
    expect(goal.includes('\n')).toBe(false);
  });
});

describe('SPEC-046 · entregable: ejecución', () => {
  const scripts = {
    dis: { output: 'Paleta y componentes' },
    pro: { output: 'Hecho. Arranca con npm run dev → http://localhost:5173.', files: ['web/index.html', 'web/app.js'] },
    qa: { output: 'Todo correcto. VEREDICTO: APROBADO' },
  };

  it('[R46.3][R46.4] el entregable va en run.started y solo los pasos finales reciben el contrato', async () => {
    const { orch, agents } = setup({ scripts });
    const r = await orch.start(withD(reservas(), SPEC), 'Web de reservas').result;
    expect(r.status).toBe('succeeded');
    expect(ofType(r.events, 'run.started')[0]!.deliverable).toEqual(SPEC);
    expect(agents.callsOf('qa')[0]!.deliverable).toEqual({ role: 'final', text: deliverableBrief(SPEC) });
    expect(agents.callsOf('dis')[0]!.deliverable).toBeUndefined();
    expect(agents.callsOf('pro')[0]!.deliverable).toBeUndefined();
    expect(ofType(r.events, 'agent.request').find((e) => e.nodeId === 'qa')!.deliverable).toMatchObject({ role: 'final' });
  });

  it('[R46.3][R46.4] el de la ejecución sustituye al del diagrama; «Todos» y «Ninguno»', async () => {
    const all = setup({ scripts });
    await all.orch.start(withD(reservas(), { items: [{ kind: 'links' }] }), 'x', { deliverable: { ...SPEC, notify: 'all' } }).result;
    expect(all.agents.callsOf('qa')[0]!.deliverable!.role).toBe('final');
    expect(all.agents.callsOf('dis')[0]!.deliverable).toEqual({ role: 'goal', text: deliverableGoal(SPEC) });
    const none = setup({ scripts });
    const r = await none.orch.start(withD(reservas(), { ...SPEC, notify: 'none' }), 'x').result;
    expect(none.agents.calls.every((c) => c.deliverable === undefined)).toBe(true);
    // Sin avisar, el entregable se compone igual.
    expect(ofType(r.events, 'deliverable.done')).toHaveLength(1);
    // `null` en la ejecución lo quita aunque el diagrama lo tenga.
    const off = setup({ scripts });
    const o = await off.orch.start(withD(reservas(), SPEC), 'x', { deliverable: null }).result;
    expect(ofType(o.events, 'deliverable.done')).toHaveLength(0);
    expect(off.agents.callsOf('qa')[0]!.deliverable).toBeUndefined();
    // Sin entregable no hay nada.
    const plain = setup({ scripts });
    const p = await plain.orch.start(reservas(), 'x').result;
    expect(ofType(p.events, 'deliverable.done')).toHaveLength(0);
    expect(ofType(p.events, 'run.started')[0]!.deliverable).toBeUndefined();
    expect(p.output!.text).toContain('VEREDICTO');
  });

  it('[R46.4] con «Todos», los agentes de dentro de un bucle reciben la línea de objetivo', async () => {
    const body = chain(['inner'], 'body');
    const d = diagram([ENTRY, loop('l', { mode: 'count', count: 1, maxIterations: 2, body }), agent('fin'), OUTPUT], [edge('entry', 'l'), edge('l', 'fin'), edge('fin', 'output')]);
    const { orch, agents } = setup();
    await orch.start(withD(d, { ...SPEC, notify: 'all' }), 'x').result;
    expect(agents.callsOf('inner')[0]!.deliverable!.role).toBe('goal');
    expect(agents.callsOf('fin')[0]!.deliverable!.role).toBe('final');
  });

  it('[R46.6][R46.7][R46.10] compone enlaces sin IA, resumen y sección propia; la salida es el documento', async () => {
    const { orch, decider } = setup({ scripts });
    const r = await orch.start(withD(reservas(), SPEC), 'Web de reservas para Rizos').result;
    const [done] = ofType(r.events, 'deliverable.done');
    expect(done).toMatchObject({ nodeId: 'output', ok: true, fileName: 'entregable' });
    expect(done!.links).toEqual({ files: [{ path: 'web/index.html' }, { path: 'web/app.js' }], urls: ['http://localhost:5173'] });
    expect(done!.items.map((i) => [i.kind, i.ok, i.attempts])).toEqual([
      ['links', true, 0],
      ['summary', true, 1],
      ['custom', true, 1],
    ]);
    expect(done!.markdown.startsWith('# Entregable\n\n## Enlaces')).toBe(true);
    expect(done!.markdown).toContain('- `web/index.html`');
    expect(done!.markdown).toContain('- <http://localhost:5173>');
    expect(done!.markdown).toContain('## Resumen\n\nEjecución simulada: 3 pasos y 2 archivos creados o cambiados.');
    expect(done!.markdown).toContain('## Cómo arrancarlo\n\nSección «Cómo arrancarlo» generada por el motor simulado.');
    expect(r.output!.text).toBe(done!.markdown);
    // Dos turnos (resumen y sección), con la petición, lo que llegó y los pasos.
    expect(decider.transformCalls).toHaveLength(2);
    const req = decider.transformCalls[0]!;
    expect(req).toMatchObject({ nodeId: 'output', format: 'markdown', deliverable: { kind: 'summary', steps: 3, files: 2 } });
    expect(req.input.text).toContain('## Petición\n\nWeb de reservas para Rizos');
    expect(req.input.text).toContain('### Programador (succeeded)');
    expect(req.input.text).toContain('## Lo que llegó a la Salida\n\nTodo correcto.');
    // Sin tokens con el simulado.
    expect(ofType(r.events, 'agent.usage').filter((e) => e.nodeId === 'output')).toHaveLength(0);
  });

  it('[R46.6] sin archivos ni enlaces lo dice; los archivos de file.produced llevan si se crearon o cambiaron', () => {
    const ev = (e: Partial<RunEvent> & { type: RunEvent['type'] }, path?: Id[]) => ({ runId: 'r', seq: 1, ts: '', ...(path ? { nodePath: path } : {}), ...e }) as RunEvent;
    const events = [
      ev({ type: 'file.produced', nodeId: 'a', path: 'x.ts', change: 'created' }),
      ev({ type: 'file.produced', nodeId: 'a', path: 'x.ts', change: 'modified' }),
      ev({ type: 'file.produced', nodeId: 'a', path: 'README.md', change: 'modified' }),
      ev({ type: 'node.finished', nodeId: 'a', status: 'succeeded', output: { text: 'ver https://ej.com/a). y http://b.io.', files: ['x.ts', 'y.ts'] } }),
      ev({ type: 'node.finished', nodeId: 't', status: 'succeeded', output: { text: 'https://no-agente.com', files: [] } }),
    ];
    const links = collectLinks(events, (id) => id === 'a');
    expect(links).toEqual({ files: [{ path: 'x.ts', change: 'created' }, { path: 'README.md', change: 'modified' }, { path: 'y.ts' }], urls: ['https://ej.com/a', 'http://b.io'] });
    expect(collectLinks([], () => true)).toEqual({ files: [], urls: [] });
  });

  it('[R46.6] un JSON que no cumple el esquema se repite con el error; el que lo cumple va a json', async () => {
    let n = 0;
    const { orch, decider } = setup({ scripts, decider: { transform: () => (++n === 1 ? '{"paginas":"tres"}' : '{"paginas":3}') } });
    const schema = '{"type":"object","properties":{"paginas":{"type":"number"}},"required":["paginas"]}';
    const r = await orch.start(withD(reservas(), { items: [{ kind: 'json', schema }] }), 'x').result;
    const [done] = ofType(r.events, 'deliverable.done');
    expect(done!.items).toEqual([{ kind: 'json', title: 'Datos (JSON)', ok: true, attempts: 2 }]);
    expect(JSON.parse(done!.json!)).toEqual({ paginas: 3 });
    expect(done!.markdown).toContain('## Datos (JSON)\n\n```json');
    expect(decider.transformCalls[1]!.previousError).toContain('$.paginas');
  });

  it('[R46.7][R46.8] con «aviso» termina bien y marca el elemento; con «fallar» la ejecución falla con el motivo', async () => {
    const bad = { decider: { transform: () => '' } };
    const warn = setup({ scripts, ...bad });
    const w = await warn.orch.start(withD(reservas(), SPEC), 'x').result;
    expect(w.status).toBe('succeeded');
    const [done] = ofType(w.events, 'deliverable.done');
    expect(done!.ok).toBe(false);
    expect(done!.items[1]).toEqual({ kind: 'summary', title: 'Resumen', ok: false, error: 'El resultado está vacío', attempts: 2 });
    expect(done!.markdown).toContain('## Resumen\n\nNo se pudo completar: El resultado está vacío');
    const fail = setup({ scripts, ...bad });
    const f = await fail.orch.start(withD(reservas(), { ...SPEC, onMissing: 'fail' }), 'x').result;
    expect(f.status).toBe('failed');
    const fin = ofType(f.events, 'run.finished')[0]!;
    expect(fin.status).toBe('failed');
    expect(fin.reason).toBe('El entregable no se pudo completar: Resumen: El resultado está vacío; Cómo arrancarlo: El resultado está vacío');
  });

  it('[R46.6] un error definitivo del motor no se reintenta; uno temporal gasta intento', async () => {
    let calls = 0;
    const { orch } = setup({ scripts, decider: { transform: () => (++calls === 1 ? new AgentError('saturado', true) : new AgentError('sin clave', false)) } });
    const r = await orch.start(withD(reservas(), { items: [{ kind: 'summary' }] }), 'x').result;
    expect(ofType(r.events, 'deliverable.done')[0]!.items[0]).toEqual({ kind: 'summary', title: 'Resumen', ok: false, error: 'sin clave', attempts: 2 });
  });

  it('[R46.9] los tokens de la composición son de la Salida y cuentan en el presupuesto', async () => {
    const usage = { inputTokens: 900, outputTokens: 100 };
    const counted = setup({ scripts });
    counted.decider.transform = async () => ({ text: 'Resumen', usage });
    const r = await counted.orch.start(withD(reservas(), { items: [{ kind: 'summary' }] }), 'x').result;
    expect(ofType(r.events, 'agent.usage').filter((e) => e.nodeId === 'output')).toEqual([expect.objectContaining({ inputTokens: 900, outputTokens: 100 })]);
    expect(ofType(r.events, 'deliverable.done')[0]!.items[0]!.tokens).toBe(1000);
    expect(r.usage.inputTokens).toBe(900);
    // Al alcanzar el presupuesto se detiene la ejecución, sin entregable.
    const capped = setup({ scripts });
    capped.decider.transform = async () => ({ text: 'Resumen', usage });
    const c = await capped.orch.start(withD(reservas(), { items: [{ kind: 'summary' }, { kind: 'custom', title: 'B', instructions: 'b' }] }), 'x', { budget: { maxTokens: 500 } }).result;
    expect(c.status).toBe('failed');
    expect(c.reason).toBe('budget_exceeded');
    expect(ofType(c.events, 'deliverable.done')).toHaveLength(0);
  });

  it('[R46.9] cancelar durante la composición no emite el entregable', async () => {
    const { orch, decider } = setup({ scripts });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const ref: { handle?: ReturnType<typeof orch.start> } = {};
    decider.transform = async () => {
      ref.handle!.cancel('basta');
      await gate;
      return { text: 'tarde' };
    };
    const handle = orch.start(withD(reservas(), { items: [{ kind: 'summary' }] }), 'x');
    ref.handle = handle;
    setTimeout(release, 5);
    const r = await handle.result;
    expect(r.status).toBe('cancelled');
    expect(ofType(r.events, 'deliverable.done')).toHaveLength(0);
  });

  it('[R46.6] la Salida de un subdiagrama no compone entregable; solo la principal', async () => {
    const tpl = withD(chain(['inner'], 'tpl'), SPEC);
    const d = withD(diagram([ENTRY, sub('s', 'tpl'), OUTPUT], [edge('entry', 's'), edge('s', 'output')]), { items: [{ kind: 'links' }] });
    const { orch } = setup({ templates: { tpl }, scripts: { inner: { output: 'dentro', files: ['a.txt'] } } });
    const r = await orch.start(d, 'x').result;
    const done = ofType(r.events, 'deliverable.done');
    expect(done).toHaveLength(1);
    expect(done[0]!.items.map((i) => i.kind)).toEqual(['links']);
    // Los archivos de los agentes de dentro sí cuentan.
    expect(done[0]!.links!.files).toEqual([{ path: 'a.txt' }]);
  });

  it('[R46.3][R46.6] al reanudar, lo reutilizado cuenta para los enlaces', async () => {
    const first = setup({ scripts: { ...scripts, qa: { output: 'x', failTimes: 9, failRetriable: false } } });
    const a = await first.orch.start(withD(reservas(), { items: [{ kind: 'links' }] }), 'x').result;
    expect(a.status).toBe('failed');
    const second = setup({ scripts });
    const b = await second.orch.start(withD(reservas(), { items: [{ kind: 'links' }] }), 'x', { reuse: { fromRunId: 'run-1', outputs: resumePlan(reservas(), a.events) } }).result;
    expect(second.agents.callsOf('pro')).toHaveLength(0);
    expect(ofType(b.events, 'deliverable.done')[0]!.links!.files.map((f) => f.path)).toEqual(['web/index.html', 'web/app.js']);
  });
});
