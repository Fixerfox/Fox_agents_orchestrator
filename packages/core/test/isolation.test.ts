import { describe, expect, it } from 'vitest';
import { MockAgent, MockDecider, Orchestrator, parallelRegions, type BranchSpaces, type ConflictChoice, type RunEvent, type SpaceMerge, type SpaceRef } from '../src';
import { CONFLICT_AGENT, CONFLICT_STOP, keepVersionOf } from '../src/execution/run/isolation';
import { ENTRY, OUTPUT, agent, chain, diagram, edge, fan, loop, ofType, router } from './helpers';

type Scripts = ConstructorParameters<typeof MockAgent>[0];

/** Espacios simulados: apuntan lo que se pide y fusionan con el resultado que diga el test. */
class FakeSpaces implements BranchSpaces {
  readonly log: string[] = [];
  readonly opened: { label: string; parent?: string }[] = [];
  private n = 0;
  constructor(private readonly conflictsOf: (label: string) => string[] = () => [], private readonly left: string[][] = []) {}
  private label = new Map<string, string>();
  async open(o: { regionId: string; label: string; parent?: SpaceRef }) {
    const id = `s${++this.n}`;
    this.label.set(id, o.label);
    this.opened.push({ label: o.label, ...(o.parent ? { parent: this.label.get(o.parent.id)! } : {}) });
    this.log.push(`open ${o.label}`);
    return { space: { id, dir: `/espacios/${id}` }, strategy: 'copy' as const };
  }
  async merge(s: SpaceRef, into?: SpaceRef): Promise<SpaceMerge> {
    const label = this.label.get(s.id)!;
    this.log.push(`merge ${label}${into ? ` en ${this.label.get(into.id)}` : ''}`);
    const conflicts = this.conflictsOf(label);
    return { merged: [`${label}.ts`], mergedByLines: [], conflicts, ...(conflicts.length > 0 ? { savedTo: `conflicts/${label}` } : {}) };
  }
  async resolve(s: SpaceRef, _into: SpaceRef | undefined, choice: ConflictChoice) {
    this.log.push(`resolve ${this.label.get(s.id)} ${choice}`);
  }
  async unresolved() {
    return this.left.shift() ?? [];
  }
  async discard(s: SpaceRef) {
    this.log.push(`discard ${this.label.get(s.id)}`);
    return ['a medias.ts'];
  }
  async close(s: SpaceRef) {
    this.log.push(`close ${this.label.get(s.id)}`);
  }
  async closeAll() {
    this.log.push('closeAll');
  }
}

function rig(scripts: Scripts, spaces: FakeSpaces | undefined, opts: { canWrite?: (id: string) => boolean; answer?: (e: Extract<RunEvent, { type: 'agent.question' }>) => string | undefined } = {}) {
  const agents = new MockAgent(scripts);
  const orch = new Orchestrator({ getAdapter: () => agents, decider: new MockDecider(), ...(spaces ? { spaces: () => spaces } : {}), ...(opts.canWrite ? { canWrite: opts.canWrite } : {}) });
  const go = (d: Parameters<Orchestrator['start']>[0]) => {
    const h = orch.start(d, 'Pedido');
    h.bus.subscribe((e) => {
      if (e.type === 'agent.question') {
        const a = opts.answer?.(e);
        if (a !== undefined) queueMicrotask(() => h.answer(e.questionId, a));
      }
    });
    return h.result;
  };
  return { agents, go };
}

/** entry → o → (a, b) → j → output */
const fanJoin = () => diagram([ENTRY, agent('o'), agent('a', 'Web'), agent('b', 'Api'), agent('j'), OUTPUT], [edge('entry', 'o'), edge('o', 'a'), edge('o', 'b'), edge('a', 'j'), edge('b', 'j'), edge('j', 'output')]);

describe('SPEC-073 · qué se aísla', () => {
  it('[R73.1] las ramas de un abanico son lo alcanzable desde cada salida antes de juntarse', () => {
    const d = diagram([ENTRY, agent('o'), agent('a'), agent('a2'), agent('b'), agent('j'), OUTPUT], [edge('entry', 'o'), edge('o', 'a'), edge('a', 'a2'), edge('o', 'b'), edge('a2', 'j'), edge('b', 'j'), edge('j', 'output')]);
    expect(parallelRegions(d)).toEqual([{ id: 'o', branches: [{ entry: 'a', nodes: ['a', 'a2'] }, { entry: 'b', nodes: ['b'] }] }]);
    // Un router elige: sus salidas no corren a la vez.
    const r = diagram([ENTRY, router('r', 'ai'), agent('a'), agent('b'), OUTPUT], [edge('entry', 'r'), edge('r', 'a'), edge('r', 'b'), edge('a', 'output'), edge('b', 'output')]);
    expect(parallelRegions(r)).toEqual([]);
    expect(parallelRegions(chain(['a', 'b']))).toEqual([]);
  });

  it('[R73.2] cada rama que escribe trabaja en su espacio; lo de antes y lo de después, en la carpeta', async () => {
    const spaces = new FakeSpaces();
    const { agents, go } = rig({ o: {}, a: {}, b: {}, j: {} }, spaces);
    const { status, events } = await go(fanJoin());
    expect(status).toBe('succeeded');
    expect(agents.callsOf('o')[0]!.workspace).toBeUndefined();
    expect(agents.callsOf('j')[0]!.workspace).toBeUndefined();
    const dirs = [agents.callsOf('a')[0]!.workspace?.dir, agents.callsOf('b')[0]!.workspace?.dir];
    expect(dirs.every((d) => d?.startsWith('/espacios/'))).toBe(true);
    expect(new Set(dirs).size).toBe(2);
    expect(ofType(events, 'agent.request').filter((e) => e.isolated).map((e) => e.nodeId).sort()).toEqual(['a', 'b']);
  });

  it('[R73.2] sin espacios (Ajustes apagado) nada cambia, y una rama solo de lectura no se aísla', async () => {
    const plain = rig({ o: {}, a: {}, b: {}, j: {} }, undefined);
    const { events } = await plain.go(fanJoin());
    expect(ofType(events, 'workspace.opened')).toEqual([]);
    const spaces = new FakeSpaces();
    const ro = rig({ o: {}, a: {}, b: {}, j: {} }, spaces, { canWrite: (id) => id !== 'b' });
    await ro.go(fanJoin());
    expect(spaces.opened.map((o) => o.label)).toEqual(['Web']);
    expect(ro.agents.callsOf('b')[0]!.workspace).toBeUndefined();
  });

  it('[R73.3] un abanico dentro de una rama se aísla a partir del espacio de esa rama', async () => {
    const d = diagram(
      [ENTRY, agent('o'), agent('a', 'Web'), agent('a1', 'Web1'), agent('a2', 'Web2'), agent('aj', 'WebJunta'), agent('b', 'Api'), agent('j'), OUTPUT],
      [edge('entry', 'o'), edge('o', 'a'), edge('o', 'b'), edge('a', 'a1'), edge('a', 'a2'), edge('a1', 'aj'), edge('a2', 'aj'), edge('aj', 'j'), edge('b', 'j'), edge('j', 'output')],
    );
    const spaces = new FakeSpaces();
    const { go } = rig({ o: {}, a: {}, a1: {}, a2: {}, aj: {}, b: {}, j: {} }, spaces);
    expect((await go(d)).status).toBe('succeeded');
    expect(spaces.opened).toEqual(expect.arrayContaining([{ label: 'Web1', parent: 'Web' }, { label: 'Web2', parent: 'Web' }, { label: 'Api' }]));
    const merges = spaces.log.filter((l) => l.startsWith('merge'));
    expect(merges.indexOf('merge Web1 en Web')).toBeLessThan(merges.indexOf('merge Web'));
    expect(merges.indexOf('merge Web2 en Web')).toBeLessThan(merges.indexOf('merge Web'));
  });

  it('[R73.3] un bucle dentro de una rama trabaja en el espacio de la rama', async () => {
    const d = diagram([ENTRY, loop('L', { mode: 'count', count: 1, maxIterations: 1, body: chain(['x'], 'body') }), agent('b', 'Api'), OUTPUT], [edge('entry', 'L'), edge('entry', 'b'), edge('L', 'output'), edge('b', 'output')]);
    const spaces = new FakeSpaces();
    const { agents, go } = rig({ x: {}, b: {} }, spaces);
    await go(d);
    expect(agents.callsOf('x')[0]!.workspace?.dir).toMatch(/^\/espacios\//);
  });

  it('[R73.7] workspace.opened dice qué ramas y cómo, sin la ruta', async () => {
    const { go } = rig({ o: {}, a: {}, b: {}, j: {} }, new FakeSpaces());
    const { events } = await go(fanJoin());
    const opened = ofType(events, 'workspace.opened');
    expect(opened).toEqual(expect.arrayContaining([expect.objectContaining({ regionId: 'o', branchNodeIds: ['a'], strategy: 'copy' }), expect.objectContaining({ regionId: 'o', branchNodeIds: ['b'] })]));
    expect(JSON.stringify(events)).not.toContain('/espacios/');
  });
});

describe('SPEC-073 · fusión', () => {
  it('[R73.11][R73.13] cada rama se fusiona al terminar, en orden de llegada, antes de que arranque lo que las junta', async () => {
    const spaces = new FakeSpaces();
    const { go } = rig({ o: {}, a: { latencyMs: 30 }, b: { latencyMs: 1 }, j: {} }, spaces);
    const { events } = await go(fanJoin());
    expect(spaces.log.filter((l) => l.startsWith('merge'))).toEqual(['merge Api', 'merge Web']);
    const merged = ofType(events, 'workspace.merged');
    expect(merged).toMatchObject([{ nodeId: 'j', regionId: 'o', branchNodeIds: ['b'], files: ['Api.ts'] }, { nodeId: 'j', branchNodeIds: ['a'] }]);
    const lastMerge = Math.max(...merged.map((e) => e.seq));
    const joinStart = ofType(events, 'node.started').find((e) => e.nodeId === 'j')!.seq;
    expect(lastMerge).toBeLessThan(joinStart);
  });

  it('[R73.14] con un conflicto, lo que junta espera a la persona; quedarse con una versión sigue', async () => {
    const spaces = new FakeSpaces((l) => (l === 'Web' ? ['config.json'] : []));
    let asked: Extract<RunEvent, { type: 'agent.question' }> | undefined;
    const { go } = rig({ o: {}, a: { latencyMs: 20 }, b: {}, j: {} }, spaces, {
      answer: (e) => {
        asked = e;
        return keepVersionOf('Web');
      },
    });
    const { status, events } = await go(fanJoin());
    expect(status).toBe('succeeded');
    expect(asked).toMatchObject({ nodeId: 'j', kind: 'conflict', options: [keepVersionOf('Api'), keepVersionOf('Web'), CONFLICT_AGENT, CONFLICT_STOP] });
    expect(asked!.text).toContain('config.json');
    expect(asked!.text).toContain('conflicts/Web');
    expect(spaces.log).toContain('resolve Web branch');
    expect(ofType(events, 'workspace.conflict')).toMatchObject([{ nodeIds: ['j'], files: ['config.json'], regionId: 'o' }]);
    expect(ofType(events, 'workspace.resolved')).toMatchObject([{ choice: 'branch', files: ['config.json'] }]);
    expect(ofType(events, 'workspace.conflict')[0]!.seq).toBeLessThan(ofType(events, 'node.started').find((e) => e.nodeId === 'j')!.seq);
  });

  it('[R73.14] «Parar la ejecución» (y la respuesta por defecto) para la ejecución', async () => {
    const spaces = new FakeSpaces((l) => (l === 'Web' ? ['config.json'] : []));
    const { agents, go } = rig({ o: {}, a: { latencyMs: 20 }, b: {}, j: {} }, spaces, { answer: () => CONFLICT_STOP });
    const res = await go(fanJoin());
    expect(res.status).toBe('cancelled');
    expect(res.reason).toContain('Conflicto');
    expect(agents.callsOf('j')).toHaveLength(0);
    expect(spaces.log.at(-1)).toBe('closeAll');
  });

  it('[R73.15] «Que lo junte un agente» lanza un paso interno con el agente del nodo que junta', async () => {
    const spaces = new FakeSpaces((l) => (l === 'Web' ? ['config.json'] : []), [[]]);
    const { agents, go } = rig({ o: {}, a: { latencyMs: 20 }, b: {}, j: { usage: { inputTokens: 5, outputTokens: 2 } } }, spaces, { answer: () => CONFLICT_AGENT });
    const { status, events, usage } = await go(fanJoin());
    expect(status).toBe('succeeded');
    expect(spaces.log).toContain('resolve Web markers');
    const merge = ofType(events, 'agent.request').find((e) => e.kind === 'merge')!;
    expect(merge).toMatchObject({ nodeId: 'j', agentId: 'j' });
    expect(merge.task).toContain('config.json');
    expect(agents.callsOf('j')).toHaveLength(2);
    expect(usage.inputTokens).toBe(10);
    expect(ofType(events, 'workspace.resolved')).toMatchObject([{ choice: 'agent' }]);
  });

  it('[R73.17] una rama que falla no se fusiona: se guarda aparte', async () => {
    const spaces = new FakeSpaces();
    const { go } = rig({ o: {}, a: { failTimes: 9, failRetriable: false }, b: {}, j: {} }, spaces);
    const { events } = await go(fanJoin());
    expect(spaces.log).toContain('discard Web');
    expect(spaces.log).not.toContain('merge Web');
    expect(ofType(events, 'workspace.discarded')).toMatchObject([{ regionId: 'o', branchNodeIds: ['a'], files: ['a medias.ts'] }]);
  });

  it('[R73.18] al terminar la ejecución no queda ningún espacio', async () => {
    const spaces = new FakeSpaces();
    const { go } = rig({ a: {}, b: {} }, spaces);
    await go(fan(['a', 'b']));
    expect(spaces.log.at(-1)).toBe('closeAll');
    expect(spaces.log.filter((l) => l.startsWith('close ')).sort()).toEqual(['close a', 'close b']);
  });
});
