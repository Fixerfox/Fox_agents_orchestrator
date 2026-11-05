// @vitest-environment jsdom
import './setup';
import { describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { newAgent, type Diagram } from '@orquestador/core';
import { createDiagram } from '@orquestador/editor';
import { App } from '../src/App';
import { createMemoryApi, type MemoryApiOptions } from '../src/memoryApi';

/** Diagrama con un paso de «pix» entre la entrada y la salida. */
const flow = (id: string, name: string, extra: Partial<Diagram> = {}): Diagram => ({
  id,
  name,
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
  ...extra,
});
const broken: Diagram = { ...flow('roto', 'Roto'), nodes: [...flow('roto', 'Roto').nodes, { id: 'x', kind: 'agent' }] };

async function mount(diagrams: Diagram[] = [createDiagram('principal', 'Principal'), flow('informe', 'Informe semanal'), broken], options: MemoryApiOptions = {}) {
  const api = createMemoryApi(diagrams, { agents: [{ ...newAgent('pix', 'Pixelador'), description: 'Pinta' }], ...options });
  render(<App initialProject="Juego" api={api} agents={[]} confirm={() => true} />);
  await userEvent.click(screen.getByRole('button', { name: /^Proyecto «/ }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Abrir proyecto' }));
  await screen.findByRole('button', { name: 'Añadir «Pixelador» al diagrama' });
  return api;
}
const rail = () => within(screen.getByRole('navigation', { name: 'Secciones' }));
const goJobs = async () => {
  await userEvent.click(rail().getByRole('button', { name: 'Trabajos' }));
  return within(await screen.findByRole('region', { name: 'Trabajos' }));
};
const card = async (name: string) => within(await screen.findByRole('listitem', { name }));
const banner = () => within(screen.getByRole('navigation', { name: 'Estado de las ejecuciones' }));
async function launch(name: string, input: string, stay = false) {
  await userEvent.click((await card(name)).getByRole('button', { name: `Lanzar «${name}»` }));
  const d = within(await screen.findByRole('dialog', { name: `Ejecutar «${name}»` }));
  await userEvent.clear(d.getByLabelText('Entrada'));
  await userEvent.type(d.getByLabelText('Entrada'), input);
  if (stay) await userEvent.click(d.getByRole('checkbox', { name: 'Quedarme donde estoy' }));
  await userEvent.click(d.getByRole('button', { name: stay ? 'Lanzar' : 'Lanzar y ver la ejecución' }));
}

describe('SPEC-052 · pantalla Trabajos', () => {
  it('[R52.5][R52.6] una tarjeta por diagrama con sus pasos y «nunca ejecutado»; uno con problemas va al final, no se lanza y se arregla en el Diseñador', async () => {
    await mount();
    const jobs = await goJobs();
    expect(jobs.getByRole('heading', { name: 'Trabajos' })).toBeTruthy();
    expect(jobs.getByText(/Cada lanzamiento es una ejecución independiente/)).toBeTruthy();
    const informe = await card('Informe semanal');
    expect(informe.getByText('1 paso')).toBeTruthy();
    expect(informe.getByText('nunca ejecutado')).toBeTruthy();
    expect(informe.getByRole('button', { name: 'Lanzar «Informe semanal»' })).toBeTruthy();
    expect(informe.queryByRole('button', { name: 'Ver ejecuciones' })).toBeNull();
    const names = within(jobs.getByRole('list', { name: 'Diagramas' })).getAllByRole('listitem').map((li) => li.getAttribute('aria-label'));
    expect(names[names.length - 1]).toBe('Roto');
    const roto = await card('Roto');
    expect(roto.queryByRole('button', { name: /^Lanzar/ })).toBeNull();
    expect(roto.getByText(/^\d+ problemas?$/)).toBeTruthy();
    await userEvent.click(roto.getByRole('button', { name: 'Arreglar en el diseñador' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Diagrama «Roto»' })).toBeTruthy());
    expect(rail().getByRole('button', { name: 'Diseñador' }).getAttribute('aria-current')).toBe('page');
  });

  it('[R52.6] la búsqueda filtra por nombre sin acentos y avisa si no hay nada; «Editar» lo abre en el Diseñador', async () => {
    await mount();
    const jobs = await goJobs();
    await card('Informe semanal');
    await userEvent.type(jobs.getByRole('searchbox', { name: 'Buscar diagrama…' }), 'INFÓRME');
    expect(within(jobs.getByRole('list', { name: 'Diagramas' })).getAllByRole('listitem').map((li) => li.getAttribute('aria-label'))).toEqual(['Informe semanal']);
    await userEvent.clear(jobs.getByRole('searchbox'));
    await userEvent.type(jobs.getByRole('searchbox'), 'zzz');
    expect(jobs.getByText('Ningún diagrama coincide con «zzz».')).toBeTruthy();
    await userEvent.clear(jobs.getByRole('searchbox'));
    await userEvent.click((await card('Informe semanal')).getByRole('button', { name: 'Editar' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Diagrama «Informe semanal»' })).toBeTruthy());
  });

  it('[R52.6] sin diagramas invita a crear uno en el Diseñador', async () => {
    const api = await mount([createDiagram('principal', 'Principal')]);
    await api.deleteDiagram('principal');
    const jobs = await goJobs();
    expect(await jobs.findByText(/Aún no hay diagramas/)).toBeTruthy();
    await userEvent.click(jobs.getByRole('button', { name: 'Ir al Diseñador' }));
    expect(rail().getByRole('button', { name: 'Diseñador' }).getAttribute('aria-current')).toBe('page');
  });

  it('[R52.6] la banda cuenta en marcha, te necesitan y terminadas; la tarjeta lo marca; cada pieza lleva a su apartado de Ejecuciones', async () => {
    const { MockAgent, MockDecider, Orchestrator } = await import('@orquestador/core');
    const mock = new MockAgent({ pix: { output: 'x', asks: [{ question: '¿Puedo ejecutar git push?', options: ['Permitir', 'Denegar'] }] } });
    const api = await mount(undefined, { orchestrator: new Orchestrator({ getAdapter: () => mock, decider: new MockDecider() }) });
    await goJobs();
    expect(banner().getByRole('button', { name: 'En marcha: 0' })).toBeTruthy();
    await launch('Informe semanal', 'semana 45', true);
    await waitFor(() => expect(banner().getByRole('button', { name: 'Te necesitan: 1' })).toBeTruthy(), { timeout: 5000 });
    expect((await card('Informe semanal')).getByText('1 espera respuesta')).toBeTruthy();
    await userEvent.click(banner().getByRole('button', { name: 'Te necesitan: 1' }));
    expect(await screen.findByText('¿Puedo ejecutar git push?')).toBeTruthy();
    const runs = await api.listRuns();
    const runId = runs.ok ? runs.value[0]!.runId : '';
    const q = await api.pendingQuestions(runId);
    if (q.ok) await api.answerRun({ runId, questionId: q.value[0]!.questionId, text: 'Permitir' });
    await goJobs();
    await waitFor(() => expect(banner().getByRole('button', { name: 'Terminadas (24 h): 1' })).toBeTruthy(), { timeout: 5000 });
    await userEvent.click(banner().getByRole('button', { name: 'Terminadas (24 h): 1' }));
    expect(await screen.findByRole('heading', { name: 'Historial de ejecuciones' })).toBeTruthy();
  });
});

describe('SPEC-052 · lanzar desde Trabajos', () => {
  it('[R52.7] «Lanzar» abre el diálogo de ese diagrama aunque no esté abierto y lleva a su ejecución; la tarjeta la cuenta y «Ver ejecuciones» filtra el historial', async () => {
    const api = await mount();
    await goJobs();
    await userEvent.click((await card('Informe semanal')).getByRole('button', { name: 'Lanzar «Informe semanal»' }));
    const d = within(await screen.findByRole('dialog', { name: 'Ejecutar «Informe semanal»' }));
    expect(d.queryByRole('group', { name: /^Ya hay/ })).toBeNull();
    await userEvent.type(d.getByLabelText('Entrada'), 'semana 45');
    await userEvent.click(d.getByRole('button', { name: 'Lanzar y ver la ejecución' }));
    expect(await screen.findByRole('heading', { name: 'Informe semanal', level: 1 })).toBeTruthy();
    // el Diseñador sigue con el que estaba abierto
    expect(screen.getByRole('button', { name: 'Diagrama «Principal»' })).toBeTruthy();
    await waitFor(async () => {
      const r = await api.listRuns();
      expect(r.ok && r.value[0]?.status).toBe('succeeded');
    });
    await goJobs();
    const informe = await card('Informe semanal');
    await waitFor(() => expect(informe.getByText('última: ✓ terminada hace un momento')).toBeTruthy());
    expect(informe.getByText('1 ejecución')).toBeTruthy();
    await userEvent.click(informe.getByRole('button', { name: 'Ver ejecuciones' }));
    const runs = within(await screen.findByRole('region', { name: 'Ejecuciones' }));
    await waitFor(() => expect((runs.getByRole('combobox') as HTMLSelectElement).value).toBe('informe'));
  });

  it('[R52.7] «Quedarme donde estoy» lanza sin salir y avisa; la siguiente vez trae la última entrada', async () => {
    await mount();
    await goJobs();
    await launch('Informe semanal', 'semana 45', true);
    expect(await screen.findByText('Lanzada «Informe semanal».')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Trabajos' })).toBeTruthy();
    await userEvent.click((await card('Informe semanal')).getByRole('button', { name: 'Lanzar «Informe semanal»' }));
    const d = within(await screen.findByRole('dialog', { name: 'Ejecutar «Informe semanal»' }));
    expect((d.getByLabelText('Entrada') as HTMLTextAreaElement).value).toBe('semana 45');
  });

  it('[R52.7] «Guardar en el diagrama» guarda el entregable en el diagrama lanzado, aunque no esté abierto', async () => {
    const api = await mount();
    await goJobs();
    await userEvent.click((await card('Informe semanal')).getByRole('button', { name: 'Lanzar «Informe semanal»' }));
    const d = within(await screen.findByRole('dialog', { name: 'Ejecutar «Informe semanal»' }));
    await userEvent.click(d.getByText('Entregable'));
    await userEvent.click(d.getByRole('checkbox', { name: /Enlaces/ }));
    await userEvent.click(d.getByRole('button', { name: 'Guardar en el diagrama' }));
    await waitFor(() => expect(api.saved.get('informe')?.deliverable).toEqual({ items: [{ kind: 'links' }] }));
    expect(api.saved.get('principal')?.deliverable).toBeUndefined();
  });

  it('[R52.6][R52.3] lo de la cola se cuenta en la banda y en la tarjeta', async () => {
    const { MockAgent, MockDecider, Orchestrator } = await import('@orquestador/core');
    const mock = new MockAgent({ pix: { output: 'x', waitFor: new Promise<void>(() => undefined) } });
    await mount(undefined, { orchestrator: new Orchestrator({ getAdapter: () => mock, decider: new MockDecider() }) });
    await goJobs();
    await launch('Informe semanal', 'uno', true);
    await userEvent.click((await card('Informe semanal')).getByRole('button', { name: 'Lanzar «Informe semanal»' }));
    const d = within(await screen.findByRole('dialog', { name: 'Ejecutar «Informe semanal»' }));
    await userEvent.click(d.getByRole('radio', { name: /^En cola/ }));
    await userEvent.click(d.getByRole('checkbox', { name: 'Quedarme donde estoy' }));
    await userEvent.click(d.getByRole('button', { name: 'Lanzar' }));
    await waitFor(() => expect(banner().getByRole('button', { name: 'En cola: 1' })).toBeTruthy());
    expect((await card('Informe semanal')).getByText('1 en cola')).toBeTruthy();
    expect((await card('Informe semanal')).getByText('1 en marcha')).toBeTruthy();
  });
});

describe('SPEC-052 · el Diseñador solo diseña', () => {
  it('[R52.8] la barra del Diseñador tiene «Lanzar…» y no el estado de la ejecución; «N en marcha» aparece en todas las secciones', async () => {
    let release!: () => void;
    const { MockAgent, MockDecider, Orchestrator } = await import('@orquestador/core');
    const mock = new MockAgent({ pix: { output: 'x', waitFor: new Promise<void>((r) => (release = r)) } });
    await mount(undefined, { orchestrator: new Orchestrator({ getAdapter: () => mock, decider: new MockDecider() }) });
    await goJobs();
    await launch('Informe semanal', 'x', true);
    expect(await screen.findByRole('button', { name: '1 en marcha' })).toBeTruthy();
    // fuera del Diseñador, la barra sigue la última ejecución lanzada
    expect(screen.getByRole('button', { name: 'Pausar' })).toBeTruthy();
    await userEvent.click(rail().getByRole('button', { name: 'Diseñador' }));
    expect(screen.getByRole('button', { name: '1 en marcha' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Lanzar…' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Pausar' })).toBeNull();
    expect(screen.queryByText('Ejecutando')).toBeNull();
    release();
    await waitFor(() => expect(screen.queryByRole('button', { name: '1 en marcha' })).toBeNull(), { timeout: 5000 });
  });
});
