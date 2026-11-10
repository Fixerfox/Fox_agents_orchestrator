import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ROOT } from './architecture';

type Rule = { type: string; parameters?: Record<string, unknown> };
type Ruleset = { name: string; enforcement: string; bypass_actors: { actor_id: number; actor_type: string; bypass_mode: string }[]; conditions: { ref_name: { include: string[] } }; rules: Rule[] };
type Check = (pr: { base: string; head: string; sameRepo: boolean }) => string | null;

const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const ruleset = (name: string) => JSON.parse(read(`.github/rulesets/${name}.json`)) as Ruleset;
const { branchFlowProblem } = (await import(pathToFileURL(join(ROOT, 'scripts/branch-flow.mjs')).href)) as { branchFlowProblem: Check };
const PROTECTED = ['refs/heads/main', 'refs/heads/develop'];

describe('SPEC-094 · seguridad del repositorio', () => {
  it('[R94.1] CODEOWNERS asigna todo a @Fixerfox y solo a él', () => {
    const lines = read('.github/CODEOWNERS').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    expect(lines).toEqual(['* @Fixerfox']);
  });

  it('[R94.2] a develop se llega desde cualquier rama, también desde un fork', () => {
    for (const head of ['feature/x', 'fix/y', 'main']) expect(branchFlowProblem({ base: 'develop', head, sameRepo: true })).toBeNull();
    expect(branchFlowProblem({ base: 'develop', head: 'feature/x', sameRepo: false })).toBeNull();
  });

  it('[R94.3] a main solo desde develop del propio repo, y el rechazo dice por qué', () => {
    expect(branchFlowProblem({ base: 'main', head: 'develop', sameRepo: true })).toBeNull();
    expect(branchFlowProblem({ base: 'main', head: 'feature/x', sameRepo: true })).toContain('A main solo se llega desde develop');
    expect(branchFlowProblem({ base: 'main', head: 'develop', sameRepo: false })).toContain('de un fork');
  });

  it('[R94.4] un PR a otra rama falla y dice que los PR van a develop', () => {
    expect(branchFlowProblem({ base: 'feature/x', head: 'fix/y', sameRepo: true })).toContain('Los PR van a develop');
  });

  it('[R94.5] el workflow usa pull_request_target, no descarga el PR y no interpola ramas en el script', () => {
    const wf = read('.github/workflows/branch-flow.yml');
    expect(wf).toMatch(/^on:\s*\n\s+pull_request_target:/m);
    expect(wf).not.toMatch(/^\s+pull_request:/m);
    expect(wf).not.toMatch(/ref:\s*\$\{\{\s*github\.event\.pull_request/);
    expect(wf).toMatch(/^\s+flujo-de-ramas:\s*$/m);
    const runs = [...wf.matchAll(/^\s+- run: (.*)$/gm)].map((m) => m[1]);
    expect(runs).toEqual(['node scripts/branch-flow.mjs']);
  });

  it('[R94.6] main y develop no se borran ni reciben force-push, sin excepciones', () => {
    const r = ruleset('ramas-protegidas');
    expect(r.enforcement).toBe('active');
    expect(r.conditions.ref_name.include).toEqual(PROTECTED);
    expect(r.rules.map((x) => x.type).sort()).toEqual(['deletion', 'non_fast_forward']);
    expect(r.bypass_actors).toEqual([]);
  });

  it('[R94.7] main y develop exigen la comprobación flujo-de-ramas de Actions, sin excepciones', () => {
    const r = ruleset('flujo-de-ramas');
    expect(r.enforcement).toBe('active');
    expect(r.conditions.ref_name.include).toEqual(PROTECTED);
    expect(r.rules[0]?.parameters?.required_status_checks).toEqual([{ context: 'flujo-de-ramas', integration_id: 15368 }]);
    expect(r.bypass_actors).toEqual([]);
  });

  it('[R94.8] todo entra por PR aprobado por el dueño; solo el admin lo salta y solo con PR', () => {
    const r = ruleset('revision-del-dueno');
    expect(r.enforcement).toBe('active');
    expect(r.conditions.ref_name.include).toEqual(PROTECTED);
    expect(r.rules[0]).toMatchObject({ type: 'pull_request', parameters: { required_approving_review_count: 1, require_code_owner_review: true, dismiss_stale_reviews_on_push: true } });
    expect(r.bypass_actors).toEqual([{ actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'pull_request' }]);
  });

  it('[R94.9] licencia MIT en LICENSE y en package.json', () => {
    expect(read('LICENSE')).toMatch(/^MIT License/);
    expect(JSON.parse(read('package.json')).license).toBe('MIT');
  });
});
