import { describe, expect, it, vi } from 'vitest';
import { MockAgent, MockDecider, Orchestrator, redoneSteps, resumePlan, reusedTrail, UNFINISHED_CONTINUE, UNFINISHED_OPTIONS, UNFINISHED_RETRY, UNFINISHED_STOP, type Diagram, type RunEvent, type SupervisorVerdict } from '../src';

const OK: SupervisorVerdict = { ok: true, reason: '', summary: 'Hizo lo pedido' };
const STOPPED: SupervisorVerdict = { ok: false, reason: 'Solo hizo 1 de 44 tareas', summary: 'Se detuvo' };

const chain = (ids: string[]): Diagram => {
  const all = ['entry', ...ids, 'output'];
  return {
    id: 'd',
    name: 'D',
    schemaVersion: 1,
    nodes: [{ id: 'entry', kind: 'entry' }, ...ids.map((id) => ({ id, kind: 'agent' as const, agentId: id })), { id: 'output', kind: 'output' }],
    edges: all.slice(1).map((to, i) => ({ id: `e${i}`, from: all[i]!, to })),
  };
};

type Deps = ConstructorParameters<typeof MockDecider>[0];

function rig(config: Deps, extra: { checkMs?: number; purpose?: string } = {}) {
  const agents = new MockAgent({ a: { output: 'uno' }, b: { output: 'dos' } });
  const decider = new MockDecider(config);
  const orch = new Orchestrator({
    getAdapter: () => agents,
    decider,
    supervisor: { review: () => true, ...(extra.checkMs !== undefined ? { checkMs: extra.checkMs } : {}) },
    ...(extra.purpose ? { agentProfile: async () => ({ name: 'x', skills: [], mcp: [], purpose: extra.purpose! }) } : {}),
  });
  return { agents, orch };
}

/** Arranca y responde a cada pregunta con lo que toque. */
async function run(orch: Orchestrator, answers: string[], order = 'Añade diagramas') {
  const handle = orch.start(chain(['a', 'b']), order);
  const pendingAnswers = [...answers];
  handle.bus.subscribe((e) => {
    if (e.type !== 'agent.question') return;
    const reply = pendingAnswers.shift();
    if (reply !== undefined) queueMicrotask(() => handle.answer(e.questionId, reply));
  });
  return handle.result;
}

const ofType = <T extends RunEvent['type']>(events: readonly RunEvent[], type: T) => events.filter((e): e is Extract<RunEvent, { type: T }> => e.type === type);
const firstFails = () => {
  let n = 0;
  return () => Promise.resolve(n++ === 0 ? STOPPED : OK);
};

describe('SPEC-062 · cada paso', () => {
  it('[R62.1] el paso no se cierra ni arranca el siguiente hasta tener el veredicto', async () => {
    let release!: (v: SupervisorVerdict) => void;
    const { orch, agents } = rig({ supervise: () => new Promise((resolve) => (release = resolve)) });
    const handle = orch.start(chain(['a']), 'Pedido');
    await vi.waitFor(() => expect(agents.callsOf('a')).toHaveLength(1));
    await vi.waitFor(() => expect(release).toBeDefined());
    expect(handle.bus.history().some((e) => e.type === 'node.finished' && e.nodeId === 'a')).toBe(false);
    release(OK);
    const { events } = await handle.result;
    const types = events.map((e) => `${e.type}:${'nodeId' in e ? e.nodeId : ''}`);
    expect(types.indexOf('supervisor.note:a')).toBeLessThan(types.indexOf('node.finished:a'));
  });

  it('[R62.1] la memoria del siguiente paso ya lleva lo que hizo el anterior', async () => {
    const { orch, agents } = rig({ supervise: () => Promise.resolve(OK) });
    await run(orch, []);
    expect(agents.callsOf('b')[0]!.memory).toContain('Hizo lo pedido');
  });

  it('[R62.2] la revisión recibe lo pedido, el agente y las respuestas de la persona', async () => {
    const seen: Parameters<NonNullable<MockDecider['supervise']>>[0][] = [];
    const { orch } = rig({ supervise: (r) => (seen.push(r), Promise.resolve(OK)) }, { purpose: 'Audita webs' });
    await run(orch, [], 'Añade diagramas');
    expect(seen[0]).toMatchObject({ order: 'Añade diagramas', purpose: 'Audita webs', step: 'a' });
  });

  it('[R62.2] si el paso preguntó, la revisión sabe qué se respondió', async () => {
    const seen: string[][] = [];
    const agents = new MockAgent({ a: { output: 'uno', asks: [{ question: '¿Qué hago?' }] } });
    const orch = new Orchestrator({ getAdapter: () => agents, decider: new MockDecider({ supervise: (r) => (seen.push([...r.actions]), Promise.resolve(OK)) }), supervisor: { review: () => true } });
    const handle = orch.start(chain(['a']), 'Pedido');
    handle.bus.subscribe((e) => {
      if (e.type === 'agent.question') queueMicrotask(() => handle.answer(e.questionId, 'Llevarlos a la rama 009'));
    });
    await handle.result;
    expect(seen[0]).toContain('La persona respondió: Llevarlos a la rama 009');
  });

  it('[R62.4] un paso sin terminar se detiene, avisa y pregunta qué hacer', async () => {
    const { orch, agents } = rig({ supervise: firstFails() });
    const r = await run(orch, [UNFINISHED_CONTINUE]);
    const [q] = ofType(r.events, 'agent.question');
    expect(q).toMatchObject({ nodeId: 'a', kind: 'unfinished', options: UNFINISHED_OPTIONS });
    expect(q!.text).toContain('Solo hizo 1 de 44 tareas');
    expect(ofType(r.events, 'supervisor.alert')).toMatchObject([{ nodeId: 'a', rule: 'ai-review' }]);
    const types = r.events.map((e) => `${e.type}:${'nodeId' in e ? e.nodeId : ''}`);
    expect(types.indexOf('agent.question:a')).toBeLessThan(types.indexOf('node.finished:a'));
    expect(agents.callsOf('b')).toHaveLength(1);
  });

  it('[R62.5] repetir vuelve a ejecutar el paso con lo que faltaba, y lo revisa otra vez', async () => {
    const supervise = vi.fn(firstFails());
    const { orch, agents } = rig({ supervise });
    await run(orch, [UNFINISHED_RETRY]);
    expect(agents.callsOf('a')).toHaveLength(2);
    expect(agents.callsOf('a')[1]!.input.text).toContain('Termina lo que faltaba: Solo hizo 1 de 44 tareas');
    expect(agents.callsOf('a')[1]!.input.text).toContain('uno');
    expect(supervise).toHaveBeenCalledTimes(3);
  });

  it('[R62.5] un texto libre es la instrucción con la que se repite', async () => {
    const { orch, agents } = rig({ supervise: firstFails() });
    await run(orch, ['Acepta la línea base y sigue']);
    expect(agents.callsOf('a')[1]!.input.text).toContain('Acepta la línea base y sigue');
  });

  it('[R62.6] seguir igualmente cierra el paso con su salida', async () => {
    const { orch, agents } = rig({ supervise: firstFails() });
    const r = await run(orch, [UNFINISHED_CONTINUE]);
    expect(agents.callsOf('a')).toHaveLength(1);
    expect(r.status).toBe('succeeded');
    expect(agents.callsOf('b')[0]!.input.text).toContain('uno');
  });

  it('[R62.7] parar falla el paso y no se ejecuta el siguiente', async () => {
    const { orch, agents } = rig({ supervise: firstFails() });
    const r = await run(orch, [UNFINISHED_STOP]);
    expect(r.status).toBe('failed');
    expect(agents.callsOf('b')).toHaveLength(0);
    expect(ofType(r.events, 'error')[0]!.message).toContain('Solo hizo 1 de 44 tareas');
  });

  it('[R62.8] si la revisión falla, el paso sigue con un aviso y el siguiente se revisa igual', async () => {
    const supervise = vi.fn(() => Promise.reject(new Error('sin red')));
    const { orch } = rig({ supervise });
    const r = await run(orch, []);
    expect(r.status).toBe('succeeded');
    expect(supervise).toHaveBeenCalledTimes(2);
    expect(ofType(r.events, 'supervisor.alert').map((a) => [a.nodeId, a.rule])).toEqual([['a', 'unchecked'], ['b', 'unchecked']]);
    expect(ofType(r.events, 'supervisor.note')).toHaveLength(2);
  });

  it('[R62.8] si tarda demasiado, tampoco bloquea para siempre', async () => {
    const { orch } = rig({ supervise: () => new Promise(() => {}) }, { checkMs: 10 });
    const r = await run(orch, []);
    expect(r.status).toBe('succeeded');
    expect(ofType(r.events, 'supervisor.alert').map((a) => a.rule)).toEqual(['unchecked', 'unchecked']);
  });
});

describe('SPEC-062 · el resultado final', () => {
  it('[R62.9] compara lo pedido con lo que entregó cada paso, antes de cerrar', async () => {
    const seen: Parameters<NonNullable<MockDecider['verifyRun']>>[0][] = [];
    const { orch } = rig({ supervise: () => Promise.resolve(OK), verifyRun: (r) => (seen.push(r), Promise.resolve({ met: true, missing: '' })) });
    const r = await run(orch, [], 'Añade diagramas');
    expect(seen[0]).toMatchObject({ order: { text: 'Añade diagramas' }, steps: [{ step: 'a', text: 'uno' }, { step: 'b', text: 'dos' }] });
    expect(r.status).toBe('succeeded');
    const types = r.events.map((e) => e.type);
    expect(types.indexOf('supervisor.verified')).toBeLessThan(types.indexOf('run.finished'));
    expect(ofType(r.events, 'supervisor.verified')).toMatchObject([{ met: true }]);
  });

  it('[R62.17] la comprobación final sabe lo que decidió la persona', async () => {
    const seen: (string[] | undefined)[] = [];
    const { orch } = rig({ supervise: firstFails(), verifyRun: (r) => (seen.push(r.decisions), Promise.resolve({ met: true, missing: '' })) });
    await run(orch, [UNFINISHED_CONTINUE]);
    expect(seen[0]).toHaveLength(1);
    expect(seen[0]![0]).toContain('Solo hizo 1 de 44 tareas');
    expect(seen[0]![0]).toContain('→ Seguir igualmente');
  });

  it('[R62.9] su gasto cuenta en el uso', async () => {
    const usage = { inputTokens: 10, outputTokens: 5, costUsd: 0.01 };
    const { orch } = rig({ supervise: () => Promise.resolve(OK), verifyRun: () => Promise.resolve({ met: true, missing: '', usage }) });
    expect((await run(orch, [])).usage.costUsd).toBe(0.01);
  });

  it('[R62.10] si no se cumple, la ejecución acaba fallida con lo que falta', async () => {
    const { orch } = rig({ supervise: firstFails(), verifyRun: () => Promise.resolve({ met: false, missing: 'No hay ningún diagrama' }) });
    const r = await run(orch, [UNFINISHED_CONTINUE]);
    expect(r.status).toBe('failed');
    expect(r.reason).toBe('No cumple lo pedido: No hay ningún diagrama');
    expect(ofType(r.events, 'run.finished')).toMatchObject([{ status: 'failed', reason: 'No cumple lo pedido: No hay ningún diagrama' }]);
    expect(ofType(r.events, 'supervisor.alert').map((a) => a.rule)).toContain('requirements-unmet');
  });

  it('[R62.12] si no se puede comprobar, el estado no cambia y queda el aviso', async () => {
    const { orch } = rig({ supervise: () => Promise.resolve(OK), verifyRun: () => Promise.reject(new Error('sin red')) });
    const r = await run(orch, []);
    expect(r.status).toBe('succeeded');
    expect(ofType(r.events, 'supervisor.alert')).toMatchObject([{ rule: 'unchecked' }]);
    expect(ofType(r.events, 'supervisor.alert')[0]).not.toHaveProperty('nodeId');
  });

  it('[R62.12] una ejecución fallida no se comprueba', async () => {
    const verifyRun = vi.fn(() => Promise.resolve({ met: true, missing: '' }));
    const { orch } = rig({ supervise: firstFails(), verifyRun });
    await run(orch, [UNFINISHED_STOP]);
    expect(verifyRun).not.toHaveBeenCalled();
  });
});

describe('SPEC-041 · lo reutilizado trae su rastro', () => {
  const scripts = (fail: boolean) => ({
    a: { output: 'uno', files: ['a.md'], branches: [{ branch: 'feature/x', via: 'command' as const, created: true }], gitActions: [{ branch: 'feature/x', action: 'commit' as const }] },
    b: fail ? { failTimes: 1, failRetriable: false } : { output: 'dos' },
  });
  const supervise = (_q: { step: string }) => Promise.resolve({ ok: true, reason: '', summary: 'Hizo su parte', outOfScope: 'Tocó el pie' });

  async function resumed(verifyRun?: NonNullable<ConstructorParameters<typeof MockDecider>[0]>['verifyRun']) {
    const calls = vi.fn(supervise);
    const first = new Orchestrator({ getAdapter: () => new MockAgent(scripts(true)), decider: new MockDecider({ supervise: calls }), supervisor: { review: () => true } });
    const old = await first.start(chain(['a', 'b']), 'Pedido').result;
    calls.mockClear();
    const outputs = resumePlan(chain(['a', 'b']), old.events);
    const agents = new MockAgent(scripts(false));
    const second = new Orchestrator({ getAdapter: () => agents, decider: new MockDecider({ supervise: calls, ...(verifyRun ? { verifyRun } : {}) }), supervisor: { review: () => true } });
    const r = await second.start(chain(['a', 'b']), 'Pedido', { reuse: { fromRunId: old.runId, outputs, trail: reusedTrail(outputs, old.events) } }).result;
    return { r, agents, calls, outputs, old };
  }

  it('[R41.7] solo guarda lo de los pasos reutilizados', async () => {
    const { outputs, old } = await resumed();
    const trail = reusedTrail(outputs, old.events);
    expect(Object.keys(trail)).toEqual(['a']);
    expect(trail.a!.map((e) => e.type).sort()).toEqual(['file.produced', 'git.action', 'git.branch', 'supervisor.alert', 'supervisor.note']);
  });

  it('[R41.7] la ejecución nueva tiene las ramas, los archivos, los avisos y la memoria del paso', async () => {
    const { r } = await resumed();
    expect(ofType(r.events, 'git.branch')).toMatchObject([{ nodeId: 'a', branch: 'feature/x', created: true }]);
    expect(ofType(r.events, 'git.action')).toMatchObject([{ nodeId: 'a', action: 'commit' }]);
    expect(ofType(r.events, 'file.produced')).toMatchObject([{ nodeId: 'a', path: 'a.md', reused: true }]);
    expect(ofType(r.events, 'supervisor.note').map((n) => n.nodeId)).toEqual(['a', 'b']);
    expect(ofType(r.events, 'supervisor.alert').filter((a) => a.nodeId === 'a')).toMatchObject([{ rule: 'out-of-scope', detail: 'Tocó el pie' }]);
  });

  it('[R41.7] reanudar una reanudada conserva el rastro', async () => {
    const { r, outputs } = await resumed();
    const trail = reusedTrail(outputs, r.events);
    expect(trail.a!.map((e) => e.type)).toContain('supervisor.note');
    expect(trail.a!.map((e) => e.type)).toContain('git.branch');
  });

  it('[R41.8] el paso siguiente recibe la memoria con la rama y lo anotado', async () => {
    const { agents } = await resumed();
    const memory = agents.callsOf('b')[0]!.memory!;
    expect(memory.split('\n')[0]).toBe('Rama de git: feature/x (creada por a)');
    expect(memory).toContain('Hizo su parte');
  });

  it('[R41.8] la comprobación final cuenta lo que entregó el paso reutilizado', async () => {
    const seen: string[][] = [];
    await resumed((q) => (seen.push(q.steps.map((s) => s.text)), Promise.resolve({ met: true, missing: '' })));
    expect(seen[0]).toHaveLength(2);
    expect(seen[0]![0]).toContain('uno');
    expect(seen[0]![1]).toBe('dos');
  });

  it('[R41.9] no revisa el paso reutilizado, no gasta y no repite el aviso', async () => {
    const { r, calls, agents } = await resumed();
    expect(calls.mock.calls.map(([q]) => q.step)).toEqual(['b']);
    expect(agents.callsOf('a')).toHaveLength(0);
    expect(ofType(r.events, 'agent.usage').filter((u) => u.nodeId === 'a')).toEqual([]);
    expect(ofType(r.events, 'agent.question')).toEqual([]);
    expect(ofType(r.events, 'supervisor.alert').filter((a) => a.nodeId === 'a')).toHaveLength(1);
  });
});

describe('SPEC-062 · una corrección', () => {
  const correction = { fromRunId: 'old', nodeId: 'b', text: 'El diagrama se ve mal', previous: { text: 'dos', files: [] }, before: [{ step: 'b', text: 'Hice 12 diagramas', files: ['d.html'] }] };
  const reuse = { fromRunId: 'old', outputs: { a: { text: 'uno', files: [] } } };

  it('[R62.15] la revisión del paso sabe que le toca la corrección', async () => {
    const seen: (string | undefined)[] = [];
    const { orch } = rig({ supervise: (r) => (seen.push(r.correction), Promise.resolve(OK)) });
    await orch.start(chain(['a', 'b']), 'Añade diagramas', { reuse, correction }).result;
    expect(seen).toEqual(['El diagrama se ve mal']);
  });

  it('[R62.15] sin corrección no la lleva', async () => {
    const seen: Parameters<NonNullable<MockDecider['supervise']>>[0][] = [];
    const { orch } = rig({ supervise: (r) => (seen.push(r), Promise.resolve(OK)) });
    await run(orch, []);
    expect(seen[0]).not.toHaveProperty('correction');
  });

  it('[R62.16] la comprobación final suma lo anterior y lo nuevo', async () => {
    const seen: Parameters<NonNullable<MockDecider['verifyRun']>>[0][] = [];
    const { orch } = rig({ supervise: () => Promise.resolve(OK), verifyRun: (r) => (seen.push(r), Promise.resolve({ met: true, missing: '' })) });
    const r = await orch.start(chain(['a', 'b']), 'Añade diagramas', { reuse, correction }).result;
    expect(r.status).toBe('succeeded');
    expect(seen[0]).toMatchObject({ correction: 'El diagrama se ve mal', before: [{ step: 'b', text: 'Hice 12 diagramas' }], order: { text: 'Añade diagramas' } });
  });

  it('[R62.16] lo anterior son las salidas de los pasos que se repiten, no las de los reutilizados', () => {
    const finished = (nodeId: string, text: string) => ({ runId: 'r', seq: 1, ts: 't', type: 'node.finished', nodeId, status: 'succeeded', output: { text, files: [] } }) as unknown as RunEvent;
    const d = chain(['a', 'b']);
    expect(redoneSteps(d, [finished('a', 'uno'), finished('b', 'dos')], { a: { text: 'uno', files: [] } })).toEqual([{ step: 'b', text: 'dos', files: [] }]);
  });
});

