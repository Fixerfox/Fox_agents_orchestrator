// @vitest-environment jsdom
import './setup';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Diagram } from '@orquestador/core';
import { createDiagram } from '@orquestador/editor';
import { App } from '../src/App';
import { DRAG_TYPE } from '../src/Canvas';
import { createMemoryApi } from '../src/memoryApi';

/** «Cueva»: Entrada → pintor → Salida. */
const cueva = (): Diagram => {
  const d = createDiagram('cueva', 'Cueva');
  return {
    ...d,
    nodes: [d.nodes[0]!, { id: 'pintor', kind: 'agent', agentId: 'pintor', label: 'pintor', position: { x: 200, y: 120 } }, d.nodes[1]!],
    edges: [
      { id: 'entry->pintor', from: 'entry', to: 'pintor' },
      { id: 'pintor->output', from: 'pintor', to: 'output' },
    ],
  };
};
async function mount() {
  const api = createMemoryApi([createDiagram('mundo', 'Mundo'), cueva()]);
  render(<App initialProject="Juego" api={api} agents={[{ id: 'pintor', name: 'Pintor' }]} confirm={() => true} />);
  await userEvent.click(screen.getByRole('button', { name: /^Proyecto «/ }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Abrir proyecto' }));
  await screen.findByRole('button', { name: 'Diagrama «Mundo»' });
  return api;
}
const dropDiagram = (id: string) => {
  const data = { [DRAG_TYPE]: `diagram:${id}` } as Record<string, string>;
  fireEvent.drop(screen.getByTestId('canvas'), { dataTransfer: { getData: (k: string) => data[k] ?? '', types: [DRAG_TYPE] }, clientX: 300, clientY: 200 });
};

describe('SPEC-033 · diagramas dentro de diagramas', () => {
  it('[R33.8] la sección «Diagramas» lista los del proyecto, marca el abierto y abre otro con un clic', async () => {
    await mount();
    const sec = within(screen.getByRole('region', { name: 'Diagramas' }));
    expect(sec.getByRole('button', { name: 'Abrir el diagrama «Mundo»' }).getAttribute('aria-current')).toBe('page');
    await userEvent.click(sec.getByRole('button', { name: 'Abrir el diagrama «Cueva»' }));
    expect(await screen.findByRole('button', { name: 'Diagrama «Cueva»' })).toBeTruthy();
  });

  it('[R33.8] el botón derecho de un diagrama ofrece abrir, duplicar y eliminar', async () => {
    const api = await mount();
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Abrir el diagrama «Cueva»' }));
    const items = within(screen.getByRole('menu')).getAllByRole('menuitem').map((b) => b.textContent);
    expect(items).toEqual(['Abrir', 'Duplicar', 'Eliminar…']);
    await userEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Eliminar…' }));
    await waitFor(() => expect(api.saved.has('cueva')).toBe(false));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Abrir el diagrama «Cueva»' })).toBeNull());
  });

  it('[R33.7][R33.8][R33.9] arrastrar «Cueva» a «Mundo» crea un paso que la ejecuta entera y recoge su salida', async () => {
    await mount();
    dropDiagram('cueva');
    const node = await screen.findByLabelText(/^Subdiagrama «Cueva»/);
    expect(within(node).getByText('Diagrama «Cueva»')).toBeTruthy();
    const panel = within(screen.getByRole('group', { name: 'Usa el diagrama' }));
    expect(panel.getByText('Cueva')).toBeTruthy();
    expect(panel.getByText(/Siempre usa su última versión guardada/)).toBeTruthy();
    // conectar Entrada → Cueva → Salida y ejecutar
    fireEvent.click(screen.getByRole('button', { name: 'Insertar un paso entre «Entrada» y «Salida»' }));
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'Abrir el diagrama' })).toBeTruthy();
  });

  it('[R33.8] no se puede soltar un diagrama dentro de sí mismo', async () => {
    await mount();
    dropDiagram('mundo');
    expect(await screen.findByText('Un diagrama no se puede meter dentro de sí mismo')).toBeTruthy();
    expect(screen.queryByLabelText(/^Subdiagrama/)).toBeNull();
  });

  it('[R33.9] «Abrir el diagrama» en el panel y en el menú lleva al diagrama usado', async () => {
    await mount();
    dropDiagram('cueva');
    await screen.findByLabelText(/^Subdiagrama «Cueva»/);
    fireEvent.contextMenu(screen.getByLabelText(/^Subdiagrama «Cueva»/));
    await userEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Abrir el diagrama' }));
    expect(await screen.findByRole('button', { name: 'Diagrama «Cueva»' })).toBeTruthy();
  });

  it('[R33.7] al ejecutar, el paso ejecuta el otro diagrama y su salida pasa al siguiente', async () => {
    const mundo = createDiagram('mundo', 'Mundo');
    mundo.nodes.push({ id: 'cueva-1', kind: 'subdiagram', label: 'Cueva', subdiagram: { templateId: 'cueva', version: 'latest' }, position: { x: 200, y: 120 } });
    mundo.edges = [
      { id: 'entry->cueva-1', from: 'entry', to: 'cueva-1' },
      { id: 'cueva-1->output', from: 'cueva-1', to: 'output' },
    ];
    const api = createMemoryApi([mundo, cueva()]);
    const r = await api.startRun({ diagramId: 'mundo', order: 'una cueva helada' });
    if (!r.ok) throw new Error(r.error.message);
    const res = await api.runs.get(r.value.runId!)!.handle.result;
    expect(res.status).toBe('succeeded');
    expect(res.output?.text).toBe('salida de pintor');
    expect(res.events.some((e) => e.type === 'subdiagram.started')).toBe(true);
  });
});
