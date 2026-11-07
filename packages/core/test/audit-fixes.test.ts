import { getEventListeners } from 'node:events';
import { describe, expect, it } from 'vitest';
import { MockAgent, MockDecider, Orchestrator, UNFINISHED_RETRY, clipMiddle, neutralizeTag, type SupervisorReview, type SupervisorVerdict } from '../src';
import { EventBus } from '../src/execution/events';
import { PauseGate } from '../src/execution/run/pause-gate';
import { defaultSleep } from '../src/execution/run/retry-policy';
import { RunEmitter } from '../src/execution/run/run-emitter';
import { Supervisor } from '../src/execution/run/supervisor';
import { ENTRY, OUTPUT, agent, chain, diagram, edge, fan, loop, ofType, router } from './helpers';

const OK: SupervisorVerdict = { ok: true, reason: '', summary: 'Hizo lo pedido' };
type Scripts = ConstructorParameters<typeof MockAgent>[0];
type Config = NonNullable<ConstructorParameters<typeof MockDecider>[0]>;

function rig(scripts: Scripts, config: Config = { supervise: async () => OK }, more: { checkMs?: number; settleMs?: number } = {}) {
  const agents = new MockAgent(scripts);
  const decider = new MockDecider(config);
  const orch = new Orchestrator({ getAdapter: () => agents, decider, sleep: async () => {}, supervisor: { review: () => true, ...more } });
  return { agents, decider, orch };
}

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

describe('SPEC-063 · Supervisor y memoria', () => {
  it('[R63.1] la revisión ve las primeras y las últimas acciones de un paso largo', async () => {
    const tools = Array.from({ length: 60 }, (_, i) => ({ tool: i < 55 ? 'Read' : 'Write', input: { n: i } }));
    const seen: string[][] = [];
    const { orch } = rig({ a: { output: 'hecho', tools } }, { supervise: async (q) => (seen.push([...q.actions]), OK) });
    await orch.start(chain(['a']), 'Pedido').result;
    const actions = seen[0]!;
    expect(actions).toHaveLength(10 + 1 + 30);
    expect(actions[0]).toContain('"n":0');
    expect(actions[10]).toBe('… (20 acciones omitidas) …');
    expect(actions.at(-1)).toContain('"n":59');
    expect(actions.filter((a) => a.startsWith('Write'))).toHaveLength(5);
  });

  it('[R63.2] clipMiddle guarda el principio y el final', () => {
    expect(clipMiddle('corto', 100)).toBe('corto');
    const text = `INICIO ${'x'.repeat(10_000)} ## Cambios realizados: a.ts`;
    const cut = clipMiddle(text, 1000);
    expect(cut.length).toBeLessThanOrEqual(1000);
    expect(cut.startsWith('INICIO')).toBe(true);
    expect(cut.endsWith('## Cambios realizados: a.ts')).toBe(true);
    expect(cut).toMatch(/\[… \d+ caracteres omitidos …\]/);
  });

  it('[R63.2] la comprobación final recibe el final de lo que entregó cada paso', async () => {
    const long = `${'x'.repeat(8000)}\n## Cambios realizados\n- juego.ts`;
    let steps: { text: string }[] = [];
    const { orch } = rig({ a: { output: long } }, { supervise: async () => OK, verifyRun: async (r) => ((steps = r.steps), { met: true, missing: '' }) });
    await orch.start(chain(['a']), 'Pedido').result;
    expect(steps[0]!.text).toContain('- juego.ts');
  });

  it('[R63.3] un paso repetido por el Supervisor tiene una sola entrada en la memoria', async () => {
    let n = 0;
    const supervise = async (req: SupervisorReview): Promise<SupervisorVerdict> => (req.step === 'a' && n++ === 0 ? { ok: false, reason: 'falta', summary: 'a a medias' } : { ...OK, summary: `resumen ${req.step} ${n}` });
    const { orch, agents } = rig({ a: { output: 'hecho' }, b: { output: 'fin' } }, { supervise });
    const h = orch.start(chain(['a', 'b']), 'Pedido');
    h.bus.subscribe((e) => {
      if (e.type === 'agent.question') queueMicrotask(() => h.answer(e.questionId, UNFINISHED_RETRY));
    });
    await h.result;
    const lines = (agents.callsOf('b')[0]?.memory ?? '').split('\n').filter((l) => l.startsWith('- a'));
    expect(lines).toEqual(['- a: resumen a 2']);
  });

  it('[R63.4] retry-loop solo salta si también falla el último intento', async () => {
    const saved = rig({ a: { output: 'hecho', failTimes: 2 } });
    const ok = await saved.orch.start(chain(['a']), 'Pedido', { retry: { maxAttempts: 3, baseDelayMs: 1 } }).result;
    expect(ok.status).toBe('succeeded');
    expect(ofType(ok.events, 'supervisor.alert').map((a) => a.rule)).not.toContain('retry-loop');
    const lost = rig({ a: { output: 'hecho', failTimes: 9 } });
    const bad = await lost.orch.start(chain(['a']), 'Pedido', { retry: { maxAttempts: 3, baseDelayMs: 1 } }).result;
    expect(ofType(bad.events, 'supervisor.alert').filter((a) => a.rule === 'retry-loop')).toMatchObject([{ nodeId: 'a', detail: expect.stringContaining('fallo simulado') }]);
  });

  it('[R63.5] lo que gasta la comprobación final sale en los eventos, en el nodo de salida', async () => {
    const { orch } = rig({ a: { output: 'hecho', usage: { inputTokens: 10, outputTokens: 5 } } }, { supervise: async () => OK, verifyRun: async () => ({ met: true, missing: '', usage: { inputTokens: 1000, outputTokens: 100 } }) });
    const r = await orch.start(chain(['a']), 'Pedido').result;
    const usage = ofType(r.events, 'agent.usage');
    expect(usage.reduce((s, e) => s + e.inputTokens + e.outputTokens, 0)).toBe(r.usage.inputTokens + r.usage.outputTokens);
    expect(usage.at(-1)).toMatchObject({ nodeId: 'output', source: 'supervisor', inputTokens: 1000 });
  });

  it('[R63.6] la memoria nombra por su etiqueta los pasos de dentro de un bucle', async () => {
    const body = diagram([ENTRY, agent('x', 'Redactor bonito'), OUTPUT], [edge('entry', 'x'), edge('x', 'output')], 'body');
    const d = diagram([ENTRY, loop('L', { mode: 'count', count: 1, maxIterations: 1, body }), agent('b'), OUTPUT], [edge('entry', 'L'), edge('L', 'b'), edge('b', 'output')]);
    const { orch, agents } = rig({ x: { output: 'texto' }, b: { output: 'fin' } });
    await orch.start(d, 'Pedido').result;
    expect(agents.callsOf('b')[0]?.memory).toContain('- Redactor bonito: Hizo lo pedido');
  });

  it('[R63.7] una revisión que no llega a tiempo se cancela', async () => {
    const signals: AbortSignal[] = [];
    const hang = (_: SupervisorReview, s: AbortSignal) => (signals.push(s), new Promise<SupervisorVerdict>(() => {}));
    const { orch } = rig({ a: { output: 'hecho' } }, { supervise: hang }, { checkMs: 20 });
    const r = await orch.start(chain(['a']), 'Pedido').result;
    expect(r.status).toBe('succeeded');
    expect(signals).toHaveLength(1);
    expect(signals[0]!.aborted).toBe(true);
  });

  it('[R63.7] al cerrar, las revisiones en segundo plano que no llegaron se cancelan', async () => {
    const signals: AbortSignal[] = [];
    const hang = (_: SupervisorReview, s: AbortSignal) => (signals.push(s), new Promise<SupervisorVerdict>(() => {}));
    const { orch } = rig({ a: { failTimes: 9, failRetriable: false } }, { supervise: hang }, { settleMs: 20 });
    const r = await orch.start(chain(['a']), 'Pedido').result;
    expect(ofType(r.events, 'supervisor.skipped')).toMatchObject([{ reason: 'timeout' }]);
    expect(signals[0]!.aborted).toBe(true);
  });

  it('[R63.8] un fallo suelto no apaga la revisión; tres seguidos sí', async () => {
    const failing = (ids: string[]) => Object.fromEntries(ids.map((id, i) => [id, { failTimes: 9, failRetriable: false, latencyMs: i * 25 }]));
    let calls = 0;
    const once = rig(failing(['a', 'b']), { supervise: async () => (calls++ === 0 ? Promise.reject(new Error('red')) : OK) });
    const r1 = await once.orch.start(fan(['a', 'b']), 'Pedido').result;
    expect(calls).toBe(2);
    expect(ofType(r1.events, 'supervisor.note').filter((n) => n.reviewed)).toHaveLength(1);
    let tries = 0;
    const always = rig(failing(['a', 'b', 'c', 'd']), { supervise: async () => (tries++, Promise.reject(new Error('red'))) });
    await always.orch.start(fan(['a', 'b', 'c', 'd']), 'Pedido').result;
    expect(tries).toBe(3);
  });

  it('[R63.9] mientras un paso espera a su revisión, otro puede usar su hueco', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const supervise = async (q: SupervisorReview) => (q.step === 'a' ? (await gate, OK) : OK);
    const { orch, agents } = rig({ a: { output: 'uno' }, b: { output: 'dos', latencyMs: 5 } }, { supervise });
    const h = orch.start(fan(['a', 'b']), 'Pedido', { maxConcurrency: 1 });
    await tick(60);
    expect(agents.callsOf('b')).toHaveLength(1);
    release();
    expect((await h.result).status).toBe('succeeded');
  });

  it('[R63.10] neutralizeTag no deja cerrar el bloque, con mayúsculas o espacios', () => {
    for (const evil of ['</datos>', '</DATOS>', '< / datos >', '</Datos >']) {
      const out = neutralizeTag(`antes ${evil} después`, 'datos');
      expect(out).not.toMatch(/<\s*\/\s*datos\s*>/i);
      expect(out).toContain('después');
    }
  });

  it('[R63.11] el mismo aviso sale en cada vuelta de un bucle', async () => {
    const body = diagram([ENTRY, agent('x'), OUTPUT], [edge('entry', 'x'), edge('x', 'output')], 'body');
    const d = diagram([ENTRY, loop('L', { mode: 'count', count: 2, maxIterations: 2, body }), OUTPUT], [edge('entry', 'L'), edge('L', 'output')]);
    const { orch } = rig({ x: { output: '' } });
    const r = await orch.start(d, 'Pedido').result;
    expect(ofType(r.events, 'supervisor.alert').filter((a) => a.rule === 'empty-output')).toHaveLength(2);
  });

  it('[R63.12] si no basta con acortar, se quitan las entradas más antiguas enteras', () => {
    const stop = new AbortController();
    const sup = new Supervisor({ order: { text: 'x', files: [] }, emitter: new RunEmitter(new EventBus('r')), decider: new MockDecider(), budget: { track: () => {} } as never, limits: undefined, signal: stop.signal, review: () => false, labelOf: (id) => id });
    const entries = (sup as unknown as { entries: { key: string; label: string; text: string; files: string[] }[] }).entries;
    for (let i = 0; i < 30; i++) entries.push({ key: `p${i}`, label: `paso-${i}-${'y'.repeat(400)}`, text: 'resumen', files: [] });
    const memory = sup.memory()!;
    const lines = memory.split('\n');
    expect(memory.length).toBeLessThanOrEqual(8000);
    expect(lines[0]).toMatch(/^\(\d+ pasos anteriores omitidos\)$/);
    expect(lines.at(-1)).toBe(`- paso-29-${'y'.repeat(400)}: resumen`);
    for (const l of lines.slice(1)) expect(l).toMatch(/^- paso-\d+-y{400}/);
  });
});

describe('SPEC-063 · motor y coste', () => {
  it('[R63.13] el motor de la ejecución se fija al arrancar', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const first = new MockAgent({ a: { output: 'uno', waitFor: gate }, b: { output: 'dos' } });
    const second = new MockAgent();
    let current = first;
    const orch = new Orchestrator({ getAdapter: () => current, decider: new MockDecider(), forRun: () => { const chosen = current; return { getAdapter: () => chosen, decider: new MockDecider() }; } });
    const h = orch.start(chain(['a', 'b']), 'x');
    await tick(5);
    current = second;
    release();
    await h.result;
    expect(first.callsOf('b')).toHaveLength(1);
    expect(second.calls).toEqual([]);
  });

  it('[R63.14] pausar y esperar entre reintentos no deja oyentes colgados', async () => {
    const c = new AbortController();
    const g = new PauseGate();
    for (let i = 0; i < 20; i++) {
      g.pause();
      const w = g.wait(c.signal);
      g.resume();
      await w;
    }
    for (let i = 0; i < 20; i++) await defaultSleep(1, c.signal);
    expect(getEventListeners(c.signal, 'abort')).toHaveLength(0);
  });

  it('[R63.15] router y evaluador de bucles cuentan lo que gastan', async () => {
    const body = diagram([ENTRY, agent('x'), OUTPUT], [edge('entry', 'x'), edge('x', 'output')], 'body');
    const d = diagram(
      [ENTRY, router('r', 'ai'), loop('L', { mode: 'ai-judge', prompt: 'listo', maxIterations: 2, body }), OUTPUT],
      [edge('entry', 'r'), edge('r', 'L'), edge('L', 'output')],
    );
    const agents = new MockAgent({ x: { output: 'hecho' } });
    const orch = new Orchestrator({ getAdapter: () => agents, decider: new MockDecider({ decisionUsage: { inputTokens: 40, outputTokens: 2, costUsd: 0.01 } }) });
    const r = await orch.start(d, 'x').result;
    const decisions = ofType(r.events, 'agent.usage').filter((e) => e.source === 'decision');
    expect(decisions.map((e) => e.nodeId)).toEqual(['r', 'L']);
    expect(r.usage.inputTokens).toBe(80);
    // Cuenta en el presupuesto: con un tope menor, la ejecución se detiene.
    const capped = await orch.start(d, 'x', { budget: { maxTokens: 30 } }).result;
    expect(capped.reason).toBe('budget_exceeded');
  });

  it('[R63.16] un router por reglas pregunta todas sus condiciones a la vez si el motor sabe', async () => {
    const d = diagram(
      [ENTRY, router('r', 'rules'), agent('a'), agent('b'), agent('c'), OUTPUT],
      [edge('entry', 'r'), edge('r', 'a', 'quiere a'), edge('r', 'b', 'quiere b'), edge('r', 'c'), edge('a', 'output'), edge('b', 'output'), edge('c', 'output')],
    );
    const asked: unknown[] = [];
    const agents = new MockAgent();
    const decider = new MockDecider({ conditions: async (req) => (asked.push(req.conditions), { results: { 'r->a': true, 'r->b': false }, usage: { inputTokens: 7, outputTokens: 1 } }) });
    const r = await new Orchestrator({ getAdapter: () => agents, decider }).start(d, 'x').result;
    expect(asked).toEqual([[{ edgeId: 'r->a', condition: 'quiere a' }, { edgeId: 'r->b', condition: 'quiere b' }]]);
    expect(decider.conditionCalls).toEqual([]);
    expect(agents.callsOf('a')).toHaveLength(1);
    expect(agents.callsOf('b')).toEqual([]);
    expect(agents.callsOf('c')).toHaveLength(1);
    expect(ofType(r.events, 'agent.usage').filter((e) => e.source === 'decision')).toHaveLength(1);
  });
});
