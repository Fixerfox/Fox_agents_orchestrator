// @vitest-environment jsdom
import './setup';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GitCommit } from '@orquestador/core';
import { EditorSession, createDiagram, type GitHistoryView, type GitOverviewView } from '@orquestador/editor';
import { App } from '../src/App';
import { runAssistantTool, type AssistantHost } from '../src/assistant/assistantTools';
import { createMemoryApi, type MemoryApiOptions } from '../src/memoryApi';
import { VersionsScreen } from '../src/versions';

const sha = (n: number) => String(n).repeat(40).slice(0, 40);
const commit = (n: number, subject: string, refs: string[] = [], parents = n > 1 ? [sha(n - 1)] : []): GitCommit => ({ sha: sha(n), parents, subject, author: 'Implementador', date: new Date(Date.now() - n * 3_600_000).toISOString(), refs });
const overview = (more: Partial<GitOverviewView> = {}): GitOverviewView => ({
  state: { repo: true, branch: 'feature/menu', commit: sha(4).slice(0, 7), head: sha(4), dirty: 2, branches: ['feature/menu', 'develop', 'main', 'orq/spec-kit', 'vieja'] },
  branches: [
    { name: 'feature/menu', sha: sha(4), current: true, upstream: 'origin/feature/menu', ahead: 2, behind: 0 },
    { name: 'develop', sha: sha(2), upstream: 'origin/develop', ahead: 0, behind: 1 },
    { name: 'main', sha: sha(1) },
    { name: 'orq/spec-kit', sha: sha(3) },
    { name: 'vieja', sha: sha(1) },
    { name: 'origin/develop', sha: sha(2), remote: true },
  ],
  changes: [
    { path: 'src/menu/keys.ts', status: 'modified', added: 2, removed: 1 },
    { path: 'src/menu/focus.test.ts', status: 'untracked' },
  ],
  stashes: [{ index: 0, label: 'orquestador: Spec Kit' }],
  running: 0,
  origins: { 'orq/spec-kit': { runId: 'run-7', name: 'Spec Kit' } },
  ...more,
});
const history: GitHistoryView = {
  commits: [commit(4, 'Menú: navegación con teclado', ['feature/menu']), commit(3, 'Tareas hechas', ['orq/spec-kit'], [sha(2)]), commit(2, 'Merge PR #29', ['develop', 'origin/develop']), commit(1, 'Versión 0.9', ['main', 'tag: v0.9'])],
  origins: { [sha(3)]: { runId: 'run-7', name: 'Spec Kit' } },
};
const DIFF = 'diff --git a/src/menu/keys.ts b/src/menu/keys.ts\nindex 1..2 100644\n--- a/src/menu/keys.ts\n+++ b/src/menu/keys.ts\n@@ -1,3 +1,4 @@\n export const KEYS = {\n-  next: [1],\n+  next: [1, 2],\n+  prev: [3],\n };';

function mount(repo: Partial<NonNullable<MemoryApiOptions['repo']>> | null = {}, props: { confirm?: (m: string) => boolean; onOpenRun?: (id: string) => void } = {}) {
  const api = createMemoryApi([createDiagram('principal', 'Principal')], repo === null ? {} : { repo: { overview: overview(), history, diffs: { 'src/menu/keys.ts': DIFF }, ...repo } });
  render(<VersionsScreen api={api} confirm={props.confirm ?? (() => true)} {...(props.onOpenRun ? { onOpenRun: props.onOpenRun } : {})} />);
  return api;
}
const region = async () => within(await screen.findByRole('region', { name: 'Control de versiones' }));

describe('SPEC-098 · sección «Versiones»', () => {
  it('[R98.11] el rail tiene «Versiones»; en una carpeta sin repositorio lo explica', async () => {
    render(<App initialProject="Juego" api={createMemoryApi()} agents={[]} confirm={() => true} />);
    await userEvent.click(within(screen.getByRole('navigation', { name: 'Secciones' })).getByRole('button', { name: 'Control de versiones' }));
    const page = await region();
    expect(await page.findByRole('heading', { name: 'Esta carpeta no es un repositorio de git' })).toBeTruthy();
  });

  it('[R98.11] con repositorio enseña las tres columnas: ramas, historial y cambios', async () => {
    mount();
    const page = await region();
    const left = within(await page.findByRole('complementary', { name: 'Ramas' }));
    expect(left.getByText('Locales · 5')).toBeTruthy();
    expect(left.getByText('Remotas · 1')).toBeTruthy();
    expect(left.getByRole('button', { name: 'feature/menu' }).getAttribute('aria-current')).toBe('true');
    expect(left.getByText('↑2')).toBeTruthy();
    expect(left.getByText('↓1')).toBeTruthy();
    expect(left.getAllByLabelText('Rama protegida')).toHaveLength(2);
    expect(left.getByText('orquestador: Spec Kit')).toBeTruthy();
    const rows = within(page.getByRole('list', { name: 'Historial' })).getAllByRole('listitem');
    expect(rows).toHaveLength(4);
    expect(rows[0]!.textContent).toContain('Menú: navegación con teclado');
    expect(within(rows[3]!).getByText('v0.9')).toBeTruthy();
    expect(rows.every((r) => r.querySelector('svg.orq-ver__graph circle'))).toBe(true);
    const right = within(page.getByRole('complementary', { name: 'Cambios y detalle' }));
    expect(right.getByText('Cambios sin commit · 2')).toBeTruthy();
    expect(right.getByText('src/menu/keys.ts')).toBeTruthy();
    expect(right.getByText('+2')).toBeTruthy();
  });

  it('[R98.13] la rama y el commit que creó un trabajo llevan su ficha, que abre esa ejecución; el resto no', async () => {
    const onOpenRun = vi.fn();
    mount({}, { onOpenRun });
    const page = await region();
    const chips = await page.findAllByRole('button', { name: 'La creó el trabajo «Spec Kit»: abrir su ejecución' });
    expect(chips).toHaveLength(2); // la rama y su commit
    await userEvent.click(chips[0]!);
    expect(onOpenRun).toHaveBeenCalledWith('run-7');
    await userEvent.click(page.getByRole('button', { name: 'Tareas hechas' }));
    const detail = within(page.getByRole('group', { name: 'Commit' }));
    expect(detail.getByText(/Lo hizo el trabajo/)).toBeTruthy();
    expect(detail.getByText(sha(3).slice(0, 7))).toBeTruthy();
    await userEvent.click(page.getByRole('button', { name: 'Versión 0.9' }));
    expect(within(page.getByRole('group', { name: 'Commit' })).getByText(/No lo hizo ningún trabajo/)).toBeTruthy();
  });

  it('[R98.14] elegir un archivo enseña su diferencia, y el commit guarda todo con su mensaje', async () => {
    const api = mount();
    const page = await region();
    await userEvent.click(await page.findByRole('button', { name: /src\/menu\/keys\.ts/ }));
    const diff = await page.findByLabelText('Diferencias');
    await waitFor(() => expect(diff.textContent).toContain('+  prev: [3],'));
    expect(diff.querySelectorAll('.is-add')).toHaveLength(2);
    expect(diff.querySelectorAll('.is-del')).toHaveLength(1);
    expect(diff.textContent).not.toContain('diff --git');
    const send = page.getByRole('button', { name: 'Commit en feature/menu' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    await userEvent.type(page.getByLabelText('Mensaje del commit'), 'Menú: Tab mueve el foco');
    await userEvent.click(send);
    await waitFor(() => expect(api.gitActions).toEqual([{ kind: 'commit', message: 'Menú: Tab mueve el foco' }]));
    expect(await page.findByText('No hay cambios sin guardar.')).toBeTruthy();
    expect(await page.findByRole('button', { name: 'Menú: Tab mueve el foco' })).toBeTruthy();
  });

  it('[R98.14] nueva rama con nombre y «Desde»; un nombre que no vale o que ya existe lo dice y no deja crear', async () => {
    const api = mount();
    const page = await region();
    await userEvent.click(await page.findByRole('button', { name: 'Nueva rama' }));
    const form = within(page.getByRole('form', { name: 'Nueva rama' }));
    const create = form.getByRole('button', { name: 'Crear y cambiar' }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    await userEvent.type(form.getByLabelText('Nombre de la rama'), 'mal nombre');
    expect(form.getByRole('alert').textContent).toBe('Ese nombre no vale para una rama.');
    await userEvent.clear(form.getByLabelText('Nombre de la rama'));
    await userEvent.type(form.getByLabelText('Nombre de la rama'), 'develop');
    expect(form.getByRole('alert').textContent).toContain('Ya existe una rama «develop»');
    expect(create.disabled).toBe(true);
    await userEvent.clear(form.getByLabelText('Nombre de la rama'));
    await userEvent.type(form.getByLabelText('Nombre de la rama'), 'feature/opciones');
    await userEvent.selectOptions(form.getByLabelText('Desde'), 'develop');
    await userEvent.click(create);
    await waitFor(() => expect(api.gitActions).toEqual([{ kind: 'create', name: 'feature/opciones', from: 'develop' }]));
    await waitFor(() => expect(page.getByRole('button', { name: 'feature/opciones' }).getAttribute('aria-current')).toBe('true'));
    expect(page.queryByRole('form', { name: 'Nueva rama' })).toBeNull();
  });

  it('[R98.14] al elegir una rama se puede cambiar, fusionar o borrar; lo que no se puede sale apagado con su motivo', async () => {
    const confirm = vi.fn(() => false);
    const api = mount({ overview: overview({ changes: [], state: { ...overview().state, dirty: 0 } }) }, { confirm });
    const page = await region();
    await userEvent.click(await page.findByRole('button', { name: 'vieja' }));
    const acts = within(page.getByRole('group', { name: 'Acciones sobre vieja' }));
    // Borrar pide confirmación siempre; si se dice que no, no se hace.
    await userEvent.click(acts.getByRole('button', { name: 'Borrar' }));
    expect(confirm).toHaveBeenCalledWith('¿Borrar la rama «vieja»? Solo se borra si ya está fusionada.');
    expect(api.gitActions).toEqual([]);
    confirm.mockReturnValue(true);
    await userEvent.click(acts.getByRole('button', { name: 'Borrar' }));
    await waitFor(() => expect(api.gitActions).toEqual([{ kind: 'delete', name: 'vieja' }]));
    await waitFor(() => expect(page.queryByRole('button', { name: 'vieja' })).toBeNull());
    // Una protegida no se borra: el botón está apagado y dice por qué.
    await userEvent.click(page.getByRole('button', { name: 'develop' }));
    const dev = within(page.getByRole('group', { name: 'Acciones sobre develop' }));
    const del = dev.getByRole('button', { name: 'Borrar' }) as HTMLButtonElement;
    expect(del.disabled).toBe(true);
    expect(del.title).toContain('rama protegida');
    await userEvent.click(dev.getByRole('button', { name: 'Fusionar en feature/menu' }));
    await userEvent.click(dev.getByRole('button', { name: 'Cambiar a esta' }));
    await waitFor(() => expect(api.gitActions.slice(1)).toEqual([{ kind: 'merge', name: 'develop' }, { kind: 'switch', name: 'develop' }]));
    await waitFor(() => expect(page.getByRole('button', { name: 'develop' }).getAttribute('aria-current')).toBe('true'));
  });

  it('[R98.14] subir, traer y recuperar lo apartado; subir a una rama protegida pide confirmación; un fallo de git se ve', async () => {
    const confirm = vi.fn(() => true);
    const api = mount({}, { confirm });
    const page = await region();
    await userEvent.click(await page.findByRole('button', { name: 'Subir 2' }));
    await userEvent.click(page.getByRole('button', { name: 'Traer' }));
    await userEvent.click(page.getByRole('button', { name: 'Recuperar' }));
    await waitFor(() => expect(api.gitActions).toEqual([{ kind: 'push' }, { kind: 'fetch' }, { kind: 'stash-pop', index: 0 }]));
    expect(confirm).not.toHaveBeenCalled();
    document.body.innerHTML = '';
    const main = overview();
    main.state.branch = 'main';
    for (const b of main.branches) delete b.current;
    main.branches[2]!.current = true;
    const failing = mount({ overview: main, actError: 'No se pudo subir main: sin credenciales' }, { confirm });
    const second = await region();
    await userEvent.click(await second.findByRole('button', { name: 'Publicar rama' }));
    expect(confirm).toHaveBeenCalledWith('«main» es una rama protegida. ¿Subir directamente a ella?');
    expect((await second.findByRole('alert')).textContent).toBe('No se pudo subir main: sin credenciales');
    expect(failing.gitActions).toEqual([]);
  });

  it('[R98.15] con ejecuciones en marcha lo avisa y apaga lo que mueve la carpeta, pero deja hacer commit y subir', async () => {
    mount({ overview: overview({ running: 1 }) });
    const page = await region();
    expect((await page.findByRole('note')).textContent).toContain('Hay 1 ejecución(es) en marcha');
    await userEvent.click(page.getByRole('button', { name: 'vieja' }));
    const acts = within(page.getByRole('group', { name: 'Acciones sobre vieja' }));
    const sw = acts.getByRole('button', { name: 'Cambiar a esta' }) as HTMLButtonElement;
    expect(sw.disabled).toBe(true);
    expect(sw.title).toContain('Hay una ejecución en marcha');
    expect((page.getByRole('button', { name: 'Recuperar' }) as HTMLButtonElement).disabled).toBe(true);
    expect((page.getByRole('button', { name: 'Apartar' }) as HTMLButtonElement).disabled).toBe(true);
    expect((page.getByRole('button', { name: 'Subir 2' }) as HTMLButtonElement).disabled).toBe(false);
    expect((page.getByRole('button', { name: 'Traer' }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('SPEC-098 · el asistente y git', () => {
  function host(options: MemoryApiOptions = { repo: { overview: overview(), history } }) {
    const api = createMemoryApi([], options);
    const refresh = vi.fn();
    return { api, refresh, h: { api, session: new EditorSession(createDiagram('d', 'D')), newDiagram: vi.fn(), run: vi.fn(), refresh } as unknown as AssistantHost };
  }

  it('[R98.16] git_status y git_history cuentan el estado y qué trabajo creó cada rama y cada commit', async () => {
    const { h } = host();
    const status = await runAssistantTool(h, 'git_status', {});
    expect(status).toMatchObject({ ok: true, summary: 'Ha mirado el estado de git' });
    expect(status.result).toMatchObject({ repo: true, branch: 'feature/menu', changes: [{ path: 'src/menu/keys.ts', status: 'modified' }, { path: 'src/menu/focus.test.ts', status: 'untracked' }], runningExecutions: 0 });
    const branches = (status.result as { branches: { name: string; createdBy?: unknown; current?: boolean }[] }).branches;
    expect(branches.map((b) => b.name)).toEqual(['feature/menu', 'develop', 'main', 'orq/spec-kit', 'vieja']);
    expect(branches.find((b) => b.name === 'orq/spec-kit')!.createdBy).toEqual({ runId: 'run-7', name: 'Spec Kit' });
    const hist = (await runAssistantTool(h, 'git_history', { limit: 2 })).result as { sha: string; subject: string; madeBy?: unknown }[];
    expect(hist.map((c) => c.subject)).toContain('Tareas hechas');
    expect(hist.find((c) => c.subject === 'Tareas hechas')).toMatchObject({ sha: sha(3).slice(0, 7), madeBy: { runId: 'run-7', name: 'Spec Kit' } });
    expect((await runAssistantTool(host({}).h, 'git_status', {})).result).toEqual({ repo: false });
  });

  it('[R98.16][R98.17] cada acción usa las mismas reglas que el visor y deja una línea en el chat', async () => {
    const { api, refresh, h } = host();
    expect(await runAssistantTool(h, 'git_commit', { message: 'Menú listo' })).toMatchObject({ ok: true, summary: 'Ha hecho commit de 2 archivo(s) en feature/menu' });
    expect(await runAssistantTool(h, 'git_create_branch', { name: 'feature/opciones', from: 'develop' })).toMatchObject({ ok: true, summary: 'Ha creado la rama feature/opciones desde develop', result: { branch: 'feature/opciones' } });
    expect(await runAssistantTool(h, 'git_push', {})).toMatchObject({ ok: true, summary: 'Ha subido feature/opciones a origin' });
    expect(await runAssistantTool(h, 'git_switch_branch', { name: 'feature/menu' })).toMatchObject({ ok: true, summary: 'Ha cambiado a la rama feature/menu' });
    expect(await runAssistantTool(h, 'git_merge_branch', { name: 'develop' })).toMatchObject({ ok: true, summary: 'Ha fusionado develop en feature/menu' });
    expect(await runAssistantTool(h, 'git_pull', {})).toMatchObject({ ok: true, summary: 'Ha traído lo último de feature/menu' });
    expect(await runAssistantTool(h, 'git_delete_branch', { name: 'vieja' })).toMatchObject({ ok: true, summary: 'Ha borrado la rama vieja' });
    expect(api.gitActions).toEqual([{ kind: 'commit', message: 'Menú listo' }, { kind: 'create', name: 'feature/opciones', from: 'develop' }, { kind: 'push' }, { kind: 'switch', name: 'feature/menu' }, { kind: 'merge', name: 'develop' }, { kind: 'pull' }, { kind: 'delete', name: 'vieja' }]);
    expect(refresh).toHaveBeenCalledTimes(7);
    // Lo que no se puede, falla con el motivo y no se hace.
    expect(await runAssistantTool(h, 'git_delete_branch', { name: 'main' })).toMatchObject({ ok: false, summary: expect.stringMatching(/rama protegida/) });
    expect(await runAssistantTool(h, 'git_stash', {})).toMatchObject({ ok: false, summary: expect.stringMatching(/No hay cambios que apartar/) });
    expect(api.gitActions).toHaveLength(7);
  });
});
