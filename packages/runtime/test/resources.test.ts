import { describe, expect, it } from 'vitest';
import { MemoryLibrary, MockAgent, MockDecider, defaultSettings, memoryEngine, type AppSettings, type Decider, type Diagram, type RunEvent } from '@orquestador/core';
import { AppResources, GlobalLimiter, ProviderCooldowns, createEngineOrchestrator, runDefaultsFrom, type Clock } from '../src';
import { goldenScenarios } from './golden-scenarios';

const fan = (n: number, id = 'd'): Diagram => ({
  id,
  name: id,
  schemaVersion: 1,
  nodes: [{ id: 'entry', kind: 'entry' }, ...Array.from({ length: n }, (_, i) => ({ id: `a${i}`, kind: 'agent' as const, agentId: 'a' })), { id: 'output', kind: 'output' }],
  edges: Array.from({ length: n }, (_, i) => [
    { id: `e${i}`, from: 'entry', to: `a${i}` },
    { id: `o${i}`, from: `a${i}`, to: 'output' },
  ]).flat(),
});

/** Reloj de prueba: dormir avanza el tiempo. */
function clock(start = Date.parse('2026-11-08T10:00:00.000Z')): Clock & { t: number } {
  const c = {
    t: start,
    now: () => c.t,
    sleep: async (ms: number) => {
      c.t += Math.max(0, ms);
    },
  };
  return c;
}

describe('SPEC-077 · límites de toda la app', () => {
  it('[R77.1][R77.2] el limitador global va en orden de llegada y quien cancela sale de la cola', async () => {
    const l = new GlobalLimiter(() => 1);
    const order: string[] = [];
    expect(await l.acquire(new AbortController().signal)).toBe(true);
    const gone = new AbortController();
    const p1 = l.acquire(gone.signal).then((ok) => order.push(`x:${ok}`));
    const p2 = l.acquire(new AbortController().signal).then((ok) => order.push(`y:${ok}`));
    const p3 = l.acquire(new AbortController().signal).then((ok) => order.push(`z:${ok}`));
    gone.abort();
    await p1;
    l.release();
    await p2;
    l.release();
    await p3;
    expect(order).toEqual(['x:false', 'y:true', 'z:true']);
    expect(l.busy).toBe(1);
  });

  it('[R77.1] E77.a: tres ejecuciones de 4 ramas con 8 en toda la app: nunca más de 8 a la vez', async () => {
    const agents = new MockAgent({ a: { latencyMs: 15 } });
    const resources = new AppResources({ maxAgents: () => 8 });
    const orch = createEngineOrchestrator({ library: new MemoryLibrary(), settings: (): AppSettings => ({ ...defaultSettings(), engine: 'mem' as never }), resources }, [memoryEngine('mem', { adapter: agents })]);
    const runs = await Promise.all([1, 2, 3].map((i) => orch.start(fan(4, `d${i}`), 'x', { maxConcurrency: 4 }).result));
    expect(runs.map((r) => r.status)).toEqual(['succeeded', 'succeeded', 'succeeded']);
    expect(agents.maxActive).toBe(8);
    const queued = runs.flatMap((r) => r.events.filter((e): e is Extract<RunEvent, { type: 'node.queued' }> => e.type === 'node.queued' && e.others !== undefined));
    expect(queued.length).toBeGreaterThanOrEqual(4);
    expect(queued.every((e) => e.others === 8)).toBe(true);
    expect(resources.agents.busy).toBe(0);
  });

  it('[R77.1] las decisiones tienen su propio límite global', async () => {
    let active = 0;
    let peak = 0;
    const decider = new MockDecider();
    const slow = async <T>(v: T) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 10));
      active--;
      return v;
    };
    Object.assign(decider, { condition: () => slow({ result: true, reason: 'x' }) });
    const resources = new AppResources({ maxDecisions: () => 2 });
    const orch = createEngineOrchestrator({ library: new MemoryLibrary(), settings: (): AppSettings => ({ ...defaultSettings(), engine: 'mem' as never }), resources }, [memoryEngine('mem', { decider: decider as Decider })]);
    const d = orch['deps' as never] as { decider: Decider };
    const s = new AbortController().signal;
    await Promise.all(Array.from({ length: 6 }, () => d.decider.condition({ condition: 'x', output: { text: '', files: [] } } as never, s)));
    expect(peak).toBe(2);
  });
});

describe('SPEC-077 · enfriamiento del proveedor', () => {
  it('[R77.4] abre, se alarga y caduca', () => {
    const c = clock();
    const cd = new ProviderCooldowns(c);
    expect(cd.open('claude', 0, 'rate_limit')).toBeUndefined();
    expect(cd.open('claude', 30_000, 'rate_limit')).toEqual({ provider: 'claude', untilTs: '2026-11-08T10:00:30.000Z', reason: 'rate_limit' });
    expect(cd.open('claude', 10_000, 'overloaded')!.untilTs).toBe('2026-11-08T10:00:30.000Z');
    expect(cd.current('otro')).toBeUndefined();
    c.t += 30_000;
    expect(cd.current('claude')).toBeUndefined();
  });

  it('[R77.4][R77.5] E77.b: durante el enfriamiento ninguna ejecución arranca un intento ni una decisión con ese proveedor', async () => {
    const c = clock();
    const resources = new AppResources({ clock: c, provider: () => 'claude' });
    resources.limited({ retryAfterMs: 30_000, reason: 'rate_limit' });
    const cooling: string[] = [];
    const release = await resources.agentSlot({ signal: new AbortController().signal, queued: () => undefined, cooling: (x) => cooling.push(x.untilTs) });
    expect(cooling).toEqual(['2026-11-08T10:00:30.000Z']);
    expect(c.t).toBe(Date.parse('2026-11-08T10:00:30.000Z'));
    release();
    resources.limited({ retryAfterMs: 5000, reason: 'overloaded' });
    await resources.decision(new AbortController().signal, async () => 'ok');
    expect(c.t).toBe(Date.parse('2026-11-08T10:00:35.000Z'));
  });
});

describe('SPEC-077 · desde Ajustes', () => {
  it('[R77.8] onBudget llega a cada ejecución', () => {
    expect(runDefaultsFrom({ ...defaultSettings(), onBudget: 'finish-running' }).onBudget).toBe('finish-running');
    expect(runDefaultsFrom(defaultSettings()).onBudget).toBeUndefined();
  });

  it('[R77.10] el umbral de burn-rate sale de Ajustes', () => {
    const settings = (): AppSettings => ({ ...defaultSettings(), engine: 'mem' as never, burnRateUsdPerMin: 5 });
    const orch = createEngineOrchestrator({ library: new MemoryLibrary(), settings }, [memoryEngine('mem', {})]);
    expect((orch['deps' as never] as { supervisor: { burnRate(): number } }).supervisor.burnRate()).toBe(5);
  });

  it('[R77.15][R77.16] la app junta los tokens: el caso de referencia «lineal» con 200 fragmentos tiene al menos 10 veces menos', async () => {
    const lineal = goldenScenarios().find((s) => s.name === 'lineal')!;
    const tokens = Array.from({ length: 200 }, (_, i) => `palabra${i} `);
    const agents = () => new MockAgent(Object.fromEntries(lineal.diagram.nodes.filter((n) => n.kind === 'agent').map((n) => [n.agentId!, { tokens }])));
    const run = async (coalesce: boolean) => {
      const settings = (): AppSettings => ({ ...defaultSettings(), engine: 'mem' as never });
      const orch = createEngineOrchestrator({ library: new MemoryLibrary(), settings }, [memoryEngine('mem', { adapter: agents() })]);
      if (!coalesce) delete (orch['deps' as never] as { coalesceTokens?: unknown }).coalesceTokens;
      return (await orch.start(lineal.diagram, 'x').result).events.filter((e): e is Extract<RunEvent, { type: 'token.stream' }> => e.type === 'token.stream');
    };
    const [grouped, raw] = [await run(true), await run(false)];
    expect(raw.length).toBeGreaterThanOrEqual(10 * grouped.length);
    expect(grouped.map((e) => e.text).join('')).toBe(raw.map((e) => e.text).join(''));
  });
});
