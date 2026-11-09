import { describe, expect, it } from 'vitest';
import {
  CHECK_RUN,
  CHECK_SKIP,
  MockAgent,
  MockDecider,
  Orchestrator,
  UNFINISHED_CONTINUE,
  caseAgrees,
  checkProblems,
  feedbackStats,
  mergeChecks,
  parseVerification,
  supervisorCase,
  validateDiagram,
  type AgentAdapter,
  type CheckRunner,
  type EvidenceSource,
  type RunEvent,
  type RunVerification,
  type StepCheck,
  type SupervisorReview,
  type SupervisorVerdict,
} from '../src';
import { ENTRY, OUTPUT, agent, chain, diagram, edge, ofType } from './helpers';

type Scripts = ConstructorParameters<typeof MockAgent>[0];
const OK: SupervisorVerdict = { ok: true, reason: '', summary: 'Hecho', severity: 'none' };
const cmd = (id: string, run: string): StepCheck => ({ id, label: `Comprobación ${id}`, kind: 'command', run });

/** Ejecutor de comprobaciones simulado: aprobados en memoria y salida según el comando. */
function runner(results: Record<string, { exit: number; output?: string }>, approved: string[] = Object.keys(results)) {
  const ran: { run: string; dir?: string }[] = [];
  const ok = new Set(approved);
  const r: CheckRunner = {
    approved: async (run) => ok.has(run),
    approve: async (run) => void ok.add(run),
    command: async ({ run, dir }) => {
      ran.push({ run, ...(dir ? { dir } : {}) });
      const res = results[run] ?? { exit: 0 };
      return { exitCode: res.exit, output: res.output ?? '', timedOut: false, durationMs: 1 };
    },
    missing: async (patterns) => patterns.filter((p) => !p.startsWith('src/')),
  };
  return { r, ran, ok };
}

function rig(scripts: Scripts, o: { supervise?: (q: SupervisorReview) => Promise<SupervisorVerdict>; runner?: CheckRunner; evidence?: EvidenceSource; stopAt?: 'high' | 'medium' | 'never'; agentChecks?: StepCheck[]; verifyRun?: (r: RunVerification) => Promise<{ met: boolean; missing: string }>; unverified?: 'warn' | 'fail'; adapter?: AgentAdapter; answer?: (e: Extract<RunEvent, { type: 'agent.question' }>) => string | undefined } = {}) {
  const agents = new MockAgent(scripts);
  const reviews: SupervisorReview[] = [];
  const decider = new MockDecider({
    ...(o.supervise ? { supervise: (q) => (reviews.push(q), o.supervise!(q)) } : {}),
    ...(o.verifyRun ? { verifyRun: (r) => o.verifyRun!(r) } : {}),
  });
  const orch = new Orchestrator({
    getAdapter: () => o.adapter ?? agents,
    decider,
    supervisor: { review: () => true, ...(o.stopAt ? { stopAt: () => o.stopAt! } : {}), ...(o.unverified ? { unverified: () => o.unverified! } : {}) },
    checks: { ...(o.runner ? { runner: o.runner } : {}), ...(o.evidence ? { evidence: o.evidence } : {}), ...(o.agentChecks ? { agentChecks: async () => o.agentChecks } : {}) },
  });
  const go = (d: Parameters<Orchestrator['start']>[0]) => {
    const h = orch.start(d, 'Pedido');
    const asked: Extract<RunEvent, { type: 'agent.question' }>[] = [];
    h.bus.subscribe((e) => {
      if (e.type !== 'agent.question') return;
      asked.push(e);
      const a = o.answer?.(e);
      if (a !== undefined) setTimeout(() => h.answer(e.questionId, a), 0);
    });
    return h.result.then((r) => ({ ...r, asked, handle: h }));
  };
  return { agents, reviews, go };
}

const withChecks = (checks: StepCheck[], more: Record<string, unknown> = {}) => diagram([ENTRY, { ...agent('a'), checks, ...more }, OUTPUT], [edge('entry', 'a'), edge('a', 'output')]);

describe('SPEC-075 · comprobaciones deterministas', () => {
  it('[R75.1] cuatro tipos, cada uno con lo suyo; lo mal escrito se dice', () => {
    expect(checkProblems([cmd('t', 'npm test'), { id: 'f', label: 'Docs', kind: 'files', mustExist: ['docs/*.md'] }, { id: 'o', label: 'Sin TODO', kind: 'output', notContains: 'TODO' }, { id: 's', label: 'JSON', kind: 'schema', schema: '{"type":"object"}' }])).toEqual([]);
    expect(checkProblems([{ id: 't', label: 'x', kind: 'command', run: ' ' }])).toEqual(['«x»: falta el comando']);
    expect(checkProblems([{ id: 'f', label: 'x', kind: 'files', mustExist: ['/etc/passwd'] }])[0]).toContain('relativas');
    expect(checkProblems([{ id: 'o', label: 'x', kind: 'output', matches: '(' }])[0]).toContain('expresión regular');
    expect(checkProblems([cmd('a', 'x'), cmd('a', 'y')])).toContain('Comprobación repetida: a');
    const d = diagram([ENTRY, { id: 'r', kind: 'router', label: 'r', router: { mode: 'ai' }, checks: [cmd('t', 'x')] } as never, OUTPUT], [edge('entry', 'r'), edge('r', 'output')]);
    expect(validateDiagram(d).map((i) => i.code)).toContain('node-checks-not-agent');
  });

  it('[R75.2] las de la ficha valen en todos sus pasos y las del paso se suman (manda el paso si se repite el id)', () => {
    expect(mergeChecks([cmd('t', 'npm test'), cmd('l', 'npm run lint')], [cmd('l', 'eslint .'), cmd('b', 'npm run build')]).map((c) => `${c.id}:${(c as { run: string }).run}`)).toEqual(['t:npm test', 'l:eslint .', 'b:npm run build']);
  });

  it('[R75.3][R75.4] al acabar bien se ejecutan antes de la revisión, cada una con su check.result, sin secretos', async () => {
    const { r, ran } = runner({ 'npm test': { exit: 0, output: `ok ${'x'.repeat(3000)} ANTHROPIC_API_KEY=sk-ant-abcdefghijklmnopqrstuvwx` } });
    const { go, reviews } = rig({ a: { output: 'hecho' } }, { runner: r, supervise: async () => OK, agentChecks: [cmd('t', 'npm test')] });
    const { events } = await go(withChecks([{ id: 'o', label: 'Dice hecho', kind: 'output', contains: 'hecho' }]));
    const results = ofType(events, 'check.result');
    expect(results.map((e) => [e.checkId, e.ok])).toEqual([['t', true], ['o', true]]);
    expect(results[0]!.detail.length).toBeLessThanOrEqual(2000);
    expect(results[0]!.detail).not.toContain('sk-ant-abcdefghijklmnop');
    expect(ran).toEqual([{ run: 'npm test' }]);
    expect(results.at(-1)!.seq).toBeLessThan(ofType(events, 'supervisor.reviewing')[0]!.seq);
    expect(reviews[0]!.evidence!.checks).toEqual([expect.objectContaining({ label: 'Comprobación t', ok: true }), expect.objectContaining({ label: 'Dice hecho', ok: true })]);
    expect(ofType(events, 'agent.usage')).toEqual([]);
  });

  it('[R75.5] E75.a: si falla, el paso se repite solo una vez con lo que falló; si sigue, se pregunta', async () => {
    const { r } = runner({ 'npm test': { exit: 1, output: '1 test rojo' } });
    const { go, agents } = rig({ a: { output: 'todo hecho' } }, { runner: r, answer: () => UNFINISHED_CONTINUE });
    const { asked, events } = await go(withChecks([cmd('t', 'npm test')]));
    expect(agents.callsOf('a')).toHaveLength(2);
    expect(agents.callsOf('a')[1]!.input.text).toContain('1 test rojo');
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ kind: 'unfinished' });
    expect(asked[0]!.text).toContain('Fallan las comprobaciones');
    expect(ofType(events, 'check.result').map((e) => e.ok)).toEqual([false, false]);
  });

  it('[R75.6] E75.d: un comando sin aprobar se enseña antes; no ejecutarlo cuenta como fallo «sin aprobar»', async () => {
    const yes = runner({ 'rm -rf build && make': { exit: 0 } }, []);
    const a = rig({ a: {} }, { runner: yes.r, answer: (e) => (e.kind === 'permission' ? CHECK_RUN : undefined) });
    const r1 = await a.go(withChecks([cmd('m', 'rm -rf build && make')]));
    expect(r1.asked[0]!.text).toContain('rm -rf build && make');
    expect(r1.asked[0]!.options).toEqual([CHECK_RUN, CHECK_SKIP]);
    expect(yes.ok.has('rm -rf build && make')).toBe(true);
    expect(yes.ran).toHaveLength(1);
    const no = runner({ 'make': { exit: 0 } }, []);
    const b = rig({ a: {} }, { runner: no.r, answer: (e) => (e.kind === 'permission' ? CHECK_SKIP : UNFINISHED_CONTINUE) });
    const r2 = await b.go(withChecks([cmd('m', 'make')]));
    expect(no.ran).toHaveLength(0);
    expect(ofType(r2.events, 'check.result')[0]).toMatchObject({ ok: false, detail: 'sin aprobar' });
  });
});

describe('SPEC-075 · evidencia y gravedad', () => {
  const evidence: EvidenceSource = { diff: async ({ files }) => ({ diff: files.map((f) => `+++ b/${f.path}`).join('\n'), lines: files.map((f) => ({ path: f.path, added: 3, removed: 1 })) }) };

  it('[R75.7] la revisión recibe el diff, las comprobaciones, los errores de herramientas y el recuento', async () => {
    const { go, reviews } = rig({ a: { output: 'hecho', files: ['src/a.ts'], tools: [{ tool: 'Bash', ok: false, output: 'no existe' }] } }, { supervise: async () => OK, evidence });
    await go(chain(['a']));
    const e = reviews[0]!.evidence!;
    expect(e.diff).toBe('+++ b/src/a.ts');
    expect(e.toolErrors).toEqual({ count: 1, last: ['Bash: no existe'] });
    expect(e.stats.created + e.stats.modified).toBe(1);
  });

  it('[R75.9] un «no» sin evidencia citada cuenta como leve y no para', async () => {
    const { go } = rig({ a: {} }, { supervise: async () => ({ ok: false, reason: 'no me gusta', summary: 's', severity: 'high', problems: [{ text: 'mal', evidence: '' }] }) });
    const { asked, events } = await go(chain(['a']));
    expect(asked).toEqual([]);
    expect(ofType(events, 'supervisor.alert').map((a) => [a.rule, a.gravity])).toEqual([['unsupported-verdict', undefined], ['ai-review', 'low']]);
  });

  it('[R75.10] E75.b/E75.c: lo grave con evidencia para y pregunta; lo leve solo avisa; el umbral se ajusta', async () => {
    const grave: SupervisorVerdict = { ok: false, reason: 'No añadió la documentación', summary: 's', severity: 'high', problems: [{ text: 'Sin docs', evidence: 'ningún archivo .md en el diff' }] };
    const medium: SupervisorVerdict = { ...grave, severity: 'medium' };
    const r1 = await rig({ a: {} }, { supervise: async () => grave, answer: () => UNFINISHED_CONTINUE }).go(chain(['a']));
    expect(r1.asked).toHaveLength(1);
    expect(ofType(r1.events, 'supervisor.alert')[0]).toMatchObject({ rule: 'ai-review', gravity: 'high', evidence: ['Sin docs — ningún archivo .md en el diff'] });
    const r2 = await rig({ a: {} }, { supervise: async () => medium }).go(chain(['a']));
    expect(r2.asked).toEqual([]);
    expect(ofType(r2.events, 'supervisor.alert')[0]).toMatchObject({ rule: 'ai-review', gravity: 'medium' });
    const r3 = await rig({ a: {} }, { supervise: async () => medium, stopAt: 'medium', answer: () => UNFINISHED_CONTINUE }).go(chain(['a']));
    expect(r3.asked).toHaveLength(1);
    const r4 = await rig({ a: {} }, { supervise: async () => grave, stopAt: 'never' }).go(chain(['a']));
    expect(r4.asked).toEqual([]);
  });

  it('[R75.11] «Revisar con IA»: nunca, o solo si es final o tiene comprobaciones; las comprobaciones van igual', async () => {
    const never = rig({ a: {} }, { supervise: async () => OK });
    await never.go(withChecks([], { aiReview: 'never' }));
    expect(never.reviews).toHaveLength(0);
    const d = diagram([ENTRY, { ...agent('a'), aiReview: 'final-or-checks' }, { ...agent('b'), aiReview: 'final-or-checks', checks: [{ id: 'o', label: 'o', kind: 'output', contains: '' }] } as never, OUTPUT], [edge('entry', 'a'), edge('a', 'b'), edge('b', 'output')]);
    const some = rig({ a: {}, b: { output: 'x' } }, { supervise: async () => OK });
    await some.go({ ...d, nodes: d.nodes.map((n) => (n.id === 'b' ? { ...n, checks: [{ id: 'o', label: 'o', kind: 'output', notContains: 'zzz' }] } : n)) } as never);
    expect(some.reviews.map((r) => r.step)).toEqual(['b']);
  });

  it('[R75.12] los pasos que fallan no se revisan con IA', async () => {
    const { go, reviews } = rig({ a: { failTimes: 9, failRetriable: false } }, { supervise: async () => OK });
    await go(chain(['a']));
    expect(reviews).toHaveLength(0);
  });
});

describe('SPEC-075 · verificador', () => {
  const verifierSays = (text: string, more: Partial<{ cost: number; writes: string[] }> = {}): AgentAdapter => ({
    async *run(req) {
      if (req.agentId === 'verificador') {
        if (more.cost) yield { type: 'usage', inputTokens: 100, outputTokens: 10, costUsd: more.cost };
        for (const f of more.writes ?? []) yield { type: 'file', path: f, change: 'created', via: 'command' };
        yield { type: 'result', text };
        return;
      }
      yield { type: 'result', text: 'hecho' };
    },
  });

  it('[R75.15] lee «## Verificación»: resultado y un hallazgo por línea con su gravedad', () => {
    expect(parseVerification('blabla\n## Verificación\nResultado: no cumple\n- [grave] src/a.ts:12 — el test falla\n- [leve] README.md — falta un ejemplo')).toEqual({ met: false, findings: [{ severity: 'high', where: 'src/a.ts:12', what: 'el test falla' }, { severity: 'low', where: 'README.md', what: 'falta un ejemplo' }] });
    expect(parseVerification('## Verificación\nResultado: cumple')).toEqual({ met: true, findings: [] });
    expect(parseVerification('sin sección')).toBeUndefined();
  });

  it('[R75.13][R75.14][R75.15] E75.e: corre tras las comprobaciones, no edita, su gasto cuenta y un «no cumple» grave para', async () => {
    const adapter = verifierSays('## Verificación\nResultado: no cumple\n- [grave] npm test — 2 tests rojos', { cost: 0.05, writes: ['coverage/x.json'] });
    const calls: { agentId: string; verify?: boolean }[] = [];
    const spy: AgentAdapter = { run: (req, s) => (calls.push({ agentId: req.agentId, ...(req.verify ? { verify: true } : {}) }), adapter.run(req, s)) };
    const { go } = rig({}, { adapter: spy, supervise: async () => OK, answer: () => UNFINISHED_CONTINUE });
    const { events, asked, usage } = await go(withChecks([], { verify: {} }));
    expect(calls).toEqual([{ agentId: 'a' }, { agentId: 'verificador', verify: true }]);
    expect(ofType(events, 'agent.request').find((e) => e.kind === 'verify')).toMatchObject({ nodeId: 'a', agentId: 'verificador' });
    expect(ofType(events, 'verify.result')[0]).toMatchObject({ met: false, findings: [{ severity: 'high', where: 'npm test' }] });
    expect(ofType(events, 'supervisor.alert').map((a) => a.rule)).toEqual(expect.arrayContaining(['verifier-wrote', 'ai-review']));
    expect(asked).toHaveLength(1);
    expect(usage.costUsd).toBeCloseTo(0.05);
  });

  it('[R75.13] se corta al llegar a su presupuesto', async () => {
    const { go } = rig({}, { adapter: verifierSays('## Verificación\nResultado: cumple', { cost: 1 }), supervise: async () => OK });
    const { events } = await go(withChecks([], { verify: { maxCostUsd: 0.5 } }));
    expect(ofType(events, 'supervisor.alert').find((a) => a.rule === 'unverified-step')!.detail).toContain('presupuesto');
  });
});

describe('SPEC-075 · comprobación final', () => {
  it('[R75.17] las del diagrama van antes que la IA: si fallan, la ejecución no cumple y no se consulta', async () => {
    const { r } = runner({ 'npm run e2e': { exit: 2, output: 'falló el login' } });
    let asked = 0;
    const { go } = rig({ a: {} }, { runner: r, supervise: async () => OK, verifyRun: async () => (asked++, { met: true, missing: '' }) });
    const res = await go({ ...chain(['a']), checks: [cmd('e', 'npm run e2e')] });
    expect(res.status).toBe('failed');
    expect(res.reason).toContain('falló «Comprobación e»');
    expect(asked).toBe(0);
  });

  it('[R75.18] verifyRun recibe archivos con sus líneas, comprobaciones y la gravedad de cada paso', async () => {
    const seen: RunVerification[] = [];
    const evidence: EvidenceSource = { diff: async ({ files }) => ({ diff: '', lines: files.map((f) => ({ path: f.path, added: 5, removed: 2 })) }) };
    const { r } = runner({ 'npm test': { exit: 0 } });
    const { go } = rig({ a: { files: ['a.ts'] } }, { runner: r, evidence, supervise: async () => ({ ...OK, ok: false, severity: 'low', problems: [{ text: 'estilo', evidence: 'a.ts:1' }] }), verifyRun: async (q) => (seen.push(q), { met: true, missing: '' }) });
    await go({ ...chain(['a']), checks: [cmd('t', 'npm test')] });
    expect(seen[0]).toMatchObject({ files: [{ path: 'a.ts', added: 5, removed: 2 }], checks: [{ label: 'Comprobación t', ok: true }], reviews: [{ step: 'a', severity: 'low', problems: ['estilo'] }] });
  });

  it('[R75.20] si no se puede comprobar el resultado: avisar por defecto o hacer fallar', async () => {
    const broken = async () => Promise.reject(new Error('sin red'));
    const warn = await rig({ a: {} }, { supervise: async () => OK, verifyRun: broken }).go(chain(['a']));
    expect(warn.status).toBe('succeeded');
    const fail = await rig({ a: {} }, { supervise: async () => OK, verifyRun: broken, unverified: 'fail' }).go(chain(['a']));
    expect(fail.status).toBe('failed');
  });
});

describe('SPEC-075 · calibración', () => {
  it('[R75.21] marcar un aviso emite supervisor.feedback, y un falso aviso deja de estar abierto en la memoria', async () => {
    const { go } = rig({ a: {}, b: {} }, { supervise: async (q) => (q.step === 'a' ? { ok: true, reason: '', summary: 's', outOfScope: 'Borró el README' } : OK) });
    const d = chain(['a']);
    const res = await go(d);
    const alert = ofType(res.events, 'supervisor.alert').find((a) => a.rule === 'out-of-scope')!;
    // Con la ejecución terminada, el aviso se marca en su registro (lo hace el servicio); en vivo, el manejador.
    expect(res.handle.feedback(alert.seq, 'false-alarm', 'era a propósito')).toBe(true);
    const fb = ofType(res.handle.bus.history(), 'supervisor.feedback');
    expect(fb).toMatchObject([{ alertSeq: alert.seq, verdict: 'false-alarm', note: 'era a propósito', nodeId: 'a' }]);
    expect(res.handle.feedback(99999, 'confirmed')).toBe(false);
  });

  it('[R75.22] por regla: avisos, falsos y acertados (vale la última opinión)', () => {
    let seq = 0;
    const ev = (b: Record<string, unknown>) => ({ runId: 'r', seq: ++seq, ts: 't', ...b }) as unknown as RunEvent;
    const a1 = ev({ type: 'supervisor.alert', rule: 'ai-review', severity: 'warning', detail: 'x', nodeId: 'a' });
    const a2 = ev({ type: 'supervisor.alert', rule: 'ai-review', severity: 'warning', detail: 'y', nodeId: 'b' });
    const a3 = ev({ type: 'supervisor.alert', rule: 'out-of-scope', severity: 'warning', detail: 'z', nodeId: 'b' });
    const run = [a1, a2, a3, ev({ type: 'supervisor.feedback', alertSeq: a1.seq, verdict: 'confirmed' }), ev({ type: 'supervisor.feedback', alertSeq: a1.seq, verdict: 'false-alarm' }), ev({ type: 'supervisor.feedback', alertSeq: a3.seq, verdict: 'confirmed' })];
    expect(feedbackStats([run])).toEqual([
      { rule: 'ai-review', alerts: 2, falseAlarms: 1, confirmed: 0 },
      { rule: 'out-of-scope', alerts: 1, falseAlarms: 0, confirmed: 1 },
    ]);
  });

  it('[R75.23] cada aviso marcado es un caso: la regla, lo que vio la revisión sin secretos y lo que dijo la persona', () => {
    let seq = 0;
    const ev = (b: Record<string, unknown>) => ({ runId: 'r', seq: ++seq, ts: 't', ...b }) as unknown as RunEvent;
    const events = [
      ev({ type: 'agent.request', nodeId: 'a', agentId: 'a', attempt: 1, input: { text: 'clave sk-ant-abcdefghijklmnopqrstuvwx', files: [] } }),
      ev({ type: 'node.finished', nodeId: 'a', status: 'succeeded', output: { text: 'hecho', files: ['a.md'] } }),
      ev({ type: 'supervisor.alert', nodeId: 'a', rule: 'ai-review', severity: 'warning', detail: 'faltan docs', gravity: 'high', evidence: ['sin .md'] }),
    ];
    const c = supervisorCase(events, 3, 'false-alarm', 'sí había docs', '2026-11-08T10:00:00Z')!;
    expect(c).toMatchObject({ rule: 'ai-review', gravity: 'high', evidence: ['sin .md'], step: { output: 'hecho', files: ['a.md'] }, person: { verdict: 'false-alarm', note: 'sí había docs' } });
    expect(c.step!.input).not.toContain('sk-ant-abcdefghijklmnop');
    expect(caseAgrees(c, { ok: true })).toBe(true);
    expect(caseAgrees(c, { ok: false, severity: 'high' })).toBe(false);
    expect(caseAgrees({ person: { verdict: 'confirmed' } }, { ok: false, severity: 'low' })).toBe(true);
  });
});
