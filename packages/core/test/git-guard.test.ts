import { describe, expect, it } from 'vitest';
import { FROM_HERE, PROTECTED_BRANCHES, branchGuard, branchRule, defaultChoice, guardBases, guardNotices, hardBlock, suggestBranchName, validBranchName, validateDiagram, type GitState, type GuardVerdict } from '../src';
import { ENTRY, OUTPUT, agent, chain, diagram, edge, fan, router, setup } from './helpers';

const repo = (more: Partial<GitState> = {}): GitState => ({ repo: true, branch: 'feature/x', commit: 'abc1234', dirty: 0, branches: ['main', 'develop', 'feature/x'], ...more });
const ctx = { otherRuns: 0, explicit: true, label: 'Mi flujo' };
const NOW = new Date(2026, 10, 11, 9, 5);
const problem = (v: GuardVerdict | undefined) => (v && !v.ok ? v.problem.code : undefined);

describe('SPEC-097 · decidir la rama de una ejecución', () => {
  it('[R97.3][R97.7] seguir en la rama no prepara nada; una rama nueva desde aquí solo se crea', () => {
    expect(branchGuard(repo(), { mode: 'stay' }, ctx)).toEqual({ ok: true, plan: { branch: 'feature/x' } });
    expect(branchGuard(repo({ dirty: 3 }), { mode: 'new', name: 'orq/a', from: FROM_HERE }, ctx)).toEqual({ ok: true, plan: { create: { name: 'orq/a' }, branch: 'orq/a' } });
    // Partir de la propia rama es partir de aquí.
    expect(branchGuard(repo({ dirty: 3 }), { mode: 'new', name: 'orq/a', from: 'feature/x' }, ctx)).toEqual({ ok: true, plan: { create: { name: 'orq/a' }, branch: 'orq/a' } });
  });

  it('[R97.4] las protegidas son main, master, develop y trunk: por defecto se sale de ellas, y quedarse hay que elegirlo', () => {
    expect([...PROTECTED_BRANCHES]).toEqual(['main', 'master', 'develop', 'trunk']);
    expect(defaultChoice(repo(), 'Mi flujo', NOW)).toEqual({ mode: 'stay' });
    expect(defaultChoice(repo({ branch: 'develop' }), 'Mi flujo', NOW)).toEqual({ mode: 'new', name: 'orq/mi-flujo-20261111-0905', from: FROM_HERE });
    expect(problem(branchGuard(repo({ branch: 'main' }), { mode: 'stay' }, { ...ctx, explicit: false }))).toBe('protected');
    expect(branchGuard(repo({ branch: 'main' }), { mode: 'stay' }, ctx)).toEqual({ ok: true, plan: { branch: 'main' } });
    expect(guardBases(repo())).toEqual(['main', 'develop']);
    expect(guardBases(repo({ branch: 'main' }))).toEqual(['develop']);
  });

  it('[R97.5] el nombre propuesto sale del diagrama y la fecha, sin acentos ni símbolos, y no repite', () => {
    expect(suggestBranchName('Spec Kit: de la idea al código', NOW)).toBe('orq/spec-kit-de-la-idea-al-codigo-20261111-0905');
    expect(suggestBranchName('¿?', NOW)).toBe('orq/ejecucion-20261111-0905');
    expect(suggestBranchName('a', NOW, ['orq/a-20261111-0905', 'orq/a-20261111-0905-2'])).toBe('orq/a-20261111-0905-3');
    expect(validBranchName(suggestBranchName('x'.repeat(200), NOW))).toBe(true);
    for (const ok of ['feature/x', 'orq/a-1', 'fix_2', 'v1.2']) expect(validBranchName(ok)).toBe(true);
    for (const bad of ['', 'HEAD', '-x', 'a b', 'a..b', 'a~1', 'a:b', 'a?', 'a*', 'a[', 'a\\b', '/a', 'a/', 'a//b', 'a.lock', '.a', 'a.', 'a@{b', 'a\tb']) expect(validBranchName(bad)).toBe(false);
  });

  it('[R97.6] HEAD suelto, una operación a medias o un repositorio sin commits impiden lanzar; sin repositorio no se decide nada', () => {
    expect(branchGuard({ repo: false, dirty: 0, branches: [] }, { mode: 'stay' }, ctx)).toBeUndefined();
    expect(hardBlock({ repo: false, dirty: 0, branches: [] })).toBeUndefined();
    const { branch: _b, ...detached } = repo();
    void _b;
    expect(problem(branchGuard(detached, { mode: 'stay' }, ctx))).toBe('detached');
    expect(problem(branchGuard(repo({ busy: 'rebase' }), { mode: 'stay' }, ctx))).toBe('busy');
    expect(hardBlock(repo({ busy: 'merge' }))?.message).toMatch(/una fusión a medias/);
    const { commit: _c, ...empty } = repo();
    void _c;
    expect(problem(branchGuard(empty, { mode: 'new', name: 'orq/a', from: FROM_HERE }, ctx))).toBe('no-commits');
    expect(hardBlock(repo())).toBeUndefined();
  });

  it('[R97.7] una rama nueva se rechaza con otra ejecución en marcha, mal nombre, nombre repetido, base que no existe o cambios sin decidir', () => {
    const fresh = { mode: 'new' as const, name: 'orq/a', from: FROM_HERE };
    expect(problem(branchGuard(repo(), fresh, { ...ctx, otherRuns: 1 }))).toBe('other-runs');
    expect(branchGuard(repo(), { mode: 'stay' }, { ...ctx, otherRuns: 1 })).toMatchObject({ ok: true });
    expect(problem(branchGuard(repo(), { ...fresh, name: 'mal nombre' }, ctx))).toBe('bad-name');
    expect(problem(branchGuard(repo(), { ...fresh, name: 'develop' }, ctx))).toBe('name-taken');
    expect(problem(branchGuard(repo(), { ...fresh, from: 'no-existe' }, ctx))).toBe('bad-base');
    expect(problem(branchGuard(repo({ dirty: 2 }), { ...fresh, from: 'develop' }, ctx))).toBe('changes-undecided');
    // Con otra base: llevarlos no aparta nada; apartarlos pone la etiqueta de la ejecución.
    expect(branchGuard(repo({ dirty: 2 }), { ...fresh, from: 'develop', changes: 'carry' }, ctx)).toEqual({ ok: true, plan: { create: { name: 'orq/a', from: 'develop' }, branch: 'orq/a' } });
    expect(branchGuard(repo({ dirty: 2 }), { ...fresh, from: 'develop', changes: 'stash' }, ctx)).toEqual({ ok: true, plan: { stash: 'orquestador: Mi flujo', create: { name: 'orq/a', from: 'develop' }, branch: 'orq/a' } });
    // Sin cambios no hay nada que decidir ni que apartar.
    expect(branchGuard(repo(), { ...fresh, from: 'develop', changes: 'stash' }, ctx)).toEqual({ ok: true, plan: { create: { name: 'orq/a', from: 'develop' }, branch: 'orq/a' } });
  });

  it('[R97.8] avisa de los cambios sin commit y del retraso con la remota, sin impedir lanzar', () => {
    expect(guardNotices(repo(), { mode: 'stay' })).toEqual([]);
    expect(guardNotices(repo({ dirty: 3, behind: 2 }), { mode: 'stay' })).toEqual(['Hay 3 archivo(s) con cambios sin commit: la ejecución trabajará sobre ellos.', 'Tu rama va 2 commit(s) por detrás de la remota.']);
    expect(guardNotices(repo({ dirty: 3 }), { mode: 'new', name: 'orq/a', from: 'develop', changes: 'stash' })).toEqual([]);
    expect(guardNotices(repo({ dirty: 3, busy: 'merge' }), { mode: 'stay' })).toEqual([]);
    expect(branchGuard(repo({ dirty: 3, behind: 2 }), { mode: 'stay' }, ctx)).toMatchObject({ ok: true });
  });
});

describe('SPEC-097 · la rama en la ejecución', () => {
  const git = { branch: 'orq/a', commit: 'abc1234', created: true, from: 'main' };

  it('[R97.11] run.git va justo después de run.started con el punto de partida; sin git no se emite', async () => {
    const { orch } = setup();
    const run = orch.start(chain(['a']), 'x', { git });
    await run.result;
    const events = run.bus.history();
    expect(events[0]!.type).toBe('run.started');
    expect(events[1]).toMatchObject({ type: 'run.git', branch: 'orq/a', commit: 'abc1234', created: true, from: 'main' });
    const plain = setup().orch.start(chain(['a']), 'x');
    await plain.result;
    expect(plain.bus.history().some((e) => e.type === 'run.git')).toBe(false);
  });

  it('[R97.12] cada paso de agente recibe la regla con la rama, y queda en agent.request; sin git no hay regla', async () => {
    const { orch, agents } = setup();
    const run = orch.start(fan(['a', 'b']), 'x', { git });
    await run.result;
    expect(agents.calls.map((c) => c.git)).toEqual([branchRule('orq/a'), branchRule('orq/a')]);
    expect(branchRule('orq/a')).toContain('`orq/a`');
    expect(branchRule('orq/a')).toMatch(/No crees otra rama ni cambies de rama/);
    const requests = run.bus.history().filter((e) => e.type === 'agent.request');
    expect(requests.every((e) => e.git === branchRule('orq/a'))).toBe(true);
    const plain = setup();
    await plain.orch.start(chain(['a']), 'x').result;
    expect(plain.agents.calls[0]!.git).toBeUndefined();
  });

  it('[R97.13] un paso que gestiona ramas no recibe la regla; fuera de un agente es un error de validación', async () => {
    const d = diagram([ENTRY, agent('a'), { ...agent('pr'), ownsBranch: true }, OUTPUT], [edge('entry', 'a'), edge('a', 'pr'), edge('pr', 'output')]);
    expect(validateDiagram(d)).toEqual([]);
    const { orch, agents } = setup({ scripts: { pr: { branches: [{ branch: 'release/1', via: 'command', created: true }] } } });
    const run = orch.start(d, 'x', { git });
    await run.result;
    expect(agents.callsOf('a')[0]!.git).toBe(branchRule('orq/a'));
    expect(agents.callsOf('pr')[0]!.git).toBeUndefined();
    expect(run.bus.history().some((e) => e.type === 'supervisor.alert' && e.rule === 'branch-drift')).toBe(false);
    const bad = diagram([ENTRY, { ...router('r', 'rules'), ownsBranch: true }, OUTPUT], [edge('entry', 'r'), edge('r', 'output')]);
    expect(validateDiagram(bad).map((i) => i.code)).toContain('node-ownsbranch-not-agent');
  });

  it('[R97.13] si el paso que gestiona ramas se cambia a otra, los siguientes reciben la regla con esa', async () => {
    const d = diagram([ENTRY, { ...agent('prep'), ownsBranch: true }, agent('a'), OUTPUT], [edge('entry', 'prep'), edge('prep', 'a'), edge('a', 'output')]);
    const { orch, agents } = setup({ scripts: { prep: { branches: [{ branch: '001-naves', via: 'command', created: true }, { branch: '001-naves', via: 'head' }] }, a: { branches: [{ branch: '001-naves', via: 'ran' }] } } });
    const run = orch.start(d, 'x', { git });
    await run.result;
    expect(agents.callsOf('a')[0]!.git).toBe(branchRule('001-naves'));
    expect(run.bus.history().some((e) => e.type === 'supervisor.alert' && e.rule === 'branch-drift')).toBe(false);
  });

  it('[R97.14] crear otra rama o cambiarse a otra da el aviso branch-drift, una vez por rama; trabajar en la acordada no', async () => {
    const { orch } = setup({
      scripts: {
        a: {
          branches: [
            { branch: 'orq/a', via: 'ran' },
            { branch: 'otra', via: 'command', created: true },
            { branch: 'otra', via: 'head' },
            { branch: 'main', via: 'head' },
            { branch: 'leida', via: 'mcp' },
          ],
        },
      },
    });
    const run = orch.start(chain(['a']), 'x', { git });
    await run.result;
    const alerts = run.bus.history().filter((e) => e.type === 'supervisor.alert' && e.rule === 'branch-drift');
    expect(alerts.map((e) => (e.type === 'supervisor.alert' ? e.detail : ''))).toEqual(['Creó la rama otra; la ejecución trabaja en orq/a.', 'Se cambió a la rama main; la ejecución trabaja en orq/a.']);
    // Sin rama acordada no hay nada de lo que salirse.
    const plain = setup({ scripts: { a: { branches: [{ branch: 'otra', via: 'command', created: true }] } } });
    const free = plain.orch.start(chain(['a']), 'x');
    await free.result;
    expect(free.bus.history().some((e) => e.type === 'supervisor.alert' && e.rule === 'branch-drift')).toBe(false);
  });
});
