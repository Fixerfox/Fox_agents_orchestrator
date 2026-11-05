import { describe, expect, it } from 'vitest';
import {
  AgentError,
  Orchestrator,
  applyTransformRules,
  extractJsonValue,
  getJsonPath,
  renderTemplate,
  sampleFromSchema,
  simulateTransform,
  validateDiagram,
  validateJsonSchema,
  type Decider,
  type DiagramNode,
  type TransformConfig,
} from '../src';
import { ENTRY, OUTPUT, agent, diagram, edge, loop, ofType, setup } from './helpers';

const tf = (id: string, cfg: TransformConfig): DiagramNode => ({ id, kind: 'transform', label: id, transform: cfg });
/** entry → a → t → output */
const withTransform = (cfg: TransformConfig) =>
  diagram([ENTRY, agent('a'), tf('t', cfg), OUTPUT], [edge('entry', 'a'), edge('a', 't'), edge('t', 'output')]);
const SCHEMA = JSON.stringify({ type: 'object', required: ['titulo', 'tareas'], properties: { titulo: { type: 'string', minLength: 1 }, tareas: { type: 'array', items: { type: 'string' }, minItems: 1 } } });
const codes = (cfg: TransformConfig | undefined) => validateDiagram(diagram([ENTRY, { id: 't', kind: 'transform', ...(cfg ? { transform: cfg } : {}) }, OUTPUT], [edge('entry', 't'), edge('t', 'output')])).map((i) => i.code);
const input = (text: string, files: string[] = []) => ({ text, files });

describe('SPEC-037 · nodo Transformar', () => {
  it('[R37.1] un nodo transform con su configuración es un diagrama válido', () => {
    expect(codes({ mode: 'rules', format: 'json' })).toEqual([]);
    expect(codes({ mode: 'ai', format: 'json', instructions: 'Saca las tareas', schema: SCHEMA, maxAttempts: 3, sample: 'ejemplo' })).toEqual([]);
    expect(codes({ mode: 'rules', format: 'markdown', template: '# {{entrada}}' })).toEqual([]);
  });

  it('[R37.2] la validación detecta cada problema de configuración', () => {
    expect(codes(undefined)).toContain('transform-missing-config');
    expect(codes({ mode: 'x' as 'rules', format: 'json' })).toContain('transform-missing-config');
    expect(codes({ mode: 'rules', format: 'json', schema: '{ no' })).toContain('transform-bad-schema');
    expect(codes({ mode: 'rules', format: 'json', schema: '[1]' })).toContain('transform-bad-schema');
    expect(codes({ mode: 'rules', format: 'text', template: 'x', schema: '{}' })).toContain('transform-schema-needs-json');
    expect(codes({ mode: 'ai', format: 'json', instructions: '  ' })).toContain('transform-missing-instructions');
    expect(codes({ mode: 'rules', format: 'markdown' })).toContain('transform-missing-template');
    expect(codes({ mode: 'ai', format: 'json', instructions: 'x', maxAttempts: 0 })).toContain('transform-bad-attempts');
    expect(codes({ mode: 'ai', format: 'json', instructions: 'x', maxAttempts: 6 })).toContain('transform-bad-attempts');
    expect(codes({ mode: 'ai', format: 'json', instructions: 'x', maxAttempts: 1.5 })).toContain('transform-bad-attempts');
    expect(codes({ mode: 'rules', format: 'json', template: 'x'.repeat(20_001) })).toContain('transform-too-long');
  });

  it('[R37.3] la plantilla rellena entrada, archivos y rutas del JSON, y avisa de huecos vacíos', () => {
    const inp = input('Hecho:\n```json\n{"titulo":"Plan","items":[{"nombre":"uno"}],"n":3}\n```', ['a.ts', 'b.ts']);
    const r = renderTemplate('{{json.titulo}} · {{ json.items.0.nombre }} · {{json.n}}\n{{archivos}}\n{{json.falta}}{{otro}}', inp, 'markdown');
    expect(r.text).toBe('Plan · uno · 3\na.ts\nb.ts\n');
    expect(r.warnings).toEqual(['{{json.falta}}: el campo no existe', '{{otro}}: hueco desconocido']);
    expect(renderTemplate('> {{entrada}}', input('hola'), 'text').text).toBe('> hola');
    expect(renderTemplate('{{json.items}}', inp, 'text').text).toBe(JSON.stringify([{ nombre: 'uno' }], null, 2));
    expect(getJsonPath({ a: [{ b: 1 }] }, 'a.0.b')).toBe(1);
    expect(getJsonPath({ a: [1] }, 'a.x')).toBeUndefined();
    expect(renderTemplate('{{json.x}}', input('sin json'), 'text').warnings).toEqual(['{{json.x}}: la entrada no trae JSON']);
  });

  it('[R37.4] el JSON se busca en un bloque ```json y si no en el primer objeto o lista; sin plantilla, sale ese JSON', () => {
    expect(extractJsonValue('nota {"x":1} y ```json\n{"y":2}\n```')?.value).toEqual({ y: 2 });
    expect(extractJsonValue('Lista [R1] y luego [1, 2] fin')?.value).toEqual([1, 2]);
    expect(extractJsonValue('texto {"a":"}"} más')?.value).toEqual({ a: '}' });
    expect(extractJsonValue('nada aquí')).toBeUndefined();
    const ok = applyTransformRules({ mode: 'rules', format: 'json' }, input('Resultado: {"a":1}'));
    expect(ok).toEqual({ ok: true, text: '{\n  "a": 1\n}', warnings: [] });
    const bad = applyTransformRules({ mode: 'rules', format: 'json' }, input('solo prosa'));
    expect(bad.ok).toBe(false);
  });

  it('[R37.5] con formato json los huecos van codificados y el resultado tiene que ser JSON', () => {
    const inp = input('{"titulo":"Di \\"hola\\"","n":2}');
    const r = applyTransformRules({ mode: 'rules', format: 'json', template: '{"name": {{json.titulo}}, "count": {{json.n}}, "raw": {{entrada}}}' }, inp);
    expect(r.ok).toBe(true);
    if (r.ok) expect(JSON.parse(r.text)).toEqual({ name: 'Di "hola"', count: 2, raw: inp.text });
    const broken = applyTransformRules({ mode: 'rules', format: 'json', template: '{"a": {{json.n}},' }, inp);
    expect(broken.ok).toBe(false);
    if (!broken.ok) expect(broken.errors[0]).toMatch(/no es JSON válido/);
  });

  it('[R37.6] con Claude: el decider recibe formato, instrucciones, esquema y entrada; el JSON se extrae de la respuesta', async () => {
    const { orch, decider } = setup({ decider: { transform: () => 'Aquí lo tienes:\n```json\n{"titulo":"T","tareas":["a"]}\n```' } });
    const res = await orch.start(withTransform({ mode: 'ai', format: 'json', instructions: 'Saca las tareas', schema: SCHEMA }), 'pedido').result;
    expect(res.status).toBe('succeeded');
    expect(JSON.parse(res.output!.text)).toEqual({ titulo: 'T', tareas: ['a'] });
    expect(decider.transformCalls).toHaveLength(1);
    expect(decider.transformCalls[0]).toMatchObject({ nodeId: 't', format: 'json', instructions: 'Saca las tareas', schema: SCHEMA, attempt: 1, input: { text: '[a] pedido' } });
    expect(decider.transformCalls[0]!.previousError).toBeUndefined();
  });

  it('[R37.6] si el motor no sabe transformar, el nodo falla con un mensaje claro', async () => {
    const plain: Decider = { route: async () => ({ edgeIds: [], reason: '' }), judge: async () => ({ done: true, reason: '' }), condition: async () => true };
    const { agents } = setup();
    const orch = new Orchestrator({ getAdapter: () => agents, decider: plain, newRunId: () => 'r' });
    const res = await orch.start(withTransform({ mode: 'ai', format: 'text', instructions: 'resume' }), 'x').result;
    expect(res.status).toBe('failed');
    expect(ofType(res.events, 'error').at(-1)?.message).toMatch(/no sabe transformar/);
  });

  it('[R37.7] reintenta con el error como corrección hasta cumplir el esquema', async () => {
    const answers = ['{"titulo":""}', '{"titulo":"Bien","tareas":["x"]}'];
    const { orch, decider } = setup({ decider: { transform: (r) => answers[r.attempt - 1]! } });
    const res = await orch.start(withTransform({ mode: 'ai', format: 'json', instructions: 'x', schema: SCHEMA }), 'x').result;
    expect(res.status).toBe('succeeded');
    expect(decider.transformCalls).toHaveLength(2);
    expect(decider.transformCalls[1]!.previousError).toMatch(/\$\.titulo: mínimo 1 caracteres/);
    expect(decider.transformCalls[1]!.previousError).toMatch(/\$\.tareas: falta/);
    expect(ofType(res.events, 'node.retrying')).toHaveLength(1);
    expect(ofType(res.events, 'transform.done')[0]).toMatchObject({ ok: true, attempts: 2, mode: 'ai', format: 'json' });
  });

  it('[R37.7] al agotar los intentos falla con el último error; un error temporal gasta un intento y uno definitivo corta', async () => {
    const { orch, decider } = setup({ decider: { transform: () => 'no es json' } });
    const res = await orch.start(withTransform({ mode: 'ai', format: 'json', instructions: 'x', maxAttempts: 3 }), 'x').result;
    expect(res.status).toBe('failed');
    expect(decider.transformCalls).toHaveLength(3);
    expect(ofType(res.events, 'transform.done')[0]).toMatchObject({ ok: false, attempts: 3, errors: ['La respuesta no contiene JSON'] });
    expect(ofType(res.events, 'error').at(-1)?.message).toMatch(/tras 3 intentos/);

    let n = 0;
    const flaky = setup({ decider: { transform: () => (++n === 1 ? new AgentError('red caída', true) : '{"a":1}') } });
    const ok = await flaky.orch.start(withTransform({ mode: 'ai', format: 'json', instructions: 'x' }), 'x').result;
    expect(ok.status).toBe('succeeded');
    expect(flaky.decider.transformCalls).toHaveLength(2);
    expect(flaky.sleeps).toEqual([1000]);
    expect(ofType(ok.events, 'node.retrying')[0]).toMatchObject({ attempt: 1, delayMs: 1000, message: 'red caída' });

    const fatal = setup({ decider: { transform: () => new AgentError('sin sesión', false) } });
    const ko = await fatal.orch.start(withTransform({ mode: 'ai', format: 'json', instructions: 'x', maxAttempts: 4 }), 'x').result;
    expect(ko.status).toBe('failed');
    expect(fatal.decider.transformCalls).toHaveLength(1);
    expect(ofType(ko.events, 'transform.done')[0]).toMatchObject({ ok: false, attempts: 1, errors: ['sin sesión'] });
  });

  it('[R37.8] el motor simulado convierte sin tokens', () => {
    expect(JSON.parse(simulateTransform('json', SCHEMA, input('x')))).toEqual({ titulo: 'ejemplo', tareas: ['ejemplo'] });
    expect(JSON.parse(simulateTransform('json', undefined, input('hola {"a":1}')))).toEqual({ a: 1 });
    expect(JSON.parse(simulateTransform('json', undefined, input('hola')))).toEqual({ texto: 'hola' });
    expect(simulateTransform('markdown', undefined, input('hola'))).toBe('# Resultado\n\nhola');
    const s = { type: 'object', properties: { e: { enum: ['b', 'c'] }, n: { type: 'integer', minimum: 2 }, l: { type: 'array', items: { type: 'boolean' }, minItems: 2 } } };
    const v = sampleFromSchema(s);
    expect(validateJsonSchema(v, s)).toEqual([]);
  });

  it('[R37.9] subconjunto de JSON Schema con rutas en los errores; en reglas, no cumplirlo hace fallar', () => {
    const s = { type: 'object', additionalProperties: false, required: ['items'], properties: { items: { type: 'array', maxItems: 1, items: { type: 'object', required: ['nombre'], properties: { nombre: { type: 'string', maxLength: 3 }, n: { type: ['integer', 'null'], maximum: 5 }, k: { const: 'x' } } } } } };
    expect(validateJsonSchema({ items: [{ nombre: 'abcd', n: 9, k: 'y' }, {}], extra: 1 }, s)).toEqual([
      '$.items: máximo 1 elementos',
      '$.items[0].nombre: máximo 3 caracteres',
      '$.items[0].n: máximo 5',
      '$.items[0].k: tiene que ser "x"',
      '$.items[1].nombre: falta',
      '$.extra: campo no permitido',
    ]);
    expect(validateJsonSchema({ items: [{ nombre: 'ab', n: null }] }, s)).toEqual([]);
    expect(validateJsonSchema(1.5, { type: 'integer' })).toEqual(['$: se esperaba integer y hay number']);
    expect(validateJsonSchema(2, { type: 'number', minimum: 3 })).toEqual(['$: mínimo 3']);
    expect(validateJsonSchema('z', { enum: ['a', 'b'] })).toEqual(['$: tiene que ser uno de "a", "b"']);
    const r = applyTransformRules({ mode: 'rules', format: 'json', schema: SCHEMA }, input('{"titulo":"x"}'));
    expect(r).toMatchObject({ ok: false, errors: ['$.tareas: falta'] });
  });

  it('[R37.10] en reglas emite node.started y transform.done, pasa los archivos y no llama a la IA', async () => {
    const { orch, decider } = setup({ scripts: { a: { output: 'Listo: {"titulo":"Hola"}', files: ['out/plan.md'] } } });
    const res = await orch.start(withTransform({ mode: 'rules', format: 'markdown', template: '# {{json.titulo}}\n{{json.nada}}' }), 'x').result;
    expect(res.status).toBe('succeeded');
    expect(res.output).toEqual({ text: '# Hola\n', files: ['out/plan.md'] });
    expect(decider.transformCalls).toHaveLength(0);
    const started = ofType(res.events, 'node.started').find((e) => e.nodeId === 't');
    expect(started?.input?.text).toContain('Listo: {"titulo":"Hola"}');
    const done = ofType(res.events, 'transform.done');
    expect(done).toEqual([expect.objectContaining({ nodeId: 't', mode: 'rules', format: 'markdown', attempts: 1, ok: true, warnings: ['{{json.nada}}: el campo no existe'] })]);
    const seqDone = done[0]!.seq;
    const finished = ofType(res.events, 'node.finished').find((e) => e.nodeId === 't')!;
    expect(seqDone).toBeLessThan(finished.seq);
  });

  it('[R37.10] en reglas, si no puede transformar, falla y no sigue', async () => {
    const res = await setup().orch.start(withTransform({ mode: 'rules', format: 'json' }), 'solo prosa').result;
    expect(res.status).toBe('failed');
    expect(ofType(res.events, 'transform.done')[0]).toMatchObject({ ok: false, errors: ['La entrada no contiene JSON'] });
    expect(ofType(res.events, 'node.finished').find((e) => e.nodeId === 'output')?.status).toBe('skipped');
  });

  it('[R37.10] funciona dentro de un bucle y la cancelación lo detiene', async () => {
    const body = diagram([ENTRY, tf('t', { mode: 'rules', format: 'text', template: '{{entrada}}!' }), OUTPUT], [edge('entry', 't'), edge('t', 'output')], 'cuerpo');
    const d = diagram([ENTRY, loop('l', { mode: 'count', count: 2, maxIterations: 3, body }), OUTPUT], [edge('entry', 'l'), edge('l', 'output')]);
    const res = await setup().orch.start(d, 'hola').result;
    expect(res.status).toBe('succeeded');
    expect(res.output?.text).toBe('hola!!');
    expect(ofType(res.events, 'transform.done').every((e) => e.nodePath?.[0] === 'l')).toBe(true);

    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = setup({ decider: { transform: () => '{"a":1}' } });
    const orig = slow.decider.transform;
    slow.decider.transform = async (r) => {
      await gate;
      return orig(r);
    };
    const h = slow.orch.start(withTransform({ mode: 'ai', format: 'json', instructions: 'x' }), 'x');
    await new Promise((r) => setTimeout(r, 5));
    h.cancel('basta');
    release();
    expect((await h.result).status).toBe('cancelled');
  });
});

describe('SPEC-037 · Transformar dentro de una revisión con retorno', () => {
  it('[R37.10] si la revisión rechaza, el tramo se repite y la transformación vuelve a ejecutarse con la entrega nueva', async () => {
    let qaCalls = 0;
    const { orch } = setup({
      scripts: {
        dis: { output: () => `{"version": ${qaCalls + 1}}` },
        qa: { output: () => (++qaCalls === 1 ? 'Mal.\nVEREDICTO: RECHAZADO' : 'VEREDICTO: APROBADO') },
      },
    });
    const d = diagram(
      [ENTRY, agent('dis'), tf('t', { mode: 'rules', format: 'text', template: 'v{{json.version}}' }), agent('qa'), { id: 'rev', kind: 'review', label: 'rev', review: { maxRounds: 3, mode: 'verdict' } }, OUTPUT],
      [
        edge('entry', 'dis'),
        edge('dis', 't'),
        edge('t', 'qa'),
        edge('qa', 'rev'),
        { id: 'ok', from: 'rev', to: 'output', port: 'approved' },
        { id: 'back', from: 'rev', to: 'dis', port: 'rejected' },
        { id: 'x', from: 'rev', to: 'output', port: 'exhausted' },
      ],
    );
    const r = await orch.start(d, 'x').result;
    expect(r.status).toBe('succeeded');
    const done = ofType(r.events, 'transform.done');
    expect(done).toHaveLength(2);
    const outs = ofType(r.events, 'node.finished').filter((e) => e.nodeId === 't').map((e) => e.output?.text);
    expect(outs).toEqual(['v1', 'v2']);
  });
});
