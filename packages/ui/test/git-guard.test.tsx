// @vitest-environment jsdom
import './setup';
import { describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { newAgent, type Diagram, type GitState, type RunEvent } from '@orquestador/core';
import { createDiagram, summarizeRun } from '@orquestador/editor';
import { App } from '../src/App';
import { SummaryBody } from '../src/runs/RunSummary';
import { createMemoryApi, type MemoryApiOptions } from '../src/memoryApi';
import { stepTab } from './nav';

const flow: Diagram = {
  id: 'informe',
  name: 'Informe semanal',
  schemaVersion: 1,
  nodes: [
    { id: 'entry', kind: 'entry' },
    { id: 'p', kind: 'agent', agentId: 'pix', task: 'Pinta' },
    { id: 'output', kind: 'output' },
  ],
  edges: [
    { id: 'e1', from: 'entry', to: 'p' },
    { id: 'e2', from: 'p', to: 'output' },
  ],
};
const repo = (more: Partial<GitState> = {}): GitState => ({ repo: true, branch: 'feature/x', commit: 'abc1234', dirty: 0, branches: ['main', 'develop', 'feature/x'], ...more });
const SUGGESTED = 'orq/informe-semanal-20261111-0905';

async function openDialog(state: GitState | undefined, more: Partial<NonNullable<MemoryApiOptions['git']>> = {}) {
  const api = createMemoryApi([createDiagram('principal', 'Principal'), flow], { agents: [{ ...newAgent('pix', 'Pixelador'), description: 'Pinta' }], ...(state ? { git: { state, suggested: SUGGESTED, ...more } } : {}) });
  render(<App initialProject="Juego" api={api} agents={[]} confirm={() => true} />);
  await userEvent.click(screen.getByRole('button', { name: /^Proyecto «/ }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Abrir proyecto' }));
  await screen.findByRole('button', { name: 'Añadir «Pixelador» al diagrama' });
  await userEvent.click(within(screen.getByRole('navigation', { name: 'Secciones' })).getByRole('button', { name: 'Trabajos' }));
  await userEvent.click(within(await screen.findByRole('listitem', { name: 'Informe semanal' })).getByRole('button', { name: 'Lanzar «Informe semanal»' }));
  const dlg = within(await screen.findByRole('dialog', { name: 'Ejecutar «Informe semanal»' }));
  await userEvent.type(dlg.getByLabelText('Entrada'), 'hazlo');
  return { api, dlg };
}
const field = async (dlg: ReturnType<typeof within>) => within(await dlg.findByRole('group', { name: 'Rama de git' }));
const launchButton = (dlg: ReturnType<typeof within>) => dlg.getByRole('button', { name: 'Lanzar y ver la ejecución' }) as HTMLButtonElement;
const radio = (g: ReturnType<typeof within>, name: RegExp) => g.getByRole('radio', { name }) as HTMLInputElement;

describe('SPEC-097 · campo «Rama de git» del diálogo Ejecutar', () => {
  it('[R97.16] en una rama de trabajo viene «Seguir en <rama>», avisa de los cambios sin commit y lanza con esa elección', async () => {
    const { api, dlg } = await openDialog(repo({ dirty: 3 }));
    const g = await field(dlg);
    expect(radio(g, /^Seguir en feature\/x/).checked).toBe(true);
    expect(g.getByText('Hay 3 archivo(s) con cambios sin commit: la ejecución trabajará sobre ellos.')).toBeTruthy();
    expect(g.queryByLabelText('Nombre de la rama')).toBeNull();
    await userEvent.click(launchButton(dlg));
    await waitFor(() => expect(api.gitChoices).toEqual([{ mode: 'stay' }]));
  });

  it('[R97.16] en una rama protegida viene marcada «Rama nueva» con el nombre propuesto, y quedarse hay que elegirlo', async () => {
    const { api, dlg } = await openDialog(repo({ branch: 'main' }));
    const g = await field(dlg);
    expect(g.getByText(/«main» es una rama protegida/)).toBeTruthy();
    expect(radio(g, /^Rama nueva para esta ejecución/).checked).toBe(true);
    expect((g.getByLabelText('Nombre de la rama') as HTMLInputElement).value).toBe(SUGGESTED);
    expect((g.getByRole('combobox', { name: 'Desde' }) as HTMLSelectElement).value).toBe('here');
    await userEvent.click(launchButton(dlg));
    await waitFor(() => expect(api.gitChoices).toEqual([{ mode: 'new', name: SUGGESTED, from: 'here' }]));
  });

  it('[R97.16] con otra base y cambios sin commit hay que decir qué se hace con ellos; un nombre que no vale apaga «Ejecutar»', async () => {
    const { api, dlg } = await openDialog(repo({ dirty: 2 }));
    const g = await field(dlg);
    await userEvent.click(radio(g, /^Rama nueva para esta ejecución/));
    expect(g.queryByRole('group', { name: /cambios sin commit/ })).toBeNull();
    await userEvent.selectOptions(g.getByRole('combobox', { name: 'Desde' }), 'develop');
    const changes = within(g.getByRole('group', { name: 'Tienes 2 archivo(s) con cambios sin commit' }));
    expect((changes.getByRole('radio', { name: 'Llevarlos a la rama nueva' }) as HTMLInputElement).checked).toBe(true);
    await userEvent.click(changes.getByRole('radio', { name: /^Apartarlos/ }));
    const name = g.getByLabelText('Nombre de la rama');
    await userEvent.clear(name);
    await userEvent.type(name, 'develop');
    expect((await g.findByRole('alert')).textContent).toContain('Ya existe una rama «develop»');
    expect(launchButton(dlg).disabled).toBe(true);
    await userEvent.clear(name);
    await userEvent.type(name, 'orq/limpia');
    expect(g.queryByRole('alert')).toBeNull();
    await userEvent.click(launchButton(dlg));
    await waitFor(() => expect(api.gitChoices).toEqual([{ mode: 'new', name: 'orq/limpia', from: 'develop', changes: 'stash' }]));
  });

  it('[R97.16] con una operación de git a medias lo dice y no deja ejecutar', async () => {
    const { dlg } = await openDialog(repo({ busy: 'rebase' }));
    const g = await field(dlg);
    expect(g.getByRole('alert').textContent).toContain('un rebase a medias');
    expect(g.queryByRole('radio')).toBeNull();
    expect(launchButton(dlg).disabled).toBe(true);
  });

  it('[R97.16] con otra ejecución en marcha en la carpeta no se puede elegir «Rama nueva»', async () => {
    const { dlg } = await openDialog(repo({ branch: 'main' }), { otherRuns: 1 });
    const g = await field(dlg);
    expect(radio(g, /^Seguir en main/).checked).toBe(true);
    expect(radio(g, /^Rama nueva para esta ejecución/).disabled).toBe(true);
    expect(g.getByText(/hay otra ejecución en marcha en esta carpeta/)).toBeTruthy();
    expect(launchButton(dlg).disabled).toBe(false);
  });

  it('[R97.16] sin repositorio el campo no aparece y se lanza como siempre', async () => {
    const { api, dlg } = await openDialog(undefined);
    expect(dlg.queryByRole('group', { name: 'Rama de git' })).toBeNull();
    await userEvent.click(launchButton(dlg));
    await waitFor(() => expect(api.gitChoices).toEqual([undefined]));
    const none = await openDialogAgain({ repo: false, dirty: 0, branches: [] });
    expect(none.queryByRole('group', { name: 'Rama de git' })).toBeNull();
  });
});

/** Otro montaje, con el anterior ya retirado. */
async function openDialogAgain(state: GitState) {
  document.body.innerHTML = '';
  return (await openDialog(state)).dlg;
}

describe('SPEC-097 · el paso y el resumen', () => {
  it('[R97.17] el panel de un paso de agente tiene «Este paso gestiona ramas de git» y lo guarda en el diagrama', async () => {
    const api = createMemoryApi();
    render(<App initialProject="Juego" api={api} agents={[{ id: 'sprites', name: 'Sprites', description: 'Dibuja', model: 'claude-sonnet-5-5' }]} confirm={() => true} />);
    await userEvent.click(screen.getByRole('button', { name: '+ Agente' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Sprites/ }));
    await screen.findByLabelText(/^Agente «/);
    await stepTab('Permisos');
    const box = (await screen.findByRole('checkbox', { name: 'Este paso gestiona ramas de git' })) as HTMLInputElement;
    expect(box.checked).toBe(false);
    await userEvent.click(box);
    await waitFor(() => expect((screen.getByRole('checkbox', { name: 'Este paso gestiona ramas de git' }) as HTMLInputElement).checked).toBe(true));
    expect(screen.getByText(/Para pasos como «Commit y PR»/)).toBeTruthy();
  });

  it('[R97.11] el resumen dice en qué rama empezó, si se creó para la ejecución y si se apartaron cambios', () => {
    const ev = (seq: number, body: object) => ({ runId: 'r', seq, ts: `2026-11-11T09:00:0${seq}.000Z`, ...body }) as RunEvent;
    const s = summarizeRun([ev(1, { type: 'run.started', diagramId: 'd' }), ev(2, { type: 'run.git', branch: 'orq/a', commit: 'abc1234', created: true, from: 'main', stash: 'orquestador: D' }), ev(3, { type: 'run.finished', status: 'succeeded' })]);
    render(<SummaryBody summary={s} onPick={() => undefined} />);
    const note = screen.getByText(/Empezó en la rama/).closest('p')!;
    expect(note.textContent).toContain('orq/a');
    expect(note.textContent).toContain('abc1234');
    expect(note.textContent).toContain('rama nueva desde main');
    expect(note.textContent).toContain('Se apartaron tus cambios como «orquestador: D»');
  });
});
