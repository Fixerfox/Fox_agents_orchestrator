// @vitest-environment jsdom
import './setup';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MockAgent, MockDecider, Orchestrator, type Diagram, type RunEvent } from '@orquestador/core';
import { EMPTY_LIVE, type RunSummary } from '@orquestador/editor';
import { App } from '../src/App';
import { RunsScreen, type RunsNav } from '../src/RunsScreen';
import { createMemoryApi } from '../src/memoryApi';
import type { RunsIndex } from '../src/useRunsIndex';

const T0 = Date.parse('2026-11-05T08:30:00.000Z');
const at = (s: number) => new Date(T0 + s * 1000).toISOString();

/** Diagrama «Revisión de PR»: Entrada → Analista → Seguridad → Salida. */
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
const INF: Diagram = { ...PR, id: 'inf', name: 'Informe semanal' };

function failedRun(runId: string): RunEvent[] {
  let seq = 0;
  const e = (s: number, body: Record<string, unknown>) => ({ runId, seq: ++seq, ts: at(s), ...body }) as unknown as RunEvent;
  return [
    e(0, { type: 'run.started', diagramId: 'pr' }),
    e(0, { type: 'node.started', nodeId: 'entry', input: { text: 'Revisa el PR #139' } }),
    e(1, { type: 'node.finished', nodeId: 'entry', status: 'succeeded', output: { text: 'Revisa el PR #139' } }),
    e(1, { type: 'node.started', nodeId: 'an' }),
    e(1, { type: 'agent.request', nodeId: 'an', agentId: 'analista', attempt: 1, input: { text: 'Revisa el PR #139' } }),
    e(5, { type: 'token.stream', nodeId: 'an', text: 'El PR añade la exportación a CSV.' }),
    e(10, { type: 'node.finished', nodeId: 'an', status: 'succeeded', output: { text: 'El PR añade la exportación a CSV.' } }),
    e(10, { type: 'node.started', nodeId: 'se' }),
    e(10, { type: 'agent.request', nodeId: 'se', agentId: 'seguridad', attempt: 1, input: { text: 'El PR añade la exportación a CSV.' } }),
    e(20, { type: 'node.retrying', nodeId: 'se', attempt: 1, max: 3, message: 'La API no respondió a tiempo' }),
    e(30, { type: 'error', nodeId: 'se', message: 'La API no respondió a tiempo', retriable: false }),
    e(30, { type: 'node.finished', nodeId: 'se', status: 'failed' }),
    e(31, { type: 'run.finished', status: 'failed', reason: 'Se agotaron los 3 intentos' }),
  ];
}

/** Abre el modal de la ejecución con «Ver resumen» (las pestañas viven ahí) [R44.5]. */
async function openDetail() {
  await userEvent.click(await screen.findByRole('button', { name: 'Ver resumen' }, { timeout: 4000 }));
  return within(await screen.findByRole('dialog', { name: /^Resultado de «/ }));
}

const sum = (o: Partial<RunSummary> & Pick<RunSummary, 'runId' | 'status' | 'diagramId'>): RunSummary => ({
  startedAt: at(0),
  usage: { inputTokens: 1200, outputTokens: 300, costUsd: 0.09 },
  eventCount: 13,
  ...o,
});
const PAST = [
  { summary: sum({ runId: 'r17', diagramId: 'pr', status: 'failed', finishedAt: at(31), order: 'Revisa el PR #139', reason: 'Se agotaron los 3 intentos' }), events: failedRun('r17') },
  { summary: sum({ runId: 'r6', diagramId: 'inf', status: 'succeeded', startedAt: at(-86400), finishedAt: at(-86300), order: 'Informe de la semana 44' }), events: [] as RunEvent[] },
  { summary: sum({ runId: 'r3', diagramId: 'inf', status: 'cancelled', startedAt: at(-90000), finishedAt: at(-89990), order: 'Informe de prueba' }), events: [] as RunEvent[] },
];

/** Monta la pantalla sola con un índice fijo; la navegación queda registrada. */
function screenWith(nav: RunsNav, over: Partial<RunsIndex> = {}, api = createMemoryApi([PR, INF], { pastRuns: PAST })) {
  const onNav = vi.fn();
  const index: RunsIndex = { runs: PAST.map((p) => p.summary), diagramNames: { pr: 'Revisión de PR', inf: 'Informe semanal' }, pending: [], queue: [], loaded: true, refresh: vi.fn(), ...over };
  const props = { api, main: { version: 0, events: [], live: EMPTY_LIVE }, index, nav, onNav, subOpen: true, onToggleSub: vi.fn(), onControlMain: vi.fn(), onAnswerMain: vi.fn(), agentNames: { analista: 'Analista de código', seguridad: 'Revisor de seguridad' }, onExport: vi.fn(), now: () => T0 + 60_000 };
  const view = render(<RunsScreen {...props} />);
  return { ...props, view, api };
}

describe('SPEC-035 · historial de ejecuciones [R35.7]', () => {
  it('[R35.7] tabla con estado, diagrama, entrada, duración, tokens y coste, de la más reciente a la más antigua', () => {
    screenWith({ section: 'history' });
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows).toHaveLength(3);
    const first = within(rows[0]!);
    expect(first.getByText('Fallida')).toBeTruthy();
    expect(first.getByText('Revisión de PR')).toBeTruthy();
    expect(first.getByText('Revisa el PR #139')).toBeTruthy();
    expect(first.getByText('31 s')).toBeTruthy();
    expect(first.getByText(/^1\.?500$/)).toBeTruthy();
    expect(first.getByText('0,090 $')).toBeTruthy();
    expect(within(rows[2]!).getByText('Cancelada')).toBeTruthy();
  });

  it('[R35.7] filtra por estado con su número, por diagrama y por texto; sin resultados lo dice', async () => {
    screenWith({ section: 'history' });
    const tabs = within(screen.getByRole('tablist', { name: 'Filtrar por estado' }));
    expect(tabs.getByRole('tab', { name: /Con error\s*1/ })).toBeTruthy();
    await userEvent.click(tabs.getByRole('tab', { name: /Con error/ }));
    expect(screen.getAllByRole('row')).toHaveLength(2);
    await userEvent.click(tabs.getByRole('tab', { name: /Todas/ }));
    await userEvent.selectOptions(screen.getByLabelText('Diagrama'), 'inf');
    expect(screen.getAllByRole('row')).toHaveLength(3);
    await userEvent.type(screen.getByLabelText('Buscar por diagrama o entrada'), 'PRUEBA');
    expect(screen.getAllByRole('row')).toHaveLength(2);
    await userEvent.type(screen.getByLabelText('Buscar por diagrama o entrada'), 'zzz');
    expect(screen.getByText('No hay ejecuciones con estos filtros.')).toBeTruthy();
  });

  it('[R35.7] pulsar una fila abre la ejecución desde Historial', async () => {
    const { onNav } = screenWith({ section: 'history' });
    await userEvent.click(screen.getByText('Informe de la semana 44'));
    expect(onNav).toHaveBeenLastCalledWith({ section: 'history', runId: 'r6' });
    await userEvent.click(screen.getByRole('button', { name: /^Abrir Revisión de PR · / }));
    expect(onNav).toHaveBeenLastCalledWith({ section: 'history', runId: 'r17' });
  });

  it('[R35.7] sin ninguna ejecución invita a ejecutar', () => {
    screenWith({ section: 'history' }, { runs: [] });
    expect(screen.getByText(/Todavía no hay ejecuciones en este proyecto/)).toBeTruthy();
  });
});

describe('SPEC-035 · submenú [R35.4]', () => {
  it('[R35.4] tres apartados con su número; el activo con aria-current; las ejecuciones en curso como accesos', async () => {
    const running = sum({ runId: 'r20', diagramId: 'inf', status: 'running', startedAt: at(30), order: 'Informe de la semana 45' });
    const { onNav } = screenWith({ section: 'history' }, { runs: [running, ...PAST.map((p) => p.summary)], pending: [{ runId: 'r20', questionId: 'q', nodeId: 'se', nodePath: [], text: '¿Sigo?' }] });
    const sub = within(screen.getByRole('navigation', { name: 'Apartados de Ejecuciones' }));
    expect(sub.getByRole('button', { name: /^En directo\s*1$/ })).toBeTruthy();
    expect(sub.getByRole('button', { name: /^Necesitan tu respuesta\s*1$/ })).toBeTruthy();
    expect(sub.getByRole('button', { name: /^Historial\s*4$/ }).getAttribute('aria-current')).toBe('page');
    await userEvent.click(sub.getByRole('button', { name: 'Abrir Informe semanal' }));
    expect(onNav).toHaveBeenLastCalledWith({ section: 'live', runId: 'r20' });
    await userEvent.click(sub.getByRole('button', { name: /^Necesitan tu respuesta/ }));
    expect(onNav).toHaveBeenLastCalledWith({ section: 'inbox' });
  });

});

describe('SPEC-035 · En directo y preguntas [R35.5][R35.6]', () => {
  const running = sum({ runId: 'r20', diagramId: 'inf', status: 'running', startedAt: at(30), order: 'Informe de la semana 45', usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.01 } });

  it('[R35.5] una tarjeta por ejecución en curso con entrada, duración, coste y controles', async () => {
    const { onNav, api } = screenWith({ section: 'live' }, { runs: [running, ...PAST.map((p) => p.summary)] });
    const card = within(screen.getByRole('article', { name: 'Informe semanal' }));
    expect(card.getByText('Informe de la semana 45')).toBeTruthy();
    expect(card.getByText(/30 s · 0,010 \$/)).toBeTruthy();
    expect(card.getByText('Ábrela para ver qué está haciendo.')).toBeTruthy();
    const spy = vi.spyOn(api, 'controlRun');
    await userEvent.click(card.getByRole('button', { name: 'Pausar' }));
    expect(spy).toHaveBeenCalledWith({ runId: 'r20', action: 'pause' });
    await userEvent.click(card.getByRole('button', { name: 'Cancelar' }));
    expect(spy).toHaveBeenLastCalledWith({ runId: 'r20', action: 'cancel' });
    await userEvent.click(card.getByRole('button', { name: 'Abrir Informe semanal' }));
    expect(onNav).toHaveBeenLastCalledWith({ section: 'live', runId: 'r20' });
  });

  it('[R35.5] sin nada en marcha lo explica', () => {
    screenWith({ section: 'live' });
    expect(screen.getByText(/No hay nada ejecutándose/)).toBeTruthy();
  });

  it('[R35.6] las preguntas de otra ejecución se responden a esa ejecución; sin preguntas lo dice', async () => {
    const pending = [{ runId: 'r20', questionId: 'q9', nodeId: 'se', nodePath: [], text: '¿Incluyo costes?', options: ['Sí', 'No'] }];
    const { api, onAnswerMain, onNav } = screenWith({ section: 'inbox' }, { runs: [running], pending });
    const item = within(await screen.findByRole('article', { name: 'Seguridad pregunta' }));
    expect(item.getByText('en Informe semanal')).toBeTruthy();
    const spy = vi.spyOn(api, 'answerRun');
    await userEvent.click(item.getByRole('button', { name: 'Sí' }));
    expect(spy).toHaveBeenCalledWith({ runId: 'r20', questionId: 'q9', text: 'Sí' });
    expect(onAnswerMain).not.toHaveBeenCalled();
    await userEvent.click(item.getByRole('button', { name: 'Abrir ejecución' }));
    expect(onNav).toHaveBeenLastCalledWith({ section: 'inbox', runId: 'r20' });
  });

  it('[R35.6] sin preguntas pendientes lo dice', () => {
    screenWith({ section: 'inbox' });
    expect(screen.getByText('No hay preguntas pendientes.')).toBeTruthy();
  });
});

describe('SPEC-035 · vista de una ejecución [R35.8][R35.9][R35.10]', () => {
  it('[R35.8] cabecera con diagrama, estado, entrada y cifras; aviso del fallo; Volver y la ruta', async () => {
    const { onNav } = screenWith({ section: 'history', runId: 'r17' });
    expect(await screen.findByRole('heading', { name: 'Revisión de PR' })).toBeTruthy();
    expect(screen.getAllByText('Revisa el PR #139').length).toBeGreaterThan(0);
    expect(screen.getByRole('alert').textContent).toMatch(/Motivo: Se agotaron los 3 intentos/);
    expect(screen.queryByRole('button', { name: 'Pausar' })).toBeNull();
    const crumbs = within(screen.getByRole('navigation', { name: 'Ruta' }));
    expect(crumbs.getByText('Revisión de PR').getAttribute('aria-current')).toBe('page');
    await userEvent.click(screen.getByRole('button', { name: 'Volver a Historial' }));
    expect(onNav).toHaveBeenLastCalledWith({ section: 'history' });
    await userEvent.click(crumbs.getByRole('button', { name: 'Ejecuciones' }));
    expect(onNav).toHaveBeenLastCalledWith({ section: 'history' });
  });

  it('[R35.9] lienzo con el diagrama de la ejecución y su estado; por defecto, los mensajes del paso que falló', async () => {
    screenWith({ section: 'history', runId: 'r17' });
    expect(await screen.findByLabelText(/^Agente «Seguridad».*fallido/)).toBeTruthy();
    expect(screen.getByLabelText(/^Agente «Analista».*correcto/)).toBeTruthy();
    const panel = within(await screen.findByRole('region', { name: 'Ejecución de «Seguridad»' }));
    expect(panel.getAllByText(/La API no respondió a tiempo/).length).toBeGreaterThan(0);
  });

  it('[R35.10] el cronograma tiene una fila por paso con sus marcas y elegirla cambia los mensajes', async () => {
    screenWith({ section: 'history', runId: 'r17' });
    const box = await openDetail();
    // terminada, el modal se abre en «Resumen» [R38.23][R44.5]
    if (box.getByRole('tab', { name: 'Cronograma' }).getAttribute('aria-selected') !== 'true') await userEvent.click(box.getByRole('tab', { name: 'Cronograma' }));
    const row = await box.findByRole('button', { name: 'Seguridad: fallido, 20 s' });
    expect(row.querySelectorAll('.orq-gantt__mark')).toHaveLength(2);
    expect(box.getByRole('button', { name: 'Entrada: correcto, 1 s' })).toBeTruthy();
    await userEvent.click(box.getByRole('button', { name: 'Analista: correcto, 9 s' }));
    const panel = within(await screen.findByRole('region', { name: 'Ejecución de «Analista»' }));
    expect(panel.getAllByText('El PR añade la exportación a CSV.').length).toBeGreaterThan(0);
  });

  it('[R35.10] Historial muestra el registro, Resultado explica que no terminó y Archivos que no hay cambios', async () => {
    const { onExport } = screenWith({ section: 'history', runId: 'r17' });
    const box = await openDetail();
    // terminada, el modal se abre en «Resumen» [R38.23][R44.5]
    if (box.getByRole('tab', { name: 'Cronograma' }).getAttribute('aria-selected') !== 'true') await userEvent.click(box.getByRole('tab', { name: 'Cronograma' }));
    await box.findByRole('button', { name: /^Seguridad:/ });
    await userEvent.click(box.getByRole('tab', { name: 'Historial' }));
    const log = within(screen.getByRole('region', { name: 'Registro de la ejecución' }));
    await userEvent.click(log.getByRole('button', { name: /Exportar/ }));
    expect(onExport).toHaveBeenCalledWith('r17', expect.stringContaining('"run.finished"'));
    await userEvent.click(box.getByRole('tab', { name: 'Resultado' }));
    expect(screen.getByText('Sin resultado: la ejecución no terminó.')).toBeTruthy();
    expect(within(screen.getByText('Duración').parentElement!).getByText('31 s')).toBeTruthy();
    await userEvent.click(box.getByRole('tab', { name: 'Archivos' }));
    expect(screen.getByText(/no ha creado ni modificado archivos/)).toBeTruthy();
  });

  it('[R35.8] una ejecución interrumpida no se puede pausar y su duración acaba en su último evento', async () => {
    const events = failedRun('r9').slice(0, 10);
    const summary = sum({ runId: 'r9', diagramId: 'pr', status: 'interrupted', order: 'Revisa el PR #140' });
    screenWith({ section: 'history', runId: 'r9' }, { runs: [summary] }, createMemoryApi([PR], { pastRuns: [{ summary, events }] }));
    expect(await screen.findByText('Interrumpida', { selector: '.orq-pill' })).toBeTruthy();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Pausar' })).toBeNull();
    expect(screen.getByText(/^20 s · /, { selector: '.orq-run__figures' })).toBeTruthy();
    expect(screen.queryByRole('article', { name: /pregunta$/ })).toBeNull();
  });

  it('[R35.9] si el diagrama ya no existe lo dice y el resto sigue disponible', async () => {
    screenWith({ section: 'history', runId: 'r17' }, {}, createMemoryApi([], { pastRuns: PAST }));
    expect(await screen.findByText(/El diagrama de esta ejecución ya no existe/)).toBeTruthy();
    await userEvent.click((await openDetail()).getByRole('tab', { name: 'Cronograma' }));
    expect(await screen.findByRole('button', { name: 'se: fallido, 20 s' })).toBeTruthy();
  });
});

describe('SPEC-035 · en la aplicación [R35.4][R35.11][R35.12]', () => {
  const rail = () => within(screen.getByRole('navigation', { name: 'Secciones' }));

  it('[R35.4] al entrar se ve Historial; pulsar Ejecuciones otra vez oculta y muestra el submenú', async () => {
    render(<App initialProject="Proyecto" api={createMemoryApi([PR, INF], { pastRuns: PAST })} agents={[]} confirm={() => true} />);
    await userEvent.click(rail().getByRole('button', { name: 'Ejecuciones' }));
    const sub = within(await screen.findByRole('navigation', { name: 'Apartados de Ejecuciones' }));
    await waitFor(() => expect(sub.getByRole('button', { name: /^Historial\s*3$/ }).getAttribute('aria-current')).toBe('page'));
    expect(screen.getAllByRole('row')).toHaveLength(4);
    await userEvent.click(rail().getByRole('button', { name: 'Ejecuciones' }));
    expect(screen.queryByRole('navigation', { name: 'Apartados de Ejecuciones' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Mostrar el submenú de Ejecuciones' }));
    expect(screen.getByRole('navigation', { name: 'Apartados de Ejecuciones' })).toBeTruthy();
  });

  it('[R35.4] en una ventana estrecha el submenú empieza oculto', async () => {
    const mm = window.matchMedia;
    window.matchMedia = ((q: string) => ({ matches: true, media: q, addEventListener: () => {}, removeEventListener: () => {} })) as unknown as typeof window.matchMedia;
    try {
      render(<App initialProject="Proyecto" api={createMemoryApi([PR], { pastRuns: PAST })} agents={[]} confirm={() => true} />);
      await userEvent.click(rail().getByRole('button', { name: 'Ejecuciones' }));
      expect(screen.queryByRole('navigation', { name: 'Apartados de Ejecuciones' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Mostrar el submenú de Ejecuciones' })).toBeTruthy();
    } finally {
      window.matchMedia = mm;
    }
  });

  it('[R35.11][R35.12] Ejecutar abre la nueva ejecución; abrir otra del historial no deja de seguirla', async () => {
    let release!: () => void;
    const agent = new MockAgent({ creador: { output: 'x', waitFor: new Promise<void>((r) => (release = r)) }, revisor: { output: 'y' } });
    const api = createMemoryApi([], { pastRuns: PAST, orchestrator: new Orchestrator({ getAdapter: () => agent, decider: new MockDecider() }) });
    render(<App initialProject="Proyecto" api={api} agents={[{ id: 'creador', name: 'Creador' }, { id: 'revisor', name: 'Revisor' }]} confirm={() => true} />);
    await userEvent.click(screen.getByRole('button', { name: /^Proyecto «/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Abrir proyecto' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Bucle de revisión' }));
    await screen.findByLabelText(/^Bucle «Revisión»/);
    await userEvent.click(screen.getByRole('button', { name: 'Lanzar…' }));
    const d = within(await screen.findByRole('dialog', { name: /^Ejecutar «/ }));
    await userEvent.type(d.getByLabelText('Entrada'), 'haz un juego');
    await userEvent.click(d.getByRole('button', { name: 'Lanzar y ver la ejecución' }));
    // Se abre la vista de la nueva ejecución, con «Volver» a En directo [R35.11].
    expect(await screen.findByRole('heading', { name: 'Bucle de revisión' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Volver a En directo' })).toBeTruthy();
    const sub = within(screen.getByRole('navigation', { name: 'Apartados de Ejecuciones' }));
    await waitFor(() => expect(sub.getByRole('button', { name: 'Abrir Bucle de revisión' })).toBeTruthy());
    // Abro una ejecución antigua mientras la nueva sigue [R35.12].
    await userEvent.click(sub.getByRole('button', { name: /^Historial/ }));
    await userEvent.click(await screen.findByText('Revisa el PR #139'));
    // Ese diagrama no está en este proyecto: se dice, y lo demás de la ejecución sigue disponible.
    expect(await screen.findByRole('heading', { name: 'Diagrama eliminado' })).toBeTruthy();
    expect(await screen.findByText(/El diagrama de esta ejecución ya no existe/)).toBeTruthy();
    // La barra sigue mostrando la ejecución en curso, que no se ha dejado de seguir.
    expect(screen.getAllByText('Ejecutando').length).toBeGreaterThan(0);
    release();
    await waitFor(() => expect(screen.getAllByText('Terminada').length).toBeGreaterThan(0));
    expect([...api.runs.values()][0]!.subscribed).toBe(true);
    await userEvent.click(sub.getByRole('button', { name: /^En directo/ }));
    expect(screen.getByText(/No hay nada ejecutándose/)).toBeTruthy();
  });
});

describe('SPEC-035 · estado verdadero y diagrama del momento [R35.13][R35.14][R35.15][R35.16]', () => {
  /** Como en la captura: «qa» estaba trabajando y había preguntado; la app se cerró sin `run.finished`. */
  function cutRun(runId: string): RunEvent[] {
    let seq = 0;
    const e = (s: number, body: Record<string, unknown>) => ({ runId, seq: ++seq, ts: at(s), ...body }) as unknown as RunEvent;
    return [
      e(0, { type: 'run.started', diagramId: 'pr' }),
      e(0, { type: 'node.started', nodeId: 'entry', input: { text: 'Crea una criatura' } }),
      e(1, { type: 'node.finished', nodeId: 'entry', status: 'succeeded', output: { text: 'Crea una criatura' } }),
      e(1, { type: 'node.started', nodeId: 'an' }),
      e(1, { type: 'agent.request', nodeId: 'an', agentId: 'analista', attempt: 1, input: { text: 'Crea una criatura' } }),
      e(500, { type: 'tool.called', nodeId: 'an', tool: 'Grep', input: {} }),
      e(1041, { type: 'agent.question', nodeId: 'an', questionId: 'q1', text: '¿Uso la paleta nueva?', options: ['Sí', 'No'] }),
    ];
  }
  const cut = sum({ runId: 'r30', diagramId: 'pr', status: 'interrupted', order: 'Crea una criatura', usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 } });

  it('[R35.14][R35.15] una ejecución interrumpida no muestra nada «ejecutando» ni preguntas por contestar', async () => {
    screenWith({ section: 'history', runId: 'r30' }, { runs: [cut] }, createMemoryApi([PR], { pastRuns: [{ summary: cut, events: cutRun('r30') }] }));
    expect(await screen.findByLabelText(/^Agente «Analista».*interrumpido/)).toBeTruthy();
    expect(screen.queryByText(/ejecutando/)).toBeNull();
    expect(screen.queryByText(/esperando tu respuesta/)).toBeNull();
    expect(screen.getByText('Interrumpida', { selector: '.orq-pill' })).toBeTruthy();
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toMatch(/Interrumpida/);
    expect(alert.textContent).toMatch(/se cerró o se detuvo antes de que terminara/);
    expect(alert.textContent).not.toMatch(/Falló/);
    expect(screen.getByText(/17 min 21 s · sin datos de uso/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Pausar' })).toBeNull();
    expect(screen.queryByRole('article', { name: /pregunta$/ })).toBeNull();
    const panel = within(screen.getByRole('region', { name: 'Ejecución de «Analista»' }));
    expect(panel.getByText('interrumpido')).toBeTruthy();
    expect(panel.getByText(/esta pregunta no se puede contestar/)).toBeTruthy();
    expect(panel.queryByRole('button', { name: 'Sí' })).toBeNull();
    await userEvent.click((await openDetail()).getByRole('tab', { name: 'Cronograma' }));
    const bar = screen.getByRole('button', { name: 'Analista: interrumpido, 17 min 20 s' });
    expect(bar.querySelector('.orq-gantt__bar.is-interrupted')).toBeTruthy();
    await userEvent.click(screen.getByRole('tab', { name: 'Resultado' }));
    expect(screen.getAllByText('sin datos de uso')).toHaveLength(2);
  });

  it('[R35.15] en el historial, una interrumpida sin uso registrado dice «sin datos de uso», no 0', () => {
    screenWith({ section: 'history' }, { runs: [cut] });
    const row = within(screen.getAllByRole('row')[1]!);
    expect(row.getByText('Interrumpida')).toBeTruthy();
    expect(row.getByText('sin datos de uso')).toBeTruthy();
    expect(row.queryByText('0,000 $')).toBeNull();
  });

  it('[R35.13] no se afirma el estado de una ejecución ajena hasta tener la lista; los eventos solos no la dan por viva', async () => {
    const api = createMemoryApi([PR], { pastRuns: [{ summary: cut, events: cutRun('r30') }] });
    const { view, ...props } = screenWith({ section: 'history', runId: 'r30' }, { runs: [], loaded: false }, api);
    expect(await screen.findByText('Cargando la ejecución…')).toBeTruthy();
    // La lista llega y no la tiene como en marcha: se ve como interrumpida, aunque sus eventos no tengan final.
    view.rerender(<RunsScreen {...props} index={{ ...props.index, runs: [], loaded: true }} />);
    expect(await screen.findByText('Interrumpida', { selector: '.orq-pill' })).toBeTruthy();
    // No hay controles de una ejecución viva; el único «Cancelar» es el de darla por cerrada [R41.4].
    expect(screen.queryByRole('button', { name: 'Pausar' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Cancelar' }).getAttribute('title')).toBe('Darla por cerrada como cancelada.');
  });

  it('[R35.15] una fallida sin motivo lo dice', async () => {
    const events = failedRun('r40').map((e) => (e.type === 'run.finished' ? ({ ...e, reason: undefined } as RunEvent) : e));
    const s = sum({ runId: 'r40', diagramId: 'pr', status: 'failed', order: 'x' });
    screenWith({ section: 'history', runId: 'r40' }, { runs: [s] }, createMemoryApi([PR], { pastRuns: [{ summary: s, events }] }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/Falló/);
    expect(alert.textContent).toMatch(/Sin motivo registrado/);
  });

  it('[R35.16] se ve el diagrama tal como estaba al ejecutarse, aunque luego cambiara', async () => {
    const then: Diagram = { ...PR, name: 'Revisión de PR (v1)', nodes: PR.nodes.map((n) => (n.id === 'se' ? { ...n, label: 'Seguridad v1' } : n)) };
    const s = { ...PAST[0]!.summary, diagramName: 'Revisión de PR (v1)' };
    screenWith({ section: 'history', runId: 'r17' }, { runs: [s] }, createMemoryApi([PR], { pastRuns: [{ summary: s, events: failedRun('r17'), diagram: then }] }));
    expect(await screen.findByRole('heading', { name: 'Revisión de PR (v1)' })).toBeTruthy();
    expect(await screen.findByLabelText(/^Agente «Seguridad v1»/)).toBeTruthy();
    expect(screen.queryByLabelText(/^Agente «Seguridad» /)).toBeNull();
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('[R35.16] una ejecución antigua sin copia usa el diagrama actual y avisa', async () => {
    screenWith({ section: 'history', runId: 'r17' });
    expect(await screen.findByLabelText(/^Agente «Seguridad»/)).toBeTruthy();
    expect(screen.getByRole('note').textContent).toMatch(/se muestra el diagrama actual, que puede no ser el de entonces/);
  });
});

describe('SPEC-035 con la revisión de SPEC-034 [R35.3][R35.9][R35.16]', () => {
  it('[R35.3][R35.16] una ejecución con retorno se ve con su revisión, sus vueltas y su diagrama del momento', async () => {
    let n = 0;
    const agent = new MockAgent({
      creador: { output: 'entrega' },
      revisor: { output: () => (++n === 1 ? 'Falta el color.\nVEREDICTO: RECHAZADO' : 'Todo bien.\nVEREDICTO: APROBADO') },
    });
    const api = createMemoryApi([], { orchestrator: new Orchestrator({ getAdapter: () => agent, decider: new MockDecider() }) });
    render(<App initialProject="Proyecto" api={api} agents={[{ id: 'creador', name: 'Creador' }, { id: 'revisor', name: 'Revisor' }]} confirm={() => true} />);
    await userEvent.click(screen.getByRole('button', { name: /^Proyecto «/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Abrir proyecto' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Crear y revisar con QA' }));
    await userEvent.click(screen.getByRole('button', { name: 'Lanzar…' }));
    const d = within(await screen.findByRole('dialog', { name: /^Ejecutar «/ }));
    await userEvent.type(d.getByLabelText('Entrada'), 'un dragón');
    await userEvent.click(d.getByRole('button', { name: 'Lanzar y ver la ejecución' }));
    await waitFor(() => expect(screen.getAllByText('Terminada').length).toBeGreaterThan(0));
    expect(await screen.findByRole('heading', { name: 'Crear y revisar con QA' })).toBeTruthy();
    const box = await openDetail();
    // terminada, el modal se abre en «Resumen» [R38.23][R44.5]
    if (box.getByRole('tab', { name: 'Cronograma' }).getAttribute('aria-selected') !== 'true') await userEvent.click(box.getByRole('tab', { name: 'Cronograma' }));
    const row = await box.findByRole('button', { name: /^Revisión: correcto/ });
    expect([...row.querySelectorAll('.orq-gantt__mark')].map((m) => m.getAttribute('title'))).toEqual(['Vuelta: Revisión rechazada · vuelta 1 de 3', 'Vuelta: Pasada 2', 'Vuelta: Revisión aprobada · vuelta 2 de 3']);
    expect(box.getByRole('button', { name: /^creador: correcto/ })).toBeTruthy();
    expect(screen.queryByText(/ejecutando/)).toBeNull();
    const runId = [...api.runs.keys()][0]!;
    const snap = await api.runDiagram(runId);
    expect(snap.ok && snap.value?.nodes.some((x) => x.kind === 'review')).toBe(true);
  });

  it('[R35.17][R15.14] el paso devuelto tiene un tramo por pasada y sus mensajes se separan por pasada', async () => {
    let n = 0;
    const agent = new MockAgent({
      creador: { output: 'entrega' },
      revisor: { output: () => (++n === 1 ? 'Falta el color.\nVEREDICTO: RECHAZADO' : 'Todo bien.\nVEREDICTO: APROBADO') },
    });
    const api = createMemoryApi([], { orchestrator: new Orchestrator({ getAdapter: () => agent, decider: new MockDecider() }) });
    render(<App initialProject="Proyecto" api={api} agents={[{ id: 'creador', name: 'Creador' }, { id: 'revisor', name: 'Revisor' }]} confirm={() => true} />);
    await userEvent.click(screen.getByRole('button', { name: /^Proyecto «/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Abrir proyecto' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Crear y revisar con QA' }));
    await userEvent.click(screen.getByRole('button', { name: 'Lanzar…' }));
    const d = within(await screen.findByRole('dialog', { name: /^Ejecutar «/ }));
    await userEvent.type(d.getByLabelText('Entrada'), 'un dragón');
    await userEvent.click(d.getByRole('button', { name: 'Lanzar y ver la ejecución' }));
    await waitFor(() => expect(screen.getAllByText('Terminada').length).toBeGreaterThan(0));
    const box = await openDetail();
    // terminada, el modal se abre en «Resumen» [R38.23][R44.5]
    await userEvent.click(box.getByRole('tab', { name: 'Cronograma' }));
    const row = await box.findByRole('button', { name: /^creador: correcto/ });
    // Dos tramos, uno por pasada, y la marca de quién lo devolvió.
    expect([...row.querySelectorAll('.orq-gantt__bar')].map((b) => b.getAttribute('data-pass'))).toEqual(['1', '2']);
    expect([...row.querySelectorAll('.orq-gantt__mark')].map((m) => m.getAttribute('title'))).toContain('Vuelta: Pasada 2 · devuelto por Revisión');
    await userEvent.click(row);
    const panel = within(screen.getByRole('region', { name: 'Ejecución de «creador»' }));
    expect(panel.getByRole('separator', { name: 'Pasada 2' }).textContent).toContain('Pasada 2 · devuelto por Revisión');
    expect(panel.getByText('Recibió (pasada 1, intento 1)')).toBeTruthy();
    expect(panel.getByText('Recibió (pasada 2, intento 1)')).toBeTruthy();
    expect(panel.queryByText(/^Recibió \(intento/)).toBeNull();
  });
});

describe('SPEC-041 · reanudar o cancelar [R41.4][R41.5]', () => {
  it('[R41.4] una fallida ofrece «Reanudar» (sin «Cancelar») y abre la ejecución nueva; una terminada bien no lo ofrece', async () => {
    const api = createMemoryApi([PR, INF], { pastRuns: PAST });
    const s = screenWith({ section: 'history', runId: 'r17' }, {}, api);
    await screen.findByText('Fallida', { selector: '.orq-pill' });
    expect(screen.queryByRole('button', { name: 'Cancelar' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Reanudar' }));
    await waitFor(() => expect(s.onNav).toHaveBeenCalledWith({ section: 'history', runId: expect.not.stringMatching(/^r17$/) }));
    expect(s.index.refresh).toHaveBeenCalled();
    s.view.unmount();
    screenWith({ section: 'history', runId: 'r6' }, {}, api);
    await screen.findByText('Completada', { selector: '.orq-pill' }).catch(() => undefined);
    expect(screen.queryByRole('button', { name: 'Reanudar' })).toBeNull();
  });

  it('[R41.4][R41.5] la nueva enlaza con la anterior y el Resumen marca lo reutilizado; la anterior enlaza con la nueva', async () => {
    const api = createMemoryApi([PR, INF], { pastRuns: PAST });
    const r = await api.resumeRun('r17');
    if (!r.ok) throw new Error(r.error.message);
    const newId = r.value.runId;
    await waitFor(async () => {
      const list = await api.listRuns();
      expect(list.ok && list.value.find((x) => x.runId === newId)?.status).not.toBe('running');
    });
    const list = await api.listRuns();
    const runs = list.ok ? list.value : [];
    const s = screenWith({ section: 'history', runId: newId }, { runs }, api);
    const note = await screen.findByRole('note', { name: '' }).catch(() => screen.getByText(/Reanuda una ejecución anterior/));
    expect(note.textContent).toMatch(/Reanuda una ejecución anterior/);
    expect((await openDetail()).getByText('reutilizado de la anterior')).toBeTruthy();
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: 'Ver la anterior' }));
    expect(s.onNav).toHaveBeenCalledWith({ section: 'history', runId: 'r17' });
    s.view.unmount();
    screenWith({ section: 'history', runId: 'r17' }, { runs }, api);
    expect(await screen.findByText('Se reanudó en otra ejecución.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reanudar' })).toBeNull();
  });

  it('[R41.4][R41.3] una interrumpida ofrece «Cancelar» y queda cancelada', async () => {
    const events = failedRun('r9').slice(0, 10);
    const summary = sum({ runId: 'r9', diagramId: 'pr', status: 'interrupted', order: 'Revisa el PR #140' });
    const api = createMemoryApi([PR], { pastRuns: [{ summary, events }] });
    const s = screenWith({ section: 'history', runId: 'r9' }, { runs: [summary] }, api);
    await screen.findByText('Interrumpida', { selector: '.orq-pill' });
    expect(screen.getByRole('button', { name: 'Reanudar' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(s.index.refresh).toHaveBeenCalled());
    const after = await api.listRuns();
    expect(after.ok && after.value.find((x) => x.runId === 'r9')).toMatchObject({ status: 'cancelled', reason: 'Se interrumpió y la cancelaste' });
  });
});
