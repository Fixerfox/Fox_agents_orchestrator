// @vitest-environment jsdom
import './setup';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createDiagram } from '@orquestador/editor';
import { App } from '../src/App';
import { createMemoryApi } from '../src/memoryApi';

const AGENTS = [
  { id: 'fondo', name: 'Fondo', description: 'Pinta fondos' },
  { id: 'scripts', name: 'Scripts', description: 'Programa' },
  { id: 'musica', name: 'Música', description: 'Compone' },
  { id: 'revisor', name: 'Revisor', description: 'Junta y revisa' },
];
function mount() {
  const api = createMemoryApi([createDiagram('principal', 'Principal')]);
  render(<App initialProject="Juego" api={api} agents={AGENTS} confirm={() => true} />);
  return api;
}
const dialog = () => within(screen.getByRole('dialog', { name: 'Varios a la vez' }));

describe('SPEC-032 · varios a la vez [R32.36]', () => {
  it('[R32.36] desde la paleta inserta tres agentes en paralelo antes de Salida, que espera a los tres', async () => {
    mount();
    await userEvent.click(screen.getByRole('button', { name: '+ Varios a la vez' }));
    const d = dialog();
    expect((d.getByRole('button', { name: 'Elige al menos 2' }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(d.getByRole('checkbox', { name: /Fondo/ }));
    await userEvent.click(d.getByRole('checkbox', { name: /Scripts/ }));
    await userEvent.click(d.getByRole('checkbox', { name: /Música/ }));
    await userEvent.click(d.getByRole('button', { name: 'Insertar 3 en paralelo' }));
    expect(screen.queryByRole('dialog', { name: 'Varios a la vez' })).toBeNull();
    for (const name of ['Fondo', 'Scripts', 'Música']) expect(await screen.findByLabelText(new RegExp(`^Agente «${name}»`))).toBeTruthy();
    expect(within(screen.getByLabelText(/^Salida/)).getByText('Espera a 3')).toBeTruthy();
    await userEvent.keyboard('{Control>}z{/Control}');
    await waitFor(() => expect(screen.queryByText('Espera a 3')).toBeNull());
  });

  it('[R32.36] desde el «+» de una conexión, con un agente que une y su tarea', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Insertar un paso entre «Entrada» y «Salida»' }));
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Insertar paso' })).getByRole('button', { name: /Varios a la vez/ }));
    const d = dialog();
    expect(d.getByText(/entre «Entrada» y «Salida»/)).toBeTruthy();
    await userEvent.click(d.getByRole('checkbox', { name: /Fondo/ }));
    await userEvent.click(d.getByRole('checkbox', { name: /Scripts/ }));
    await userEvent.click(d.getByRole('radio', { name: 'Con un agente que los une' }));
    await userEvent.selectOptions(d.getByLabelText('Agente que une'), 'revisor');
    expect((d.getByLabelText('Tarea del agente que une') as HTMLTextAreaElement).value).toMatch(/^Junta en un solo resultado/);
    await userEvent.click(d.getByRole('button', { name: 'Insertar 2 en paralelo' }));
    const join = await screen.findByLabelText(/^Agente «Unir»/);
    expect(within(join).getByText('Espera a 2')).toBeTruthy();
    // queda seleccionado el paso que une, con su tarea y lo que recibe
    expect((screen.getByLabelText('Qué tiene que hacer') as HTMLTextAreaElement).value).toMatch(/^Junta en un solo resultado/);
    expect(within(screen.getByLabelText('Recibe:')).getByText('@Fondo')).toBeTruthy();
    expect(within(screen.getByLabelText('Recibe:')).getByText('@Scripts')).toBeTruthy();
  });

  it('[R32.36] sin conexión seleccionada ni una única conexión a Salida, avisa en lugar de adivinar', async () => {
    const api = createMemoryApi([]);
    render(<App initialProject="Juego" api={api} agents={AGENTS} confirm={() => true} />);
    await userEvent.click(screen.getByRole('button', { name: /^Proyecto «/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Abrir proyecto' }));
    // el enrutador tiene tres conexiones que llegan a Salida
    await userEvent.click(await screen.findByRole('button', { name: 'Enrutador con 3 agentes' }));
    await screen.findByLabelText(/^Router/);
    await userEvent.click(screen.getByRole('button', { name: '+ Varios a la vez' }));
    expect(screen.queryByRole('dialog', { name: 'Varios a la vez' })).toBeNull();
    expect(screen.getByText(/Selecciona una conexión o pulsa el «\+»/)).toBeTruthy();
  });

  it('[R32.36] la plantilla «Varios a la vez y unir» trae fondo, scripts y música en paralelo', async () => {
    const api = createMemoryApi([]);
    render(<App initialProject="Juego" api={api} agents={AGENTS} confirm={() => true} />);
    await userEvent.click(screen.getByRole('button', { name: /^Proyecto «/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Abrir proyecto' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Varios a la vez y unir' }));
    expect(await screen.findByLabelText(/^Agente «Unir»/)).toBeTruthy();
    expect(within(screen.getByLabelText(/^Agente «Unir»/)).getByText('Espera a 3')).toBeTruthy();
  });
});

describe('SPEC-032 · el agente que une puede implementar [R32.36]', () => {
  it('[R32.36] «Implementar en el proyecto» cambia la tarea del agente que une', async () => {
    mount();
    await userEvent.click(screen.getByRole('button', { name: '+ Varios a la vez' }));
    const d = dialog();
    await userEvent.click(d.getByRole('radio', { name: 'Con un agente que los une' }));
    await userEvent.click(d.getByRole('radio', { name: 'Implementar en el proyecto' }));
    expect((d.getByLabelText('Tarea del agente que une') as HTMLTextAreaElement).value).toMatch(/^Implementa en la carpeta del proyecto/);
    await userEvent.click(d.getByRole('radio', { name: 'Juntar en un resumen' }));
    expect((d.getByLabelText('Tarea del agente que une') as HTMLTextAreaElement).value).toMatch(/^Junta en un solo resultado/);
  });
});
