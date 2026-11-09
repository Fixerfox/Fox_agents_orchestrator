import { describe, expect, it } from 'vitest';
import {
  CONFIRM_APPROVE,
  MAX_PROPOSALS,
  MEMORY_STALE_DAYS,
  MockAgent,
  MockDecider,
  Orchestrator,
  UNFINISHED_RETRY,
  applyProposal,
  applyRules,
  looksLikeSecret,
  markUsed,
  memoryEntryProblems,
  memoryFor,
  memoryIndexMarkdown,
  memorySignals,
  newRuleState,
  renderProjectMemory,
  ruleProposals,
  scopesFor,
  searchMemory,
  staleReason,
  withoutDiscarded,
  type MemoryEntry,
  type MemoryProposal,
  type RunEvent,
  type SupervisorReview,
  type SupervisorVerdict,
} from '../src';
import { chain, ofType } from './helpers';

let seq = 0;
const ev = (b: Record<string, unknown>) => ({ runId: 'r', seq: ++seq, ts: '2026-11-08T10:00:00.000Z', ...b }) as unknown as RunEvent;
const T0 = '2026-11-01T10:00:00.000Z';

const entry = (id: string, o: Partial<MemoryEntry> = {}): MemoryEntry => ({
  id,
  kind: 'convention',
  scope: 'project',
  title: `Título ${id}`,
  text: `Texto ${id}`,
  status: 'active',
  source: { origin: 'manual' },
  createdAt: T0,
  updatedAt: T0,
  uses: 0,
  history: [{ at: T0, action: 'created', by: 'user' }],
  ...o,
});

const proposal = (o: Partial<MemoryProposal> = {}): MemoryProposal => ({ id: 'p1', action: 'add', kind: 'convention', scope: 'project', title: 'Usa pnpm', text: 'El proyecto usa pnpm, no npm', origin: 'correction', ...o });

describe('SPEC-076 · modelo', () => {
  it('[R76.1] una entrada válida no tiene problemas; tipo, ámbito y longitudes se comprueban', () => {
    expect(memoryEntryProblems(entry('a'))).toEqual([]);
    expect(memoryEntryProblems(entry('a', { kind: 'otra' as never }))[0]).toContain('tipo');
    expect(memoryEntryProblems(entry('a', { scope: 'equipo' }))[0]).toContain('ámbito');
    expect(memoryEntryProblems(entry('a', { scope: 'diagram:d1' }))).toEqual([]);
    expect(memoryEntryProblems(entry('a', { scope: 'agent:revisor' }))).toEqual([]);
    expect(memoryEntryProblems(entry('a', { title: 'x'.repeat(81) }))[0]).toContain('80');
    expect(memoryEntryProblems(entry('a', { text: 'x'.repeat(601) }))[0]).toContain('600');
    expect(memoryEntryProblems(entry('a', { title: ' ', text: '' }))).toHaveLength(2);
  });

  it('[R76.3] lo que parece una clave no vale', () => {
    expect(looksLikeSecret('la clave es sk-ant-abcdefghijklmnopqrstuvwx')).toBe(true);
    expect(looksLikeSecret('token ghp_abcdefghijklmnopqrstuvwxyz')).toBe(true);
    expect(looksLikeSecret('-----BEGIN RSA PRIVATE KEY-----')).toBe(true);
    expect(looksLikeSecret('Los tests van con npm test')).toBe(false);
    expect(memoryEntryProblems(entry('a', { text: 'usa AKIAABCDEFGHIJKLMNOP' })).join()).toContain('secreto');
  });

  it('[R76.2] el índice MEMORIA.md va por ámbito, proyecto primero, sin las archivadas', () => {
    const md = memoryIndexMarkdown([entry('b', { scope: 'agent:rev', title: 'Del agente' }), entry('a', { title: 'Del proyecto' }), entry('c', { status: 'archived', title: 'Vieja' })]);
    expect(md.indexOf('## Proyecto')).toBeLessThan(md.indexOf('## Agente rev'));
    expect(md).toContain('**Del proyecto** (convención)');
    expect(md).not.toContain('Vieja');
    expect(md.endsWith('\n')).toBe(true);
  });
});

describe('SPEC-076 · señales y propuestas', () => {
  it('[R76.5] solo lo que dijo la persona: correcciones, confirmaciones con cambios, revisiones, reintentos con texto y avisos falsos', () => {
    const events = [
      ev({ type: 'agent.request', nodeId: 'a', agentId: 'dev', input: { text: '' } }),
      ev({ type: 'correction.applied', nodeId: 'a', fromRunId: 'r0', text: 'Usa pnpm' }),
      ev({ type: 'confirm.decided', nodeId: 'a', round: 1, verdict: 'changes', text: 'Más corto' }),
      ev({ type: 'confirm.decided', nodeId: 'a', round: 2, verdict: 'approved' }),
      ev({ type: 'agent.question', nodeId: 'a', questionId: 'q1', text: '¿Vale?', review: { phase: 'feedback' } }),
      ev({ type: 'agent.answer', nodeId: 'a', questionId: 'q1', text: 'Pon tildes' }),
      ev({ type: 'agent.question', nodeId: 'a', questionId: 'q2', text: '¿Otra?', review: { phase: 'feedback' } }),
      ev({ type: 'agent.answer', nodeId: 'a', questionId: 'q2', text: CONFIRM_APPROVE }),
      ev({ type: 'agent.question', nodeId: 'a', questionId: 'q3', text: 'No terminó', kind: 'unfinished' }),
      ev({ type: 'agent.answer', nodeId: 'a', questionId: 'q3', text: 'Ejecuta los tests antes' }),
      ev({ type: 'agent.question', nodeId: 'a', questionId: 'q4', text: 'No terminó', kind: 'unfinished' }),
      ev({ type: 'agent.answer', nodeId: 'a', questionId: 'q4', text: UNFINISHED_RETRY }),
      ev({ type: 'supervisor.alert', nodeId: 'a', rule: 'undeclared-file', severity: 'warning', detail: 'Tocó package.json' }),
    ];
    const alertSeq = (events[events.length - 1] as { seq: number }).seq;
    events.push(ev({ type: 'supervisor.feedback', alertSeq, verdict: 'false-alarm', note: 'es normal' }));
    const signals = memorySignals(events);
    expect(signals.map((s) => [s.origin, s.text])).toEqual([
      ['correction', 'Usa pnpm'],
      ['confirm', 'Más corto'],
      ['alert-feedback', 'Tocó package.json — es normal'],
      ['review', 'Pon tildes'],
      ['retry', 'Ejecuta los tests antes'],
    ]);
    expect(signals[0]).toMatchObject({ nodeId: 'a', agentId: 'dev' });
    expect(signals[2]!.rule).toBe('undeclared-file');
  });

  it('[R76.5] una pregunta cuyo texto ya se respondió antes es señal; las respuestas automáticas o reutilizadas no', () => {
    const q = (id: string, text: string) => ev({ type: 'agent.question', nodeId: 'a', questionId: id, text });
    const past = [[q('x', '¿Qué gestor de paquetes?'), ev({ type: 'agent.answer', nodeId: 'a', questionId: 'x', text: 'pnpm' })]];
    const now = [q('y', '¿Qué gestor  de paquetes?'), ev({ type: 'agent.answer', nodeId: 'a', questionId: 'y', text: 'pnpm' }), q('z', '¿Puerto?'), ev({ type: 'agent.answer', nodeId: 'a', questionId: 'z', text: '3000' })];
    expect(memorySignals(now, past).map((s) => [s.origin, s.question])).toEqual([['repeated-question', '¿Qué gestor  de paquetes?']]);
    expect(memorySignals(now)).toEqual([]);
    const auto = [q('y', '¿Qué gestor de paquetes?'), ev({ type: 'agent.answer', nodeId: 'a', questionId: 'y', text: 'pnpm', auto: true })];
    expect(memorySignals(auto, past)).toEqual([]);
  });

  it('[R76.5] los secretos de lo que se dijo se ocultan', () => {
    const s = memorySignals([ev({ type: 'correction.applied', nodeId: 'a', fromRunId: 'r0', text: 'usa ANTHROPIC_API_KEY=sk-ant-abcdefghijklmnopqrstuvwx' })]);
    expect(s[0]!.text).not.toContain('sk-ant-abcdefghij');
  });

  it('[R76.9] la regla fija: una propuesta por señal, como mucho 5, con tipo según el origen', () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ origin: 'correction' as const, text: `Regla ${i}` }));
    expect(ruleProposals(many)).toHaveLength(MAX_PROPOSALS);
    const [a, b, c] = ruleProposals([
      { origin: 'retry', text: 'Ejecuta los tests' },
      { origin: 'alert-feedback', text: 'Tocar package.json es normal', agentId: 'dev' },
      { origin: 'repeated-question', text: 'pnpm', question: '¿Qué gestor?' },
    ]);
    expect(a).toMatchObject({ id: 'p1', action: 'add', kind: 'lesson', scope: 'project' });
    expect(b).toMatchObject({ kind: 'false-alarm', scope: 'agent:dev' });
    expect(c).toMatchObject({ kind: 'preference', title: '¿Qué gestor?', text: '¿Qué gestor? → pnpm' });
  });

  it('[R76.6][R76.9] sin proposeMemory en el decisor sale la regla fija; con él, como mucho 5 y numeradas', async () => {
    const signals = [{ origin: 'correction' as const, text: 'Usa pnpm' }];
    const plain = new Orchestrator({ getAdapter: () => new MockAgent(), decider: new MockDecider() });
    expect((await plain.proposeMemory({ signals, entries: [] }, new AbortController().signal)).proposals.map((p) => p.text)).toEqual(['Usa pnpm']);
    const decider = new MockDecider();
    const asked: unknown[] = [];
    Object.assign(decider, { proposeMemory: async (req: unknown) => (asked.push(req), { proposals: Array.from({ length: 8 }, (_, i) => proposal({ id: 'x', text: `t${i}` })), usage: { inputTokens: 1, outputTokens: 1, costUsd: 0.01 } }) });
    const orch = new Orchestrator({ getAdapter: () => new MockAgent(), decider });
    const r = await orch.proposeMemory({ signals, entries: [{ id: 'e1', kind: 'convention', scope: 'project', title: 't', text: 'x' }] }, new AbortController().signal);
    expect(r.proposals.map((p) => p.id)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5']);
    expect(r.usage?.costUsd).toBe(0.01);
    expect(asked).toHaveLength(1);
  });

  it('[R76.11] lo descartado con el mismo texto (normalizado) no se vuelve a proponer', () => {
    const recent = [[ev({ type: 'memory.proposed', proposals: [proposal({ id: 'p1', text: 'El proyecto usa PNPM, no npm.' })] }), ev({ type: 'memory.decided', proposalId: 'p1', decision: 'discard' })]];
    expect(withoutDiscarded([proposal(), proposal({ id: 'p2', text: 'Otra cosa' })], recent).map((p) => p.id)).toEqual(['p2']);
    const saved = [[ev({ type: 'memory.proposed', proposals: [proposal()] }), ev({ type: 'memory.decided', proposalId: 'p1', decision: 'save' })]];
    expect(withoutDiscarded([proposal()], saved)).toHaveLength(1);
  });

  it('[R76.11] guardar añade, actualiza o archiva con su historial; «Editar y guardar» cambia el texto', () => {
    const at = '2026-11-08T12:00:00.000Z';
    const added = applyProposal([], proposal(), { at, by: 'user', runId: 'r1', edited: { text: 'Usa pnpm siempre' }, newId: () => 'm1' });
    expect(added[0]).toMatchObject({ id: 'm1', text: 'Usa pnpm siempre', status: 'active', source: { runId: 'r1', origin: 'correction' }, uses: 0 });
    expect(added[0]!.history).toEqual([{ at, action: 'created', by: 'user', runId: 'r1' }]);
    const updated = applyProposal(added, proposal({ action: 'update', entryId: 'm1', text: 'Usa pnpm 9' }), { at, by: 'user', newId: () => 'x' });
    expect(updated).toHaveLength(1);
    expect(updated[0]!.text).toBe('Usa pnpm 9');
    expect(updated[0]!.history.at(-1)).toMatchObject({ action: 'updated', before: 'Usa pnpm siempre' });
    const archived = applyProposal(updated, proposal({ action: 'archive', entryId: 'm1' }), { at, by: 'assistant', newId: () => 'x' });
    expect(archived[0]!.status).toBe('archived');
    expect(archived[0]!.history.at(-1)).toMatchObject({ action: 'archived', by: 'assistant' });
  });

  it('[R76.12] lo que guarda el asistente lleva origin assistant', () => {
    const r = applyProposal([], proposal(), { at: T0, by: 'assistant', newId: () => 'm1' });
    expect(r[0]!.source.origin).toBe('assistant');
  });

  it('[R76.16] al terminar, las entradas que recibieron los pasos suman usos y lastUsedAt', () => {
    const events = [ev({ type: 'agent.request', nodeId: 'a', agentId: 'x', input: { text: '' }, projectMemory: ['m1', 'm2'] }), ev({ type: 'agent.request', nodeId: 'b', agentId: 'x', input: { text: '' }, projectMemory: ['m1'] })];
    const out = markUsed([entry('m1'), entry('m2', { uses: 4 }), entry('m3')], events, '2026-11-08T12:00:00.000Z');
    expect(out.map((e) => [e.id, e.uses, e.lastUsedAt])).toEqual([
      ['m1', 2, '2026-11-08T12:00:00.000Z'],
      ['m2', 5, '2026-11-08T12:00:00.000Z'],
      ['m3', 0, undefined],
    ]);
  });
});

describe('SPEC-076 · lo que reciben los agentes', () => {
  const now = (d: string) => entry(d, { updatedAt: `2026-11-0${d.slice(-1)}T10:00:00.000Z` });

  it('[R76.14] ámbitos por prioridad: agente, diagrama y proyecto; dentro, lo usado más reciente', () => {
    expect(scopesFor({ diagramId: 'd', agentId: 'a' })).toEqual(['agent:a', 'diagram:d', 'project']);
    const list = memoryFor([now('p1'), now('p2'), { ...now('g1'), scope: 'agent:a' }, { ...now('d1'), scope: 'diagram:d' }, { ...now('o1'), scope: 'agent:otro' }, { ...now('p3'), status: 'archived' }], { diagramId: 'd', agentId: 'a' });
    expect(list.map((e) => e.id)).toEqual(['g1', 'd1', 'p2', 'p1']);
  });

  it('[R76.14] la sección tiene tope: lo que no cabe va solo por título; los avisos falsos no van al agente', () => {
    const big = Array.from({ length: 30 }, (_, i) => entry(`m${i}`, { text: 'x'.repeat(200) }));
    const r = renderProjectMemory([...big, entry('fa', { kind: 'false-alarm', title: 'Aviso' })], {}, 300)!;
    expect(r.text).toContain('memoria_proyecto');
    expect(r.text).toMatch(/- Título m\d+ \(id m\d+\)/);
    expect(r.text.length).toBeLessThan(300 * 3.5 + 30 * 40);
    expect(r.ids).not.toContain('fa');
    expect(renderProjectMemory([entry('fa', { kind: 'false-alarm' })], {})).toBeUndefined();
  });

  it('[R76.15] la búsqueda solo mira las activas de sus ámbitos', () => {
    const all = [entry('a', { text: 'usa pnpm' }), entry('b', { text: 'pnpm también', scope: 'agent:otro' }), entry('c', { text: 'pnpm viejo', status: 'archived' })];
    expect(searchMemory(all, ['project'], 'pnpm').map((e) => e.id)).toEqual(['a']);
    expect(searchMemory(all, ['project'], 'nada')).toEqual([]);
  });

  it('[R76.13][R76.14][R76.16] cada paso recibe la memoria de su agente y diagrama, y agent.request registra los ids', async () => {
    const agents = new MockAgent({ a: { output: 'hecho' } });
    const asked: { runId: string; diagramId: string; agentId: string }[] = [];
    const orch = new Orchestrator({
      getAdapter: () => agents,
      decider: new MockDecider(),
      projectMemory: async (runId, o) => (asked.push({ runId, ...o }), { text: '- [Convención] Usa pnpm: siempre', ids: ['m1'] }),
    });
    const d = chain(['a']);
    const { events } = await orch.start(d, 'Pedido').result;
    expect(asked[0]).toMatchObject({ diagramId: d.id, agentId: 'a' });
    expect(agents.calls[0]!.projectMemory).toEqual({ text: '- [Convención] Usa pnpm: siempre', ids: ['m1'] });
    expect(ofType(events, 'agent.request')[0]!.projectMemory).toEqual(['m1']);
  });

  it('[R76.17] el Supervisor recibe los avisos que la persona marcó como falsos', async () => {
    const reviews: SupervisorReview[] = [];
    const OK: SupervisorVerdict = { ok: true, reason: '', summary: 'Hecho', severity: 'none' };
    const orch = new Orchestrator({
      getAdapter: () => new MockAgent({ a: { output: 'hecho' } }),
      decider: new MockDecider({ supervise: async (q) => (reviews.push(q), OK) }),
      supervisor: { review: () => true },
      falseAlarms: async (_runId, o) => (o.agentId === 'a' ? ['Tocar package.json es normal'] : []),
    });
    await orch.start(chain(['a']), 'Pedido').result;
    expect(reviews[0]!.falseAlarms).toEqual(['Tocar package.json es normal']);
  });
});

describe('SPEC-076 · instrucciones y mantenimiento', () => {
  it('[R76.19] tocar CLAUDE.md, AGENTS.md o .claude/ avisa de que cambia las ejecuciones siguientes', () => {
    const rules = (path: string) => applyRules(newRuleState(), ev({ type: 'file.produced', nodeId: 'a', path, change: 'modified' }), undefined);
    for (const p of ['CLAUDE.md', 'pkg/CLAUDE.local.md', 'AGENTS.md', '.claude/settings.json']) {
      const [a] = rules(p);
      expect(a).toMatchObject({ rule: 'instructions-changed' });
      expect(a!.detail).toContain('ejecuciones siguientes');
    }
    expect(rules('docs/claude.md.txt').map((a) => a.rule)).not.toContain('instructions-changed');
  });

  it('[R76.20] «¿Sigue valiendo?»: sin usar en 60 días, o con una ruta que ya no existe; nunca se archiva sola', () => {
    const now = Date.parse('2026-11-08T10:00:00.000Z');
    const old = entry('a', { updatedAt: new Date(now - (MEMORY_STALE_DAYS + 1) * 86_400_000).toISOString() });
    expect(staleReason(old, now)).toBe('unused');
    expect(staleReason({ ...old, lastUsedAt: '2026-11-07T10:00:00.000Z' }, now)).toBeUndefined();
    const withPath = entry('b', { updatedAt: '2026-11-07T10:00:00.000Z', text: 'Los tests van en `test/unit/`' });
    expect(staleReason(withPath, now, () => false)).toBe('missing-path');
    expect(staleReason(withPath, now, () => true)).toBeUndefined();
    expect(old.status).toBe('active');
  });
});
