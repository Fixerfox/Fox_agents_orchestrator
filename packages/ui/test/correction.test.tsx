// @vitest-environment jsdom
import './setup';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Diagram, RunEvent } from '@orquestador/core';
import { EMPTY_LIVE, addNode, connect, createDiagram, deriveLive, disconnect, type RunSummary } from '@orquestador/editor';
import { App } from '../src/App';
import { DRAG_TYPE } from '../src/Canvas';
import { NodePanel } from '../src/NodePanel';
import { QuestionCard, RunsScreen, type RunsNav } from '../src/RunsScreen';
import { createMemoryApi } from '../src/memoryApi';
import type { RunsIndex } from '../src/useRunsIndex';

/** Entrada → Analista → Seguridad → Salida. */
const PR: Diagram = {
  id: 'pr',
  name: 'Revisión de PR',
  schemaVersion: 1,
  nodes: [
    { id: 'entry', kind: 'entry', label: 'Entrada', position: { x: 0, y: 0 } },
    { id: 'an', kind: 'agent', agentId: 'analista', label: 'Analista', position: { x: 200, y: 0 } },
    { id: 'se', kind: 'agent', agentId: 'seguridad', label: 'Seguridad', position: { x: 400, y: 0 } },
    { id: 'output', kind: 'output', label: 'Salida', position: { x: 600, y: 0 } },
  ],
  edges: [
    { id: 'e1', from: 'entry', to: 'an' },
    { id: 'e2', from: 'an', to: 'se' },
    { id: 'e3', from: 'se', to: 'output' },
  ],
};

/** Lanza una ejecución en memoria y espera a que termine; devuelve el api y la lista de ejecuciones. */
async function finishedRun() {
  const api = createMemoryApi([PR]);
  const started = await api.startRun({ diagramId: 'pr', order: 'Revisa el PR #139' });
  if (!started.ok || !('runId' in started.value)) throw new Error('no arrancó');
  const runId = started.value.runId as string;
  await waitFor(async () => {
    const list = await api.listRuns();
    expect(list.ok && list.value.find((r) => r.runId === runId)?.status).toBe('succeeded');
  });
  return { api, runId, runs: await runsOf(api) };
}
const runsOf = async (api: ReturnType<typeof createMemoryApi>): Promise<RunSummary[]> => {
  const list = await api.listRuns();
  return list.ok ? list.value : [];
};

function screenWith(nav: RunsNav, runs: RunSummary[], api: ReturnType<typeof createMemoryApi>) {
  const onNav = vi.fn();
  const index: RunsIndex = { runs, diagramNames: { pr: 'Revisión de PR' }, pending: [], queue: [], loaded: true, refresh: vi.fn() };
  const props = { api, main: { version: 0, events: [], live: EMPTY_LIVE }, index, nav, onNav, subOpen: true, onToggleSub: vi.fn(), onControlMain: vi.fn(), onAnswerMain: vi.fn(), agentNames: { analista: 'Analista', seguridad: 'Seguridad' }, onExport: vi.fn() };
  const view = render(<RunsScreen {...props} />);
  return { ...props, view };
}

const states = (dlg: { getAllByRole: (role: string) => HTMLElement[] }) =>
  dlg
    .getAllByRole('listitem')
    .filter((li: HTMLElement) => li.classList.contains('orq-fixdlg__step'))
    .map((li: HTMLElement) => li.textContent);

describe('SPEC-053 · pedir corrección (interfaz)', () => {
  it('[R53.13][R53.12] el aviso del final abre «Pedir corrección»: propuesta, otro paso, qué pasará y «Corregir» abre la nueva', async () => {
    const { api, runId, runs } = await finishedRun();
    const s = screenWith({ section: 'history', runId }, runs, api);
    await userEvent.click(await screen.findByRole('button', { name: 'Pedir corrección' }, { timeout: 4000 }));
    const dlg = within(await screen.findByRole('dialog', { name: 'Pedir corrección · Revisión de PR' }));
    expect(dlg.getByRole('button', { name: 'Corregir' })).toHaveProperty('disabled', true);
    await userEvent.type(dlg.getByLabelText('¿Qué está mal?'), 'No revisa la exportación a CSV');
    await userEvent.click(dlg.getByRole('button', { name: 'Ver propuesta' }));
    // El simulado propone el último paso; va primero y marcado «recomendado».
    const radios = await dlg.findAllByRole('radio');
    expect(radios.map((r) => r.closest('label')!.textContent)).toEqual(['Seguridadrecomendadoel paso más cercano (simulado)', 'Analista']);
    expect((radios[0] as HTMLInputElement).checked).toBe(true);
    expect(states(dlg)).toEqual(['Analistase reutiliza', 'Seguridadrecibe tu corrección']);
    expect(dlg.getByText('1 pasos se ejecutan · 1 se reutilizan sin gastar tokens')).toBeTruthy();
    await userEvent.click(radios[1]!);
    expect(states(dlg)).toEqual(['Analistarecibe tu corrección', 'Seguridadse repite']);
    await userEvent.click(dlg.getByRole('button', { name: 'Corregir' }));
    await waitFor(() => expect(s.onNav).toHaveBeenCalledWith({ section: 'history', runId: expect.not.stringMatching(new RegExp(`^${runId}$`)) }));
    const newId = (s.onNav.mock.calls.at(-1)![0] as { runId: string }).runId;
    const list = await runsOf(api);
    expect(list.find((r) => r.runId === newId)).toMatchObject({ correctedFrom: runId });
    expect(list.find((r) => r.runId === runId)!.correctedBy).toEqual([newId]);
  });

  it('[R53.13] desde el detalle de un paso, ese paso es la propuesta', async () => {
    const { api, runId, runs } = await finishedRun();
    screenWith({ section: 'history', runId }, runs, api);
    const side = await screen.findByRole('complementary', {}, { timeout: 4000 });
    const step = side.getAttribute('aria-label')!;
    await userEvent.click(within(side).getByRole('button', { name: 'Pedir corrección de este paso' }));
    const dlg = within(await screen.findByRole('dialog', { name: /^Pedir corrección/ }));
    await userEvent.type(dlg.getByLabelText('¿Qué está mal?'), 'Repásalo');
    await userEvent.click(dlg.getByRole('button', { name: 'Ver propuesta' }));
    const first = (await dlg.findAllByRole('radio'))[0]!;
    expect(first.closest('label')!.textContent).toBe(`${step}recomendado`);
    await userEvent.click(dlg.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('[R53.14] la corrección enlaza con la anterior y la anterior con la corrección', async () => {
    const { api, runId } = await finishedRun();
    const fixed = await api.correctRun({ runId, text: 'Más detalle', nodeId: 'se' });
    if (!fixed.ok) throw new Error(fixed.error.message);
    const newId = fixed.value.runId;
    await waitFor(async () => expect((await runsOf(api)).find((r) => r.runId === newId)?.status).toBe('succeeded'));
    const runs = await runsOf(api);
    const s = screenWith({ section: 'history', runId: newId }, runs, api);
    expect(await screen.findByText('Corrige una ejecución anterior.', {}, { timeout: 4000 })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Ver la anterior' }));
    expect(s.onNav).toHaveBeenCalledWith({ section: 'history', runId });
    s.view.unmount();
    const o = screenWith({ section: 'history', runId }, runs, api);
    expect(await screen.findByText('Se corrigió en otra ejecución.', {}, { timeout: 4000 })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Ver la corrección' }));
    expect(o.onNav).toHaveBeenCalledWith({ section: 'history', runId: newId });
  });
});

const ev = (seq: number, body: object): RunEvent => ({ runId: 'r', seq, ts: '2026-11-05T16:00:00Z', ...body }) as RunEvent;

describe('SPEC-053 · revisión humana (interfaz)', () => {
  it('[R53.15] en el chat del nodo: «Revisa antes de seguir» y luego «¿A qué paso lo mando?» con un botón por paso', async () => {
    const onAnswer = vi.fn();
    const feedback = [
      ev(1, { type: 'node.started', nodeId: 'rev', input: { text: '## Hecho', files: [] } }),
      ev(2, { type: 'agent.question', nodeId: 'rev', questionId: 'q-1', text: '## Hecho\n\n- web nueva', options: ['Aprobar'], review: { round: 1, max: 3, phase: 'feedback' } }),
    ];
    const { unmount } = render(<NodePanel events={feedback} live={deriveLive(feedback)} nodeId="rev" nodePath={[]} label="Revisión humana" onAnswer={onAnswer} />);
    const card = within(screen.getByRole('listitem', { name: 'Revisa antes de seguir' }));
    expect(card.getByText('Vuelta 1 de 3')).toBeTruthy();
    expect(card.getByRole('heading', { name: 'Hecho' })).toBeTruthy();
    await userEvent.type(card.getByLabelText('Pedir cambios'), 'Falta la US3');
    await userEvent.click(card.getByRole('button', { name: 'Enviar cambios' }));
    expect(onAnswer).toHaveBeenCalledWith('q-1', 'Falta la US3');
    await userEvent.click(card.getByRole('button', { name: 'Aprobar y seguir' }));
    expect(onAnswer).toHaveBeenLastCalledWith('q-1', 'Aprobar');
    unmount();

    const route = [
      ...feedback,
      ev(3, { type: 'agent.answer', nodeId: 'rev', questionId: 'q-1', text: 'Falta la US3' }),
      ev(4, { type: 'agent.question', nodeId: 'rev', questionId: 'q-2', text: 'Propuesta: volver a **Tareas**.', options: ['Tareas', 'Plan'], review: { round: 1, max: 3, phase: 'route', proposal: 't', reason: 'Faltan tareas.', candidates: [{ nodeId: 'p', label: 'Plan' }, { nodeId: 't', label: 'Tareas' }] } }),
    ];
    render(<NodePanel events={route} live={deriveLive(route)} nodeId="rev" nodePath={[]} label="Revisión humana" onAnswer={onAnswer} />);
    expect(screen.getByText('Pediste cambios: Falta la US3')).toBeTruthy();
    const pick = within(screen.getByRole('listitem', { name: '¿A qué paso lo mando?' }));
    expect(pick.getByText(/El asistente propone volver a «Tareas»\. Faltan tareas\./)).toBeTruthy();
    expect(pick.getAllByRole('button').map((b) => b.textContent)).toEqual(['Tareasrecomendado', 'Plan']);
    await userEvent.click(pick.getByRole('button', { name: 'Plan' }));
    expect(onAnswer).toHaveBeenLastCalledWith('q-2', 'Plan');
  });

  it('[R53.15] en la bandeja dice qué se revisa y a dónde volver', () => {
    const { unmount } = render(<QuestionCard item={{ text: 'x', options: ['Aprobar'], review: { round: 1, max: 3, phase: 'feedback' } }} from="Revisión humana" onAnswer={vi.fn()} />);
    expect(screen.getByRole('article', { name: 'Revisar lo que ha llegado a Revisión humana' })).toBeTruthy();
    unmount();
    render(<QuestionCard item={{ text: 'x', options: ['Plan'], review: { round: 1, max: 3, phase: 'route' } }} from="Revisión humana" onAnswer={vi.fn()} />);
    expect(screen.getByRole('article', { name: 'Elegir a qué paso volver desde Revisión humana' })).toBeTruthy();
  });

  it('[R53.16] la paleta añade una Revisión humana; el inspector elige quién decide el destino y lista los pasos', async () => {
    let d = disconnect(createDiagram('principal', 'Principal'), [], 'entry->output');
    const a = addNode(d, [], { kind: 'agent', agentId: 'disenador', label: 'Diseñador', position: { x: 200, y: 120 } });
    d = connect(a.diagram, [], 'entry', a.id).diagram;
    const api = createMemoryApi([d]);
    render(<App initialProject="Juego" api={api} agents={[{ id: 'disenador', name: 'Diseñador', description: 'Diseña' }]} confirm={() => true} />);
    await userEvent.click(screen.getByRole('button', { name: /^Proyecto «/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Abrir proyecto' }));
    await screen.findByRole('button', { name: 'Diagrama «Principal»' });
    await userEvent.click(await screen.findByRole('button', { name: '+ Revisión humana' }));
    const card = await screen.findByLabelText(/^Revisión «Revisión humana»/);
    expect(within(card).getByText('lo reviso yo')).toBeTruthy();
    fireEvent.click(card);
    expect(((await screen.findByLabelText('Cómo decide')) as HTMLSelectElement).value).toBe('human');
    expect(screen.queryByLabelText('Criterio para aprobar')).toBeNull();
    expect(screen.getByText(/La ejecución se para aquí hasta que apruebas|La ejecución se para aquí hasta que apruebes/)).toBeTruthy();
    // Aún no está conectada: no hay pasos a los que volver.
    expect(screen.getByText(/No hay ningún paso al que volver/)).toBeTruthy();
    const routes = within(screen.getByRole('radiogroup', { name: 'Si pides cambios' }));
    expect((routes.getByLabelText('Me propone y confirmo') as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText(/propone a qué paso volver y tú lo confirmas/)).toBeTruthy();
    await userEvent.click(routes.getByLabelText('Decide solo'));
    await waitFor(() => expect((screen.getByLabelText('Decide solo') as HTMLInputElement).checked).toBe(true));
    expect(screen.getByText(/elige el paso y la ejecución sigue/)).toBeTruthy();
    // Los textos son los del modo humano, no los del revisor.
    expect(screen.queryByText(/Claude verá: lo que dijo el revisor/)).toBeNull();
    expect(screen.getByText(/déjalo sin conectar y el asistente elegirá/)).toBeTruthy();
    // La tarjeta lleva el ojo.
    expect(card.querySelector('.lucide-eye')).toBeTruthy();
    await userEvent.selectOptions(screen.getByLabelText('Cómo decide'), 'verdict');
    await waitFor(() => expect(screen.getByLabelText('Criterio para aprobar')).toBeTruthy());
    // También se suelta en el lienzo arrastrándola desde la paleta.
    fireEvent.drop(screen.getByTestId('canvas'), { dataTransfer: { getData: (k: string) => (k === DRAG_TYPE ? 'humanReview' : ''), types: [DRAG_TYPE] }, clientX: 10, clientY: 10 });
    await waitFor(() => expect(screen.getAllByLabelText(/^Revisión «Revisión humana/).length).toBeGreaterThan(1));
  });
});
