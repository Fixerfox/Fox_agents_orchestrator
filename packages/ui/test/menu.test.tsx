// @vitest-environment jsdom
import './setup';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../src/App';
import { createMemoryApi } from '../src/memoryApi';

const AGENTS = [
  { id: 'sprites', name: 'Sprites', description: 'Dibuja' },
  { id: 'sonido', name: 'Sonido' },
];
const mount = () => render(<App initialProject="Proyecto" api={createMemoryApi()} agents={AGENTS} confirm={() => true} />);
const nodeEl = (label: string | RegExp) => screen.getByLabelText(label).closest('.react-flow__node') as HTMLElement;
const addAgent = async (name: RegExp) => {
  await userEvent.click(screen.getByRole('button', { name: '+ Agente' }));
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name }));
};

describe('menú contextual y conexiones [R21.12][R21.13]', () => {
  it('[R21.12][R32.34][R64.2] el botón derecho en un nodo ofrece renombrar, duplicar y eliminar, y duplica', async () => {
    mount();
    await addAgent(/Sprites/);
    const node = await screen.findByLabelText(/^Agente «sprites»/);
    fireEvent.contextMenu(node.closest('.react-flow__node')!);
    const menu = await screen.findByRole('menu');
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Configurar…', 'Editar el agente', 'Cambiar el agente…', 'Renombrar', 'Duplicar', 'Skill o contexto solo aquí…', 'MCP solo aquí…', 'Alta de MCP con Claude…', 'Eliminar']);
    // «Sprites» es un agente de ejemplo, no del proyecto: no se puede editar
    expect((within(menu).getByRole('menuitem', { name: 'Editar el agente' }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Duplicar' }));
    await waitFor(() => expect(screen.getAllByLabelText(/^Agente «sprites \(copia\)»|^Agente «sprites»/).length).toBeGreaterThan(1));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('[R21.12] eliminar desde el menú quita el nodo; entrada y salida no se pueden eliminar ni duplicar', async () => {
    mount();
    fireEvent.contextMenu(nodeEl('Entrada «Entrada»'));
    const menu = await screen.findByRole('menu');
    expect((within(menu).getByRole('menuitem', { name: 'Eliminar' }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(menu).getByRole('menuitem', { name: 'Duplicar' }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: '+ Router' }));
    fireEvent.contextMenu((await screen.findByLabelText(/^Router «Router»/)).closest('.react-flow__node')!);
    await userEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Eliminar' }));
    await waitFor(() => expect(screen.queryByLabelText(/^Router «Router»/)).toBeNull());
  });

  it('[R21.12][R21.14] el menú del lienzo añade un agente en ese punto pasando por la galería', async () => {
    mount();
    fireEvent.contextMenu(document.querySelector('.react-flow__pane')!, { clientX: 300, clientY: 200 });
    await userEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Añadir agente aquí' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Sonido/ }));
    expect(await screen.findByLabelText(/^Agente «sonido»/)).toBeTruthy();
  });

  it('[R21.12] el menú del lienzo añade un router en ese punto', async () => {
    mount();
    fireEvent.contextMenu(document.querySelector('.react-flow__pane')!, { clientX: 300, clientY: 200 });
    await userEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Añadir router aquí' }));
    expect(await screen.findByLabelText(/^Router «Router»/)).toBeTruthy();
  });

  it('[R21.12] «Renombrar» enfoca el campo de nombre del inspector', async () => {
    mount();
    await addAgent(/Sprites/);
    fireEvent.contextMenu((await screen.findByLabelText(/^Agente «sprites»/)).closest('.react-flow__node')!);
    await userEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Renombrar' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Nombre')));
  });

  it('[R21.13] una conexión se quita con el menú contextual', async () => {
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Bucle de revisión' }));
    await waitFor(() => expect(document.querySelectorAll('.react-flow__edge').length).toBeGreaterThan(0));
    const before = document.querySelectorAll('.react-flow__edge').length;
    fireEvent.contextMenu(document.querySelector('.react-flow__edge')!);
    await userEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Eliminar conexión' }));
    await waitFor(() => expect(document.querySelectorAll('.react-flow__edge').length).toBe(before - 1));

  });

  it('[R21.13] Retroceso borra la selección', async () => {
    mount();
    await userEvent.click(screen.getByRole('button', { name: '+ Router' }));
    const node = await screen.findByLabelText(/^Router «Router»/);
    fireEvent.click(node.closest('.react-flow__node')!);
    await waitFor(() => expect(screen.getByLabelText('Nombre')).toBeTruthy());
    fireEvent.keyDown(window, { key: 'Backspace' });
    await waitFor(() => expect(screen.queryByLabelText(/^Router «Router»/)).toBeNull());
  });
});

describe('«Tus agentes» en la aplicación [R21.15]', () => {
  it('[R21.15] lista los agentes usados y permite añadir otro igual', async () => {
    mount();
    expect(screen.queryByText('1 uso')).toBeNull();
    await addAgent(/Sprites/);
    expect(await screen.findByText('1 uso')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Añadir «Sprites» al diagrama' }));
    expect(await screen.findByText('2 usos')).toBeTruthy();
  });

  it('[R21.15][R32.39] pulsar el contador de usos selecciona su nodo y abre sus propiedades', async () => {
    mount();
    await addAgent(/Sonido/);
    await userEvent.click(within(screen.getByRole('navigation', { name: 'Secciones' })).getByRole('button', { name: 'Diseñador' }));
    await userEvent.click(within(screen.getByRole('navigation', { name: 'Secciones' })).getByRole('button', { name: 'Diseñador' }));
    const use = await screen.findByRole('button', { name: /^Ir a un paso de «Sonido»/ });
    await userEvent.click(use);
    await waitFor(() => expect((screen.getByLabelText('Nombre') as HTMLInputElement).value).toBe('sonido'));
  });
});
