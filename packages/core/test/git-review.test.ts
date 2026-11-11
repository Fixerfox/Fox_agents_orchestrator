import { describe, expect, it } from 'vitest';
import { defaultReviewBase, parseRemoteUrl, reviewDraftProblem, reviewUrl, reviewWord, summarizeChecks, type ReviewInfo } from '../src';

describe('SPEC-099 · dónde está el repositorio', () => {
  it('[R99.1] lee origin en HTTPS, SSH corto y ssh://, con o sin .git y sin credenciales', () => {
    const gh = { provider: 'github', host: 'github.com', path: 'Fixerfox/Fox_orchestrator', name: 'Fox_orchestrator' };
    for (const url of ['https://github.com/Fixerfox/Fox_orchestrator.git', 'https://github.com/Fixerfox/Fox_orchestrator', 'git@github.com:Fixerfox/Fox_orchestrator.git', 'ssh://git@github.com/Fixerfox/Fox_orchestrator.git', 'https://usuario:ghp_secreto@github.com/Fixerfox/Fox_orchestrator.git/', '  https://github.com/Fixerfox/Fox_orchestrator  ']) {
      expect(parseRemoteUrl(url), url).toEqual(gh);
    }
    expect(JSON.stringify(parseRemoteUrl('https://usuario:ghp_secreto@github.com/a/b.git'))).not.toContain('ghp_secreto');
    // GitLab admite subgrupos y servidores propios; el puerto de SSH no es el de la web.
    expect(parseRemoteUrl('git@gitlab.com:grupo/sub/proyecto.git')).toEqual({ provider: 'gitlab', host: 'gitlab.com', path: 'grupo/sub/proyecto', name: 'proyecto' });
    expect(parseRemoteUrl('https://gitlab.miempresa.es:8443/equipo/app.git')).toEqual({ provider: 'gitlab', host: 'gitlab.miempresa.es:8443', path: 'equipo/app', name: 'app' });
    expect(parseRemoteUrl('ssh://git@gitlab.miempresa.es:2222/equipo/app.git')).toMatchObject({ host: 'gitlab.miempresa.es', path: 'equipo/app' });
    expect(parseRemoteUrl('https://github.miempresa.es/equipo/app')).toMatchObject({ provider: 'github', host: 'github.miempresa.es' });
  });

  it('[R99.1] otra cosa no da nada: otro servidor, una ruta rara o una dirección que no se entiende', () => {
    for (const url of ['', 'no es una url', 'https://bitbucket.org/a/b.git', 'https://github.com/solo-uno', 'https://github.com/a/b/c', 'https://github.com/a/../b', 'git@github.com:a/b c.git', '/home/yo/repo.git', 'C:\\repos\\a.git', 'https://gitlab.com/', 'file:///tmp/github/a/b']) {
      expect(parseRemoteUrl(url), url).toBeUndefined();
    }
  });

  it('[R99.2] PR en GitHub y MR en GitLab; el destino propuesto es develop y, si no, la principal, nunca la propia rama', () => {
    expect(reviewWord('github')).toBe('PR');
    expect(reviewWord('gitlab')).toBe('MR');
    expect(defaultReviewBase(['main', 'develop', 'feature/x'], 'feature/x')).toBe('develop');
    expect(defaultReviewBase(['main', 'feature/x'], 'feature/x')).toBe('main');
    expect(defaultReviewBase(['master', 'develop'], 'develop')).toBe('master');
    expect(defaultReviewBase(['feature/x'], 'feature/x')).toBeUndefined();
  });
});

describe('SPEC-099 · revisiones', () => {
  it('[R99.3] las comprobaciones se resumen: si alguna falla, falla; si alguna sigue, en marcha', () => {
    expect(summarizeChecks([])).toBeUndefined();
    expect(summarizeChecks(['pass', 'pass', 'pass'])).toEqual({ state: 'passing', passed: 3, total: 3 });
    expect(summarizeChecks(['pass', 'pending'])).toEqual({ state: 'pending', passed: 1, total: 2 });
    expect(summarizeChecks(['pass', 'pending', 'fail'])).toEqual({ state: 'failing', passed: 1, total: 3 });
  });

  it('[R99.6] solo vale un enlace https con forma de PR o MR', () => {
    for (const ok of ['https://github.com/a/b/pull/31', 'https://gitlab.com/g/s/p/-/merge_requests/7', 'https://gitlab.miempresa.es:8443/g/p/-/merge_requests/7']) expect(reviewUrl(ok)).toBe(ok);
    for (const bad of ['http://github.com/a/b/pull/31', 'https://github.com/a/b/pull/31?x=1', 'https://github.com/a/b/issues/3', 'javascript:alert(1)', 'https://github.com/a/b/pull/31 más', '', undefined, 31]) expect(reviewUrl(bad)).toBeUndefined();
  });

  it('[R99.9] no se abre sin título, con la misma rama en los dos lados, sin subirla o si ya hay una abierta', () => {
    const open: ReviewInfo[] = [{ number: 31, title: 'x', state: 'open', head: 'feature/x', base: 'develop' }, { number: 20, title: 'y', state: 'merged', head: 'vieja', base: 'develop' }];
    const ctx = { branches: ['main', 'develop', 'feature/x', 'feature/y', 'vieja', 'local'], pushed: ['main', 'develop', 'feature/x', 'feature/y', 'vieja'], open, word: 'PR' };
    const d = (more: object) => ({ title: 'Menú', head: 'feature/y', base: 'develop', ...more });
    expect(reviewDraftProblem(d({}), ctx)).toBeUndefined();
    expect(reviewDraftProblem(d({ title: '   ' }), ctx)).toBe('La PR necesita un título.');
    expect(reviewDraftProblem(d({ base: 'feature/y' }), ctx)).toMatch(/son la misma/);
    expect(reviewDraftProblem(d({ head: 'fantasma' }), ctx)).toMatch(/No existe la rama «fantasma»/);
    expect(reviewDraftProblem(d({ head: 'local' }), ctx)).toMatch(/todavía no está subida/);
    expect(reviewDraftProblem(d({ head: 'feature/x' }), ctx)).toMatch(/Ya hay una PR abierta de «feature\/x» a «develop»: #31/);
    // Hacia otro destino, o con la anterior ya fusionada, sí se puede.
    expect(reviewDraftProblem(d({ head: 'feature/x', base: 'main' }), ctx)).toBeUndefined();
    expect(reviewDraftProblem(d({ head: 'vieja' }), ctx)).toBeUndefined();
  });
});
