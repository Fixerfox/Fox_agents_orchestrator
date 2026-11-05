// @vitest-environment jsdom
import './setup';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { newAgent } from '@orquestador/core';
import { createDiagram } from '@orquestador/editor';
import { App } from '../src/App';
import { createMemoryApi } from '../src/memoryApi';

async function runOnce() {
  const api = createMemoryApi([createDiagram('principal', 'Principal')], { agents: [{ ...newAgent('pix', 'Pixelador'), description: 'Pinta sprites' }] });
  render(<App initialProject="Juego" api={api} agents={[]} confirm={() => true} />);
  await userEvent.click(screen.getByRole('button', { name: /^Proyecto «/ }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Abrir proyecto' }));
  await screen.findByRole('button', { name: 'Añadir «Pixelador» al diagrama' });
  fireEvent.click(await screen.findByRole('button', { name: 'Insertar un paso entre «Entrada» y «Salida»' }));
  await userEvent.click(within(screen.getByRole('dialog', { name: 'Insertar paso' })).getByRole('button', { name: /Pixelador/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Lanzar…' }));
  const d = within(await screen.findByRole('dialog', { name: /^Ejecutar «/ }));
  await userEvent.type(d.getByLabelText('Entrada'), 'un dragón');
  await userEvent.click(d.getByRole('button', { name: 'Lanzar y ver la ejecución' }));
  await screen.findByRole('button', { name: 'Ver resumen de la ejecución' }, { timeout: 4000 });
  return api;
}
const rail = () => within(screen.getByRole('navigation', { name: 'Secciones' }));
const toDesigner = () => userEvent.click(rail().getByRole('button', { name: /Diseñador/ }));
const modal = () => within(screen.getByRole('dialog', { name: 'Resultado de «Principal»' }));

describe('SPEC-044 · la ejecución en un modal', () => {
  it('[R44.3][R44.1][R44.2] el Diseñador no avisa; desde la barra «Ver resumen de la ejecución» abre el modal y un paso lleva a la ejecución', async () => {
    await runOnce();
    await toDesigner();
    // el Diseñador no muestra el estado de ninguna ejecución [R52.8]
    expect(screen.queryByRole('region', { name: 'La ejecución ha terminado' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Ver resumen de la ejecución' })).toBeNull();
    await userEvent.click(rail().getByRole('button', { name: 'Trabajos' }));
    await userEvent.click(screen.getByRole('button', { name: 'Ver resumen de la ejecución' }));
    const m = modal();
    expect(m.getAllByRole('tab').map((x) => x.textContent)).toEqual(['Resumen', 'Cronograma', 'Historial', 'Resultado', 'Archivos', 'Auditoría']);
    expect(m.getByRole('tab', { name: 'Resumen' }).getAttribute('aria-selected')).toBe('true');
    expect(m.getByRole('region', { name: 'Lo que se pidió' })).toBeTruthy();
    expect(m.getByRole('button', { name: 'Abrir en Ejecuciones' })).toBeTruthy();
    await userEvent.click(m.getByRole('tab', { name: 'Historial' }));
    expect(m.getByRole('tabpanel', { name: 'Historial' })).toBeTruthy();
    await userEvent.click(m.getByRole('tab', { name: 'Resumen' }));
    await userEvent.click(m.getByRole('button', { name: 'Ver «pix» en detalle' }));
    expect(screen.queryByRole('dialog', { name: 'Resultado de «Principal»' })).toBeNull();
    expect(await screen.findByRole('region', { name: 'Ejecución de «pix»' })).toBeTruthy();
  });

  it('[R44.4] fuera del Diseñador, el estado de la barra abre el modal, que lleva a Ejecuciones', async () => {
    await runOnce();
    await userEvent.click(rail().getByRole('button', { name: 'Trabajos' }));
    await userEvent.click(screen.getByRole('button', { name: 'Ver resumen de la ejecución' }));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Resultado de «Principal»' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Ver resumen de la ejecución' }));
    await userEvent.click(modal().getByRole('button', { name: 'Abrir en Ejecuciones' }));
    expect(screen.queryByRole('dialog', { name: 'Resultado de «Principal»' })).toBeNull();
    expect(await screen.findByRole('heading', { name: 'Principal', level: 1 })).toBeTruthy();
  });

  it('[R44.5] en Ejecuciones, «Ver resumen» de la cabecera abre el mismo modal (sin «Abrir en Ejecuciones»)', async () => {
    await runOnce();
    await userEvent.click(rail().getByRole('button', { name: /Ejecuc/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Ver resumen' }));
    const m = modal();
    expect(m.getAllByRole('tab')).toHaveLength(6);
    expect(m.queryByRole('button', { name: 'Abrir en Ejecuciones' })).toBeNull();
    await userEvent.click(m.getByRole('tab', { name: 'Archivos' }));
    expect(m.getByRole('tabpanel', { name: 'Archivos' })).toBeTruthy();
  });
});
