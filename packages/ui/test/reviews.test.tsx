// @vitest-environment jsdom
import './setup';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReviewInfo } from '@orquestador/core';
import { EditorSession, createDiagram, type GitHistoryView, type GitOverviewView, type GitReviewsView } from '@orquestador/editor';
import { runAssistantTool, type AssistantHost } from '../src/assistant/assistantTools';
import { createMemoryApi, type MemoryApiOptions } from '../src/memoryApi';
import { VersionsScreen } from '../src/versions';

const sha = (n: number) => String(n).repeat(40).slice(0, 40);
const overview = (current = 'feature/menu'): GitOverviewView => ({
  state: { repo: true, branch: current, commit: sha(4).slice(0, 7), head: sha(4), dirty: 0, branches: ['feature/menu', 'feature/opciones', 'local', 'develop', 'main'] },
  branches: [
    { name: 'feature/menu', sha: sha(4), upstream: 'origin/feature/menu', ahead: 0, behind: 0 },
    { name: 'feature/opciones', sha: sha(3), upstream: 'origin/feature/opciones', ahead: 0, behind: 0 },
    { name: 'local', sha: sha(3) },
    { name: 'develop', sha: sha(2), upstream: 'origin/develop', ahead: 0, behind: 0 },
    { name: 'main', sha: sha(1), upstream: 'origin/main', ahead: 0, behind: 0 },
  ].map((b) => (b.name === current ? { ...b, current: true } : b)),
  changes: [],
  stashes: [],
  running: 0,
  origins: {},
});
const history: GitHistoryView = {
  commits: [
    { sha: sha(4), parents: [sha(3)], subject: 'Menú: navegación con teclado', author: 'a', date: new Date().toISOString(), refs: ['feature/menu'] },
    { sha: sha(3), parents: [], subject: 'Opciones: pantalla nueva', author: 'a', date: new Date().toISOString(), refs: ['feature/opciones'] },
  ],
  origins: {},
};
const PR31: ReviewInfo = { number: 31, title: 'Menú principal', state: 'open', head: 'feature/menu', base: 'develop', url: 'https://github.com/Fixerfox/app/pull/31', checks: { state: 'passing', passed: 3, total: 3 } };
const github = (more: Partial<GitReviewsView> = {}): GitReviewsView => ({ provider: 'github', word: 'PR', host: 'github.com', project: 'Fixerfox/app', via: 'cli', base: 'develop', reviews: [PR31], ...more });

function mount(reviews: GitReviewsView | undefined, current = 'feature/menu', more: Partial<NonNullable<MemoryApiOptions['repo']>> = {}) {
  const api = createMemoryApi([createDiagram('principal', 'Principal')], { repo: { overview: overview(current), history, ...(reviews ? { reviews } : {}), ...more } });
  render(<VersionsScreen api={api} confirm={() => true} />);
  return api;
}
const region = async () => within(await screen.findByRole('region', { name: 'Control de versiones' }));

describe('SPEC-099 · PR y MR en «Versiones»', () => {
  it('[R99.11] la rama con una PR abierta lleva su número, y la de la rama actual se ve con estado, destino, comprobaciones y enlace', async () => {
    mount(github());
    const page = await region();
    expect(await page.findByLabelText('PR #31 abierta')).toBeTruthy();
    const block = within(await page.findByRole('region', { name: 'PR de esta rama' }));
    const card = within(block.getByRole('group', { name: 'PR #31' }));
    expect(card.getByText('#31 · Menú principal')).toBeTruthy();
    expect(card.getByText('Abierta')).toBeTruthy();
    expect(card.getByText('feature/menu → develop')).toBeTruthy();
    expect(card.getByText('3 de 3 comprobaciones')).toBeTruthy();
    const link = card.getByRole('link', { name: 'Abrir en el navegador' }) as HTMLAnchorElement;
    expect(link.href).toBe('https://github.com/Fixerfox/app/pull/31');
    expect(link.target).toBe('_blank');
    expect(block.getByText('Conectado con gh')).toBeTruthy();
    // Con una abierta no se ofrece abrir otra.
    expect(block.queryByRole('button', { name: 'Abrir PR' })).toBeNull();
  });

  it('[R99.11] en GitLab se llaman MR, y unas comprobaciones que fallan o siguen se dicen', async () => {
    mount({ provider: 'gitlab', word: 'MR', host: 'gitlab.miempresa.es', project: 'g/app', via: 'token', base: 'develop', reviews: [{ ...PR31, number: 7, url: 'https://gitlab.miempresa.es/g/app/-/merge_requests/7', checks: { state: 'failing', passed: 1, total: 3 } }] });
    const page = await region();
    const block = within(await page.findByRole('region', { name: 'MR de esta rama' }));
    expect(within(block.getByRole('group', { name: 'MR #7' })).getByText('Fallan comprobaciones (1 de 3 pasan)')).toBeTruthy();
    expect(block.getByText('Conectado con un token')).toBeTruthy();
    expect(await page.findByLabelText('MR #7 abierta')).toBeTruthy();
  });

  it('[R99.12] «Abrir PR» propone el título del último commit y el destino, y al crearla aparece su bloque', async () => {
    const api = mount(github(), 'feature/opciones');
    const page = await region();
    const block = within(await page.findByRole('region', { name: 'PR de esta rama' }));
    expect(block.getByText('Esta rama no tiene ninguna PR abierta.')).toBeTruthy();
    await userEvent.click(block.getByRole('button', { name: 'Abrir PR' }));
    const form = within(block.getByRole('form', { name: 'Nueva PR' }));
    expect((form.getByLabelText('Título') as HTMLInputElement).value).toBe('Opciones: pantalla nueva');
    expect((form.getByLabelText('Destino') as HTMLSelectElement).value).toBe('develop');
    await userEvent.type(form.getByLabelText('Descripción'), 'Añade la pantalla');
    await userEvent.click(form.getByLabelText('Borrador'));
    await userEvent.click(form.getByRole('button', { name: 'Crear PR' }));
    await waitFor(() => expect(api.reviewDrafts).toEqual([{ title: 'Opciones: pantalla nueva', head: 'feature/opciones', base: 'develop', body: 'Añade la pantalla', draft: true }]));
    const card = within(await block.findByRole('group', { name: 'PR #32' }));
    expect(card.getByText('Borrador')).toBeTruthy();
    expect(block.queryByRole('form', { name: 'Nueva PR' })).toBeNull();
    expect(await page.findByLabelText('PR #32 abierta')).toBeTruthy();
  });

  it('[R99.12] sin subir la rama, o en una protegida, «Abrir PR» está apagado y dice por qué; un fallo al crear se ve', async () => {
    mount(github(), 'local');
    const first = within(await (await region()).findByRole('region', { name: 'PR de esta rama' }));
    const off = first.getByRole('button', { name: 'Abrir PR' }) as HTMLButtonElement;
    expect(off.disabled).toBe(true);
    expect(off.title).toBe('Sube la rama antes de abrir la PR.');
    document.body.innerHTML = '';
    mount(github(), 'main');
    const second = within(await (await region()).findByRole('region', { name: 'PR de esta rama' }));
    expect((second.getByRole('button', { name: 'Abrir PR' }) as HTMLButtonElement).title).toBe('Desde una rama protegida no se abre una PR.');
    document.body.innerHTML = '';
    const api = mount(github(), 'feature/opciones', { reviewError: 'No se pudo abrir la PR: sin permiso' });
    const third = within(await (await region()).findByRole('region', { name: 'PR de esta rama' }));
    await userEvent.click(third.getByRole('button', { name: 'Abrir PR' }));
    await userEvent.click(third.getByRole('button', { name: 'Crear PR' }));
    expect((await third.findByRole('alert')).textContent).toBe('No se pudo abrir la PR: sin permiso');
    expect(third.getByRole('form', { name: 'Nueva PR' })).toBeTruthy();
    expect(api.reviewDrafts).toEqual([]);
  });

  it('[R99.13] sin conexión explica las dos formas y guarda el token, que es un campo de contraseña; con token se puede quitar', async () => {
    const { via: _v, ...off } = github();
    void _v;
    const api = mount(off);
    const page = await region();
    const block = within(await page.findByRole('region', { name: 'Conecta con github.com para ver sus PR' }));
    expect(block.getByText(/Inicia sesión con «gh auth login»/)).toBeTruthy();
    expect(block.getByText(/solo se envía a github\.com/)).toBeTruthy();
    const field = block.getByLabelText('Token de acceso') as HTMLInputElement;
    expect(field.type).toBe('password');
    const save = block.getByRole('button', { name: 'Guardar token' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    await userEvent.type(field, 'ghp_abcdefgh1234');
    await userEvent.click(save);
    await waitFor(() => expect(api.reviewTokens).toEqual(['ghp_abcdefgh1234']));
    const on = within(await page.findByRole('region', { name: 'PR de esta rama' }));
    expect(on.getByText('Conectado con un token')).toBeTruthy();
    expect(page.queryByDisplayValue('ghp_abcdefgh1234')).toBeNull();
    await userEvent.click(on.getByRole('button', { name: 'Quitar el token' }));
    expect(await page.findByRole('region', { name: 'Conecta con github.com para ver sus PR' })).toBeTruthy();
  });

  it('[R99.13] sin un origin de GitHub o GitLab el bloque no aparece; si la lista falla, se ve el motivo', async () => {
    mount(undefined);
    const page = await region();
    await page.findByRole('list', { name: 'Historial' });
    expect(page.queryByRole('region', { name: /PR|MR/ })).toBeNull();
    document.body.innerHTML = '';
    mount(github({ reviews: [], error: 'github.com rechazó la petición de las PR: el token no vale o no tiene permiso.' }));
    const block = within(await (await region()).findByRole('region', { name: 'PR de esta rama' }));
    expect(block.getByRole('alert').textContent).toContain('el token no vale');
  });
});

describe('SPEC-099 · el asistente y las PR', () => {
  function host(reviews: GitReviewsView | undefined, current = 'feature/opciones') {
    const api = createMemoryApi([], { repo: { overview: overview(current), history, ...(reviews ? { reviews } : {}) } });
    const refresh = vi.fn();
    return { api, refresh, h: { api, session: new EditorSession(createDiagram('d', 'D')), newDiagram: vi.fn(), run: vi.fn(), refresh } as unknown as AssistantHost };
  }

  it('[R99.14] git_list_reviews cuenta las revisiones y si hay conexión', async () => {
    const r = await runAssistantTool(host(github()).h, 'git_list_reviews', {});
    expect(r).toMatchObject({ ok: true, summary: 'Ha mirado las PR del repositorio', result: { available: true, provider: 'github', project: 'Fixerfox/app', connected: 'cli', reviews: [PR31] } });
    const { via: _v, ...off } = github({ reviews: [] });
    void _v;
    expect((await runAssistantTool(host(off).h, 'git_list_reviews', {})).result).toMatchObject({ connected: false, reviews: [] });
    expect((await runAssistantTool(host(undefined).h, 'git_list_reviews', {})).result).toEqual({ available: false });
  });

  it('[R99.14] git_create_review usa la rama actual y el destino propuesto, y deja la línea con el número', async () => {
    const { api, refresh, h } = host(github());
    const r = await runAssistantTool(h, 'git_create_review', { title: 'Opciones', body: 'Lo que hace' });
    expect(r).toMatchObject({ ok: true, summary: 'Ha abierto la PR #32 hacia develop', result: { number: 32, url: 'https://github.com/Fixerfox/app/pull/32' } });
    expect(api.reviewDrafts).toEqual([{ title: 'Opciones', head: 'feature/opciones', base: 'develop', body: 'Lo que hace' }]);
    expect(refresh).toHaveBeenCalledTimes(1);
    // Las mismas comprobaciones que el visor: una rama sin subir no se abre.
    expect(await runAssistantTool(h, 'git_create_review', { title: 'x', head: 'local' })).toMatchObject({ ok: false, summary: expect.stringMatching(/todavía no está subida/) });
    expect(await runAssistantTool(host(undefined).h, 'git_create_review', { title: 'x' })).toMatchObject({ ok: false, summary: 'Este repositorio no tiene un origin de GitHub ni de GitLab.' });
    expect(api.reviewDrafts).toHaveLength(1);
  });
});
