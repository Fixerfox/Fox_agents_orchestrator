import { describe, expect, it } from 'vitest';
import type { GitCommit } from '@orquestador/core';
import { ASSISTANT_TOOLS, CHANNELS, MAX_GIT_HISTORY, MAX_REVIEW_TOKEN, commitGraph, parseRequest, t } from '../src';

const c = (sha: string, ...parents: string[]): GitCommit => ({ sha, parents, subject: sha, author: 'a', date: '2026-11-11T09:00:00Z', refs: [] });

describe('SPEC-098 · grafo de commits', () => {
  it('[R98.12] una historia en línea va por un solo carril', () => {
    const g = commitGraph([c('c3', 'c2'), c('c2', 'c1'), c('c1')]);
    expect(g.lanes).toBe(1);
    expect(g.rows).toEqual([
      { sha: 'c3', lane: 0, from: [], to: [0], pass: [] },
      { sha: 'c2', lane: 0, from: [0], to: [0], pass: [] },
      { sha: 'c1', lane: 0, from: [0], to: [], pass: [] },
    ]);
  });

  it('[R98.12] una fusión abre un carril para el segundo padre y lo cierra donde se separaron', () => {
    //  m ── a2 ── a1 ── base      (carril 0)
    //   └── b1 ────────┘          (carril 1)
    const g = commitGraph([c('m', 'a2', 'b1'), c('a2', 'a1'), c('b1', 'base'), c('a1', 'base'), c('base')]);
    expect(g.lanes).toBe(2);
    expect(g.rows[0]).toEqual({ sha: 'm', lane: 0, from: [], to: [0, 1], pass: [] });
    expect(g.rows[1]).toEqual({ sha: 'a2', lane: 0, from: [0], to: [0], pass: [1] });
    expect(g.rows[2]).toEqual({ sha: 'b1', lane: 1, from: [1], to: [1], pass: [0] });
    expect(g.rows[3]).toEqual({ sha: 'a1', lane: 0, from: [0], to: [1], pass: [] });
    expect(g.rows[4]).toEqual({ sha: 'base', lane: 1, from: [1], to: [], pass: [] });
  });

  it('[R98.12] dos ramas sin fusionar van cada una por su carril, y el carril libre se reutiliza', () => {
    const g = commitGraph([c('x2', 'x1'), c('y1', 'base'), c('x1', 'base'), c('base'), c('suelto')]);
    expect(g.rows.map((r) => r.lane)).toEqual([0, 1, 0, 1, 0]);
    expect(g.rows[2]!.to).toEqual([1]);
    expect(g.rows[3]!.from).toEqual([1]);
    expect(g.lanes).toBe(2);
    expect(commitGraph([])).toEqual({ rows: [], lanes: 0 });
  });
});

describe('SPEC-098 · contrato y asistente', () => {
  it('[R98.10] el contrato valida las acciones, el tope del historial y la ruta de la diferencia', () => {
    expect(parseRequest(CHANNELS.gitOverview, undefined)).toBeUndefined();
    expect(() => parseRequest(CHANNELS.gitOverview, { path: '/' })).toThrow();
    expect(parseRequest(CHANNELS.gitHistory, { limit: 50 })).toEqual({ limit: 50 });
    expect(parseRequest(CHANNELS.gitHistory, {})).toEqual({});
    for (const bad of [undefined, { limit: 0 }, { limit: MAX_GIT_HISTORY + 1 }, { limit: 1.5 }, { limit: 5, all: true }]) expect(() => parseRequest(CHANNELS.gitHistory, bad)).toThrow();
    expect(parseRequest(CHANNELS.gitDiff, { path: 'src/a.ts' })).toEqual({ path: 'src/a.ts' });
    for (const bad of [undefined, {}, { path: '../x' }, { path: '/etc/passwd' }, { path: 'C:\\x' }, { path: '--output=x' }, { path: 'a', b: 1 }]) expect(() => parseRequest(CHANNELS.gitDiff, bad)).toThrow();
    expect(parseRequest(CHANNELS.gitAct, { kind: 'commit', message: 'hola' })).toEqual({ kind: 'commit', message: 'hola' });
    for (const bad of [undefined, 'push', { kind: 'rebase' }, { kind: 'create', name: '--force' }, { kind: 'push', force: true }, { kind: 'commit', message: '' }]) expect(() => parseRequest(CHANNELS.gitAct, bad)).toThrow(/acción de git no válida/);
  });

  it('[R98.16][R98.17] el asistente tiene las herramientas de git: mirar no pide permiso, cambiar, bajar y fusionar sí, y subir y borrar siempre', () => {
    const tool = (name: string) => ASSISTANT_TOOLS.find((x) => x.name === name)!;
    const names = ['git_status', 'git_history', 'git_create_branch', 'git_switch_branch', 'git_commit', 'git_push', 'git_pull', 'git_merge_branch', 'git_delete_branch', 'git_stash'];
    for (const n of names) {
      expect(tool(n), n).toBeDefined();
      expect(t(`as.t.${n}` as never)).not.toBe(`as.t.${n}`);
    }
    expect(names.filter((n) => tool(n).readOnly)).toEqual(['git_status', 'git_history']);
    expect(names.filter((n) => tool(n).destructive)).toEqual(['git_switch_branch', 'git_push', 'git_pull', 'git_merge_branch', 'git_delete_branch']);
    expect(names.filter((n) => tool(n).alwaysConfirm)).toEqual(['git_push', 'git_delete_branch']);
    expect(Object.keys(tool('git_create_branch').params)).toEqual(['name', 'from']);
    expect(tool('git_create_branch').params['from']!.optional).toBe(true);
  });
});

describe('SPEC-099 · contrato y asistente de las PR y MR', () => {
  it('[R99.10] el contrato valida la revisión nueva y el token, y no admite campos de más', () => {
    const draft = { title: 'Menú', head: 'feature/menu', base: 'develop' };
    expect(parseRequest(CHANNELS.gitCreateReview, draft)).toEqual(draft);
    expect(parseRequest(CHANNELS.gitCreateReview, { ...draft, body: 'Lo que hace', draft: true })).toMatchObject({ draft: true });
    for (const bad of [undefined, {}, { ...draft, title: '  ' }, { ...draft, title: 'a\nb' }, { ...draft, title: 'x'.repeat(251) }, { ...draft, head: '--force' }, { ...draft, base: 'a b' }, { ...draft, draft: 'sí' }, { ...draft, body: 3 }, { ...draft, repo: 'otro/repo' }]) {
      expect(() => parseRequest(CHANNELS.gitCreateReview, bad)).toThrow();
    }
    expect(parseRequest(CHANNELS.setReviewToken, { token: 'ghp_abcdefgh1234' })).toEqual({ token: 'ghp_abcdefgh1234' });
    for (const bad of [undefined, 'ghp_abcdefgh1234', {}, { token: 'corto' }, { token: 'con espacio dentro' }, { token: 'dos\nlineas-largas' }, { token: 'x'.repeat(MAX_REVIEW_TOKEN + 1) }, { token: 'ghp_abcdefgh1234', host: 'evil.example' }]) {
      expect(() => parseRequest(CHANNELS.setReviewToken, bad)).toThrow();
    }
    expect(parseRequest(CHANNELS.gitReviews, undefined)).toBeUndefined();
    expect(parseRequest(CHANNELS.clearReviewToken, undefined)).toBeUndefined();
    expect(() => parseRequest(CHANNELS.gitReviews, { host: 'x' })).toThrow();
    expect(() => parseRequest(CHANNELS.clearReviewToken, { host: 'x' })).toThrow();
  });

  it('[R99.14] el asistente puede mirar las revisiones sin permiso y abrir una pidiéndolo siempre', () => {
    const tool = (name: string) => ASSISTANT_TOOLS.find((x) => x.name === name)!;
    expect(tool('git_list_reviews')).toMatchObject({ readOnly: true });
    expect(tool('git_create_review')).toMatchObject({ destructive: true, alwaysConfirm: true });
    expect(Object.keys(tool('git_create_review').params)).toEqual(['title', 'body', 'head', 'base', 'draft']);
    expect(tool('git_create_review').params['title']!.optional).toBeUndefined();
    for (const n of ['git_list_reviews', 'git_create_review']) expect(t(`as.t.${n}` as never)).not.toBe(`as.t.${n}`);
  });
});
