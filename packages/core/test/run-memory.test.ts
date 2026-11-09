import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MEMORY_BLOCKS,
  MockAgent,
  MockDecider,
  NOTE_HEADING,
  NOTE_MAX,
  Orchestrator,
  estimateTokens,
  memoryFiles,
  memoryFromEvents,
  renderMemory,
  selectFor,
  splitNote,
  type RunEvent,
  type RunMemory,
  type SupervisorVerdict,
} from '../src';
import { pathKey } from '../src/execution/replay';
import { ENTRY, OUTPUT, agent, chain, diagram, edge, loop, ofType } from './helpers';

const OK: SupervisorVerdict = { ok: true, reason: '', summary: 'Hecho' };
type Scripts = ConstructorParameters<typeof MockAgent>[0];

let seq = 0;
const ev = (b: Record<string, unknown>) => ({ runId: 'r', seq: ++seq, ts: '2026-11-08T10:00:00.000Z', ...b }) as unknown as RunEvent;
const labelOf = (id: string) => id;
const empty = (): RunMemory => ({ decisions: [], agreements: [], notes: [], alerts: [], route: [], steps: [], files: [], starts: [] });
const at = (nodeId: string, s = 1) => ({ source: 'events' as const, nodeId, path: [], pass: 1, seq: s });

/** Memoria encendida sin Supervisor (como la app) [R72.3]. */
function rig(scripts: Scripts, tokens?: number) {
  const agents = new MockAgent(scripts);
  const orch = new Orchestrator({ getAdapter: () => agents, decider: new MockDecider(), memory: { tokens: () => tokens } });
  return { agents, orch };
}

/** Un paso que trabajó: arrancó, pidió algo a su agente y terminó. */
const worked = (id: string, text: string, more: Record<string, unknown> = {}) => [
  ev({ type: 'node.started', nodeId: id, input: { text: '', files: [] }, ...more }),
  ev({ type: 'agent.request', nodeId: id, agentId: id, attempt: 1, input: { text: '', files: [] }, ...more }),
  ev({ type: 'node.finished', nodeId: id, status: 'succeeded', output: { text, files: [] }, ...more }),
];

describe('SPEC-072 · la memoria sale de los eventos', () => {
  it('[R72.1] da los ocho bloques, cada entrada con su procedencia, sin motor ni archivos', () => {
    const events = [
      ev({ type: 'git.branch', nodeId: 'a', branch: 'feature/x', via: 'command', created: true }),
      ...worked('a', 'Primer párrafo.\n\nOtro.'),
      ev({ type: 'agent.question', nodeId: 'a', questionId: 'q', text: '¿Base de datos?' }),
      ev({ type: 'agent.answer', nodeId: 'a', questionId: 'q', text: 'PostgreSQL' }),
      ev({ type: 'memory.note', nodeId: 'a', text: 'Dejé los tests a medias' }),
      ev({ type: 'supervisor.alert', nodeId: 'a', rule: 'empty-output', severity: 'warning', detail: 'Ojo' }),
      ev({ type: 'route.decided', fromNodeId: 'r', chosen: ['b'], reason: 'es web' }),
      ev({ type: 'file.produced', nodeId: 'a', path: 'src/x.ts', change: 'created' }),
    ];
    const m = memoryFromEvents(events);
    expect(m.branch).toEqual({ name: 'feature/x', createdBy: { nodeId: 'a', path: [] } });
    expect(m.decisions).toMatchObject([{ nodeId: 'a', question: '¿Base de datos?', answer: 'PostgreSQL', kind: 'question', source: 'events' }]);
    expect(m.notes).toMatchObject([{ nodeId: 'a', text: 'Dejé los tests a medias', source: 'agent' }]);
    expect(m.alerts).toMatchObject([{ nodeId: 'a', rule: 'empty-output' }]);
    expect(m.route).toMatchObject([{ nodeId: 'r', text: 'eligió b: es web' }]);
    expect(m.steps).toMatchObject([{ nodeId: 'a', passes: [{ pass: 1, summary: 'Primer párrafo.', reviewed: false }] }]);
    expect(m.files).toMatchObject([{ nodeId: 'a', path_: 'src/x.ts', change: 'created' }]);
    // Pura: mismo resultado dos veces y sin tocar los eventos.
    const copy = JSON.stringify(events);
    expect(memoryFromEvents(events)).toEqual(m);
    expect(JSON.stringify(events)).toBe(copy);
  });

  it('[R72.2] sobre las grabaciones de SPEC-056 es determinista y cada prefijo solo añade', () => {
    const dir = join(__dirname, '../../runtime/test/fixtures/golden');
    for (const name of readdirSync(dir)) {
      const golden = JSON.parse(readFileSync(join(dir, name), 'utf8')) as { runs: unknown[] };
      // `paralelo` se graba por nodo (el orden entre ramas no es fijo): ahí no hay orden global que comprobar.
      for (const run of golden.runs.filter((r): r is Record<string, unknown>[] => Array.isArray(r))) {
        const events = run.map((e, i) => ({ ...e, seq: i + 1, ts: '2026-11-08T10:00:00.000Z' }) as unknown as RunEvent);
        const full = memoryFromEvents(events);
        expect(memoryFromEvents(JSON.parse(JSON.stringify(events)) as RunEvent[]), name).toEqual(full);
        for (let k = 1; k <= events.length; k++) {
          const part = memoryFromEvents(events.slice(0, k));
          for (const s of part.steps) expect(full.steps.some((f) => f.nodeId === s.nodeId && f.passes.length >= s.passes.length), name).toBe(true);
          expect(part.decisions.length).toBeLessThanOrEqual(full.decisions.length);
        }
      }
    }
  });

  it('[R72.2][R72.9] en vivo, lo que recibe un paso es la función sobre los eventos hasta su arranque', async () => {
    const { agents, orch } = rig({ a: { output: 'uno' }, b: { output: 'dos' }, c: { output: 'tres' } });
    const { events } = await orch.start(chain(['a', 'b', 'c']), 'Pedido').result;
    for (const id of ['b', 'c']) {
      const start = ofType(events, 'node.started').find((e) => e.nodeId === id)!;
      const prefix = events.filter((e) => e.seq <= start.seq);
      const view = selectFor(memoryFromEvents(prefix), { nodeId: id, path: [], startSeq: start.seq, pass: 1 }, new Map([['', chain(['a', 'b', 'c'])]]));
      expect(agents.callsOf(id)[0]!.memory).toBe(renderMemory(view, { labelOf }).text);
    }
  });

  it('[R72.3] sin Supervisor ni memoria, los agentes no reciben memoria (como antes)', async () => {
    const agents = new MockAgent({ a: { output: 'uno' }, b: { output: 'dos' } });
    const { events } = await new Orchestrator({ getAdapter: () => agents, decider: new MockDecider() }).start(chain(['a', 'b']), 'Pedido').result;
    expect(agents.callsOf('b')[0]!.memory).toBeUndefined();
    expect(ofType(events, 'memory.note')).toEqual([]);
    expect(ofType(events, 'agent.request').every((e) => e.memory === undefined && e.memoryStats === undefined)).toBe(true);
  });

  it('[R72.4] entran preguntas, puertas, cambios pedidos, revisiones y correcciones; los permisos no', () => {
    const q = (id: string, more: Record<string, unknown>) => ev({ type: 'agent.question', nodeId: 'a', questionId: id, text: `P ${id}`, ...more });
    const a = (id: string, text: string) => ev({ type: 'agent.answer', nodeId: 'a', questionId: id, text });
    const m = memoryFromEvents([
      q('1', {}), a('1', 'sí'),
      q('2', { kind: 'permission' }), a('2', 'permitir'),
      q('3', { kind: 'gate' }), a('3', 'adelante'),
      q('4', { kind: 'unfinished' }), a('4', 'sigue'),
      q('5', { confirm: true }), a('5', 'Aprobar'),
      q('6', { confirm: true }), a('6', 'Cambia el título'),
      q('7', { review: true }), a('7', 'Falta el test'),
      ev({ type: 'correction.applied', nodeId: 'a', text: 'Usa TypeScript' }),
    ]);
    expect(m.decisions.map((d) => [d.kind, d.answer])).toEqual([
      ['question', 'sí'], ['gate', 'adelante'], ['unfinished', 'sigue'], ['confirm', 'Cambia el título'], ['review', 'Falta el test'], ['correction', 'Usa TypeScript'],
    ]);
  });

  it('[R72.5] los acuerdos salen del reparto válido del Coordinador', () => {
    const text = '## Común\nAPI REST en /api\n\n## Para w\nArchivos: src/web/\nla web\n\n## Para s\nArchivos: src/api/\nel servidor';
    const m = memoryFromEvents([
      ev({ type: 'node.started', nodeId: 'c', input: { text: '', files: [] } }),
      ev({ type: 'agent.request', nodeId: 'c', agentId: 'c', attempt: 1, input: { text: '', files: [] }, split: true }),
      ev({ type: 'edge.traversed', edgeId: 'c->w', fromNodeId: 'c', toNodeId: 'w', input: { text: '', files: [] } }),
      ev({ type: 'edge.traversed', edgeId: 'c->s', fromNodeId: 'c', toNodeId: 's', input: { text: '', files: [] } }),
      ev({ type: 'node.finished', nodeId: 'c', status: 'succeeded', output: { text, files: [] } }),
    ]);
    expect(m.agreements).toHaveLength(1);
    expect(m.agreements[0]!.common).toContain('API REST');
    expect(m.agreements[0]!.branches).toEqual(expect.arrayContaining([{ to: 'w', files: ['src/web/'] }, { to: 's', files: ['src/api/'] }]));
    // Sin reparto pedido no hay acuerdo.
    expect(memoryFromEvents(worked('c', text)).agreements).toEqual([]);
  });

  it('[R72.6] el camino guarda routers, vueltas de bucle y revisiones rechazadas', () => {
    const m = memoryFromEvents([
      ev({ type: 'route.decided', fromNodeId: 'r', chosen: ['a', 'b'], reason: 'las dos' }),
      ev({ type: 'loop.iteration', loopId: 'L', n: 2, max: 5, verdict: 'continue', reason: 'faltan tests' }),
      ev({ type: 'review.decided', nodeId: 'rv', verdict: 'rejected', round: 1, reason: 'mal nombre' }),
      ev({ type: 'review.decided', nodeId: 'rv', verdict: 'approved', round: 2 }),
    ]);
    expect(m.route.map((r) => [r.nodeId, r.text])).toEqual([
      ['r', 'eligió a, b: las dos'],
      ['L', 'vuelta 2 de 5: continuar — faltan tests'],
      ['rv', 'rechazó (vuelta 1) — mal nombre'],
    ]);
  });
});

describe('SPEC-072 · qué ve cada paso', () => {
  const steps = (memory: string | undefined) => (memory ?? '').split('Resumen de los pasos:\n')[1]?.split('\n\n')[0] ?? '';

  it('[R72.7] un paso ve a sus antecesores y no a los que no llevan a él', async () => {
    const d = diagram([ENTRY, agent('a'), agent('x'), agent('b'), OUTPUT], [edge('entry', 'a'), edge('entry', 'x'), edge('a', 'b'), edge('b', 'output'), edge('x', 'output')]);
    const { agents, orch } = rig({ a: { output: 'A' }, x: { output: 'X', latencyMs: 1 }, b: { output: 'B', latencyMs: 30 } });
    await orch.start(d, 'Pedido').result;
    expect(steps(agents.callsOf('b')[0]!.memory)).toBe('- a: A (sin revisar)');
  });

  it('[R72.7] dentro de un bucle, el cuerpo ve lo que hubo antes del bucle', async () => {
    const d = diagram([ENTRY, agent('p'), loop('L', { mode: 'count', count: 1, maxIterations: 1, body: chain(['a'], 'body') }), OUTPUT], [edge('entry', 'p'), edge('p', 'L'), edge('L', 'output')]);
    const { agents, orch } = rig({ p: { output: 'Plan' }, a: { output: 'Hecho' } });
    await orch.start(d, 'Pedido').result;
    expect(steps(agents.callsOf('a')[0]!.memory)).toBe('- p: Plan (sin revisar)');
  });

  it('[R72.8] la vuelta 2 de un bucle ve la vuelta 1 del mismo paso, y la Decisión es de toda la ejecución', async () => {
    const d = diagram([ENTRY, loop('L', { mode: 'count', count: 2, maxIterations: 2, body: chain(['a'], 'body') }), OUTPUT], [edge('entry', 'L'), edge('L', 'output')]);
    let n = 0;
    const { agents, orch } = rig({ a: { output: () => `vuelta ${++n}` } });
    await orch.start(d, 'Pedido').result;
    expect(agents.callsOf('a')[0]!.memory ?? '').not.toContain('vuelta 1');
    expect(steps(agents.callsOf('a')[1]!.memory)).toBe('- a: vuelta 1 (sin revisar)');
  });

  it('[R72.8] dos ramas en paralelo no se ven aunque una termine antes; las decisiones sí', () => {
    const d = diagram([ENTRY, agent('a'), agent('b'), OUTPUT], [edge('entry', 'a'), edge('entry', 'b'), edge('a', 'output'), edge('b', 'output')]);
    const events = [
      ...worked('a', 'A'),
      ev({ type: 'agent.question', nodeId: 'a', questionId: 'q', text: '¿Idioma?' }),
      ev({ type: 'agent.answer', nodeId: 'a', questionId: 'q', text: 'Español' }),
      ev({ type: 'node.started', nodeId: 'b', input: { text: '', files: [] } }),
    ];
    const start = events.at(-1)!.seq;
    const view = selectFor(memoryFromEvents(events), { nodeId: 'b', path: [], startSeq: start, pass: 1 }, new Map([['', d]]));
    expect(view.steps).toEqual([]);
    expect(view.decisions).toMatchObject([{ answer: 'Español' }]);
  });

  it('[R72.9] la memoria no cambia entre intentos del mismo paso', async () => {
    const { agents, orch } = rig({ a: { output: 'uno' }, b: { output: 'dos', failTimes: 1 } });
    await orch.start(chain(['a', 'b']), 'Pedido').result;
    const calls = agents.callsOf('b');
    expect(calls).toHaveLength(2);
    expect(calls[1]!.memory).toBe(calls[0]!.memory);
  });

  it('[R72.10] sin revisión, el primer párrafo recortado a 300 y «sin revisar»; con revisión, el resumen y lo que decidió', async () => {
    const long = 'x'.repeat(400);
    const { agents, orch } = rig({ a: { output: `${long}\n\nmás` }, b: { output: 'dos' } });
    await orch.start(chain(['a', 'b']), 'Pedido').result;
    const line = steps(agents.callsOf('b')[0]!.memory);
    expect(line.endsWith('… (sin revisar)')).toBe(true);
    expect(line.length).toBeLessThan(330);

    const reviewed = new MockAgent({ a: { output: 'uno' }, b: { output: 'dos' } });
    const decider = new MockDecider({ supervise: () => Promise.resolve({ ...OK, summary: 'Montó la base', decided: ['eligió PostgreSQL'] }) });
    await new Orchestrator({ getAdapter: () => reviewed, decider, supervisor: { review: () => true } }).start(chain(['a', 'b']), 'Pedido').result;
    expect(steps(reviewed.callsOf('b')[0]!.memory)).toBe('- a: Montó la base; decidió: eligió PostgreSQL');
  });
});

describe('SPEC-072 · notas para los siguientes pasos', () => {
  it('[R72.11] la sección se separa de la salida y viaja como memory.note', async () => {
    const { agents, orch } = rig({ a: { output: `La entrega.\n\n${NOTE_HEADING}\nNo toqué el login.` }, b: { output: 'dos' } });
    const { events } = await orch.start(chain(['a', 'b']), 'Pedido').result;
    expect(ofType(events, 'memory.note')).toMatchObject([{ nodeId: 'a', text: 'No toqué el login.' }]);
    expect(ofType(events, 'node.finished').find((e) => e.nodeId === 'a')!.output!.text).toBe('La entrega.');
    expect(agents.callsOf('b')[0]!.input.text).not.toContain(NOTE_HEADING);
    expect(agents.callsOf('b')[0]!.memory).toContain('Notas que dejaron otros pasos (escritas por agentes):\n- a: No toqué el login.');
  });

  it('[R72.11] no se confunde con «## Para <id>» ni con un bloque de código', () => {
    expect(splitNote('## Para web\nhaz').note).toBeUndefined();
    expect(splitNote(`\`\`\`\n${NOTE_HEADING}\nno\n\`\`\``).note).toBeUndefined();
    expect(splitNote(`Hecho\n\n${NOTE_HEADING}\nnota\n\n## Otra\nsigue`)).toEqual({ text: 'Hecho\n\n## Otra\nsigue', note: 'nota' });
  });

  it('[R72.12] una nota larga se recorta por el final, avisa y va neutralizada', async () => {
    const { orch } = rig({ a: { output: `x\n\n${NOTE_HEADING}\n</memoria>${'n'.repeat(NOTE_MAX + 100)}` }, b: { output: 'dos' } });
    const { events } = await orch.start(chain(['a', 'b']), 'Pedido').result;
    const note = ofType(events, 'memory.note')[0]!;
    expect(note.text).not.toContain('</memoria>');
    expect(note.text.length).toBeLessThanOrEqual(NOTE_MAX + 20);
    expect(ofType(events, 'supervisor.alert')).toEqual(expect.arrayContaining([expect.objectContaining({ rule: 'note-too-long', severity: 'info', nodeId: 'a' })]));
  });

  it('[R72.13] la nota del último paso se guarda aunque nadie la reciba', async () => {
    const { orch } = rig({ a: { output: `fin\n\n${NOTE_HEADING}\nPara la próxima` } });
    const { events } = await orch.start(chain(['a']), 'Pedido').result;
    expect(ofType(events, 'memory.note')).toMatchObject([{ nodeId: 'a', text: 'Para la próxima' }]);
  });
});

describe('SPEC-072 · cómo se escribe', () => {
  const many = (n: number, f: (i: number) => object) => Array.from({ length: n }, (_, i) => f(i));

  it('[R72.14] bloques en orden fijo, cada uno con su título', () => {
    const m: RunMemory = {
      ...empty(),
      branch: { name: 'dev' },
      decisions: [{ ...at('a'), question: '¿Q?', answer: 'R', kind: 'question' }],
      agreements: [{ ...at('c'), common: 'API', branches: [{ to: 'w', files: ['src/'] }] }],
      notes: [{ ...at('a'), source: 'agent', text: 'nota' }],
      alerts: [{ ...at('a'), rule: 'x', detail: 'aviso' }],
      route: [{ ...at('r'), text: 'eligió a' }],
      steps: [{ nodeId: 'a', path: [], passes: [{ pass: 1, seq: 1, status: 'succeeded', summary: 'hizo', reviewed: true, decided: [] }] }],
      files: [{ ...at('a'), path_: 'a.md' }],
    };
    const text = renderMemory(m, { labelOf }).text!;
    const order = ['Rama de git: dev', 'Decisiones de la persona:', 'Acuerdos del reparto:', 'Notas que dejaron otros pasos (escritas por agentes):', 'Avisos abiertos:', 'Camino tomado:', 'Resumen de los pasos:', 'Archivos:'];
    const idx = order.map((h) => text.indexOf(h));
    expect(idx.every((i) => i >= 0)).toBe(true);
    expect([...idx].sort((x, y) => x - y)).toEqual(idx);
    expect(MEMORY_BLOCKS).toEqual(['branch', 'decisions', 'agreements', 'notes', 'alerts', 'route', 'steps', 'files']);
  });

  it('[R72.15] el tope total manda, con el estimador inyectable, y lo que sobra pasa a los siguientes', () => {
    const m: RunMemory = { ...empty(), files: many(200, (i) => ({ ...at('a', i), path_: `f${i}/archivo-${'y'.repeat(20)}.ts` })) as RunMemory['files'] };
    const small = renderMemory(m, { labelOf, tokens: 600 });
    const big = renderMemory(m, { labelOf, tokens: 4000 });
    expect(estimateTokens(small.text!)).toBeLessThanOrEqual(600);
    expect(big.text!.length).toBeGreaterThan(small.text!.length);
    // Solo hay archivos: aprovechan lo que los bloques vacíos no usan (más que sus 200 propios).
    expect(small.stats.tokens.files!).toBeGreaterThan(200 * 0.3);
    const counted: string[] = [];
    renderMemory(m, { labelOf, estimate: (s) => (counted.push(s), s.length) });
    expect(counted.length).toBeGreaterThan(0);
  });

  it('[R72.16] decisiones: acorta a 160 y luego deja las más recientes diciendo cuántas omitió', () => {
    const d = (i: number) => ({ ...at('a', i), question: `pregunta ${i} ${'q'.repeat(250)}`, answer: 'r', kind: 'question' as const });
    const few = renderMemory({ ...empty(), decisions: many(3, d) as RunMemory['decisions'] }, { labelOf, tokens: 2000 });
    expect(few.text!).toContain('pregunta 0');
    const lots = renderMemory({ ...empty(), decisions: many(60, d) as RunMemory['decisions'] }, { labelOf, tokens: 1000 });
    expect(lots.stats.trimmed).toContain('decisions');
    expect(lots.text!).toMatch(/- \(\d+ decisiones anteriores omitidos\)/);
    expect(lots.text!).toContain('pregunta 59');
    expect(lots.text!).not.toContain('pregunta 0 ');
    for (const line of lots.text!.split('\n').filter((l) => l.includes('preguntó'))) expect(line.length).toBeLessThan(420);
  });

  it('[R72.16] archivos se agrupan por carpeta; la rama nunca se recorta; no se corta una línea', () => {
    const m: RunMemory = { ...empty(), branch: { name: `rama-${'b'.repeat(300)}` }, files: many(300, (i) => ({ ...at('a', i), path_: `src/mod${i % 3}/archivo-${i}.ts` })) as RunMemory['files'] };
    const r = renderMemory(m, { labelOf, tokens: 500 });
    expect(r.text!.split('\n')[0]).toBe(`Rama de git: rama-${'b'.repeat(300)}`);
    expect(r.text!).toContain('- src/mod0/ (100 archivos)');
    expect(r.stats.trimmed).toEqual(['files']);
    for (const line of r.text!.split('\n').slice(1)) expect(line === '' || line.startsWith('- ') || line.endsWith(':')).toBe(true);
  });

  it('[R72.16] camino y avisos quitan los más antiguos', () => {
    const r = renderMemory({ ...empty(), route: many(80, (i) => ({ ...at('r', i), text: `eligió ${i} ${'z'.repeat(40)}` })) as RunMemory['route'] }, { labelOf, tokens: 300 });
    expect(r.text!).toContain('eligió 79');
    expect(r.text!).not.toContain('eligió 0 ');
  });

  it('[R72.17] un paso con varias pasadas sale una vez: la última entera y las anteriores en una línea', () => {
    const passes = [1, 2, 3].map((p) => ({ pass: p, seq: p, status: (p === 2 ? 'failed' : 'succeeded') as 'failed' | 'succeeded', summary: `pasada ${p}`, reviewed: true, decided: [] }));
    const text = renderMemory({ ...empty(), steps: [{ nodeId: 'a', path: [], passes }] }, { labelOf }).text!;
    expect(text).toBe('Resumen de los pasos:\n- a: pasada 3\n  · pasada 1: terminó — pasada 1\n  · pasada 2: falló — pasada 2');
  });

  it('[R72.19] agent.request guarda la memoria y sus medidas por bloque', async () => {
    const { orch } = rig({ a: { output: 'uno', files: Array.from({ length: 300 }, (_, i) => `d/${i}-${'x'.repeat(30)}.ts`) }, b: { output: 'dos' } }, 500);
    const { events } = await orch.start(chain(['a', 'b']), 'Pedido').result;
    const req = ofType(events, 'agent.request').find((e) => e.nodeId === 'b')!;
    expect(req.memory).toBeDefined();
    expect(req.memoryStats!.tokens.steps).toBeGreaterThan(0);
    expect(req.memoryStats!.trimmed).toContain('files');
  });
});

describe('SPEC-072 · archivos y reanudar', () => {
  it('[R72.20] memory.json con versión y memory.md completa sin topes', () => {
    const events = [...worked('a', 'uno'), ...Array.from({ length: 300 }, (_, i) => ev({ type: 'file.produced', nodeId: 'a', path: `d/${i}.ts` }))];
    const out = memoryFiles(events, (id) => `Paso ${id}`);
    const json = JSON.parse(out.json) as { schemaVersion: number };
    expect(json.schemaVersion).toBe(1);
    expect(out.markdown).toContain('d/299.ts');
    expect(out.markdown).toContain('d/0.ts');
    expect(out.markdown).toContain('Paso a');
    expect(out.memory).toEqual(memoryFromEvents(events));
  });

  it('[R72.21] lo reutilizado de la ejecución anterior entra, y sus decisiones van marcadas', () => {
    const events = [
      ev({ type: 'node.started', nodeId: 'a', input: { text: '', files: [] } }),
      ev({ type: 'node.reused', nodeId: 'a' }),
      ev({ type: 'agent.question', nodeId: 'a', questionId: 'q', text: '¿Color?' }),
      ev({ type: 'agent.answer', nodeId: 'a', questionId: 'q', text: 'Azul' }),
      ev({ type: 'memory.note', nodeId: 'a', text: 'nota vieja' }),
      ev({ type: 'node.finished', nodeId: 'a', status: 'succeeded', output: { text: 'hecho antes', files: [] } }),
    ];
    const m = memoryFromEvents(events);
    expect(m.decisions).toMatchObject([{ answer: 'Azul', previousRun: true }]);
    expect(m.notes).toMatchObject([{ text: 'nota vieja' }]);
    expect(m.steps).toMatchObject([{ nodeId: 'a', passes: [{ summary: 'hecho antes' }] }]);
    expect(renderMemory(m, { labelOf }).text).toContain('(de la ejecución anterior)');
    expect(pathKey([], 'a')).toBe('a');
  });
});
