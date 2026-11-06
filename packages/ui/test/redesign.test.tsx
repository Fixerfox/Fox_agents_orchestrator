// @vitest-environment jsdom
import './setup';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../src/App';
import { InsertPicker } from '../src/diagrams/InsertPicker';
import { settingsSaved } from './nav';
import { createMemoryApi } from '../src/memoryApi';

const AGENTS = [
  { id: 'sprites', name: 'Sprites', description: 'Dibuja en píxel art' },
  { id: 'revisor', name: 'Revisor', description: 'Da un veredicto' },
];
const mount = () => {
  const api = createMemoryApi();
  render(<App initialProject="Juego" api={api} agents={AGENTS} confirm={() => true} />);
  return api;
};
const addSprites = async () => {
  await userEvent.click(screen.getByRole('button', { name: '+ Agente' }));
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Sprites/ }));
  return screen.findByLabelText(/^Agente «sprites»/);
};

describe('SPEC-032 · editor rediseñado', () => {
  it('[R32.3] el inspector de un agente pide la tarea y muestra la tarjeta del agente con su descripción', async () => {
    mount();
    await addSprites();
    const task = screen.getByLabelText('Qué tiene que hacer') as HTMLTextAreaElement;
    const card = within(screen.getByRole('group', { name: 'Quién lo hace' }));
    expect(card.getByText('Sprites', { selector: 'strong' })).toBeTruthy();
    expect(card.getByText('Dibuja en píxel art')).toBeTruthy();
    await userEvent.type(task, 'Dibuja cada enemigo');
    fireEvent.blur(task);
    // un solo paso de historial por edición: deshacer devuelve el campo vacío
    await waitFor(() => expect((screen.getByLabelText('Qué tiene que hacer') as HTMLTextAreaElement).value).toBe('Dibuja cada enemigo'));
    // «Cambiar» abre la galería de agentes y sustituye el del nodo [R32.29]
    await userEvent.click(card.getByRole('button', { name: 'Cambiar el agente' }));
    const gal = within(screen.getByRole('dialog', { name: 'Elige un agente' }));
    await userEvent.click(gal.getByRole('button', { name: /Revisor/ }));
    expect(screen.queryByRole('dialog', { name: 'Elige un agente' })).toBeNull();
    expect(within(screen.getByRole('group', { name: 'Quién lo hace' })).getByText('Da un veredicto')).toBeTruthy();
  });

  it('[R32.4] la tarjeta del nodo muestra «Sin tarea» y, al escribirla, su primera línea', async () => {
    mount();
    const node = await addSprites();
    expect(within(node).getByText('Sin tarea')).toBeTruthy();
    const task = screen.getByLabelText('Qué tiene que hacer');
    await userEvent.type(task, 'Primera línea{Enter}segunda');
    fireEvent.blur(task);
    await waitFor(() => expect(within(screen.getByLabelText(/^Agente «sprites»/)).getByText('Primera línea')).toBeTruthy());
    expect(within(screen.getByLabelText(/^Agente «sprites»/)).queryByText('Sin tarea')).toBeNull();
  });

  it('[R32.10] un nodo sin conectar es un aviso (ámbar), no un error, y el panel separa avisos y errores', async () => {
    mount();
    const node = await addSprites();
    expect(node.className).toContain('has-warnings');
    expect(node.className).not.toContain('has-problems');
    await userEvent.click(screen.getByRole('button', { name: '1 aviso' }));
    expect(screen.getByText('0 errores · 1 avisos')).toBeTruthy();
    const item = document.querySelector('.orq-problems li');
    expect(item?.className).toBe('is-warning');
    expect(item?.textContent).toMatch(/^Aviso: «sprites» no está conectado/);
    await userEvent.click(screen.getByRole('button', { name: 'Lanzar…' }));
    const run = within(await screen.findByRole('dialog', { name: /^Ejecutar «/ }));
    expect(run.getByRole('alert').textContent).toMatch(/Corrige los problemas/);
    expect((run.getByRole('button', { name: 'Lanzar y ver la ejecución' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('[R32.8] el «+» de una conexión inserta el agente elegido entre ambos extremos y se deshace de una vez', async () => {
    mount();
    await screen.findByRole('button', { name: 'Insertar un paso entre «Entrada» y «Salida»' });
    const plus = screen.getByRole('button', { name: 'Insertar un paso entre «Entrada» y «Salida»' });
    // jsdom no aplica el CSS que da pointer-events al portal de etiquetas de React Flow: clic directo.
    fireEvent.click(plus);
    const dialog = within(screen.getByRole('dialog', { name: 'Insertar paso' }));
    await userEvent.type(dialog.getByLabelText('Buscar agente o paso…'), 'rev{Enter}');
    expect(await screen.findByLabelText('Agente «revisor»')).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Insertar paso' })).toBeNull();
    expect(await screen.findByRole('button', { name: 'Insertar un paso entre «Entrada» y «revisor»' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Insertar un paso entre «revisor» y «Salida»' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /avisos?$|errores$/ })).toBeNull();
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    await waitFor(() => expect(screen.queryByLabelText('Agente «revisor»')).toBeNull());
    expect(screen.getByRole('button', { name: 'Insertar un paso entre «Entrada» y «Salida»' })).toBeTruthy();
  });

  it('[R32.8] el buscador filtra, ofrece router y bucle, avisa si nada coincide y se cierra con Esc', async () => {
    const picks: unknown[] = [];
    let closed = 0;
    render(<InsertPicker agents={AGENTS} at={{ x: 100, y: 100 }} onPick={(c) => picks.push(c)} onClose={() => closed++} />);
    const box = within(screen.getByRole('dialog', { name: 'Insertar paso' }));
    expect(box.getByRole('button', { name: /Router/ })).toBeTruthy();
    await userEvent.type(box.getByLabelText('Buscar agente o paso…'), 'bucle');
    expect(box.queryByRole('button', { name: /Sprites/ })).toBeNull();
    await userEvent.click(box.getByRole('button', { name: /Bucle/ }));
    expect(picks).toEqual([{ kind: 'loop' }]);
    await userEvent.clear(box.getByLabelText('Buscar agente o paso…'));
    await userEvent.type(box.getByLabelText('Buscar agente o paso…'), 'zzz');
    expect(box.getByText('Nada coincide con «zzz»')).toBeTruthy();
    await userEvent.keyboard('{Escape}');
    expect(closed).toBe(1);
  });

  it('[R32.11] la barra muestra el motor y cambia al guardar Ajustes; pulsarlo abre Ajustes', async () => {
    mount();
    const badge = await screen.findByRole('button', { name: /^Motor de los agentes: Simulado/ });
    await userEvent.click(badge);
    const dialog = within(await screen.findByRole('region', { name: 'Ajustes' }));
    await userEvent.click(dialog.getByLabelText(/Claude \(real\)/));
    await settingsSaved();
    expect(await screen.findByRole('button', { name: /^Motor de los agentes: Claude/ })).toBeTruthy();
  });

  it('[R32.12] crear, abrir y cerrar proyecto están en el menú del nombre del proyecto y el tema ya no está en la barra', async () => {
    mount();
    const toolbar = within(screen.getByRole('toolbar'));
    expect(toolbar.queryByRole('button', { name: 'Abrir proyecto' })).toBeNull();
    expect(toolbar.queryByRole('button', { name: /^Tema:/ })).toBeNull();
    const btn = toolbar.getByRole('button', { name: 'Proyecto «Juego»' });
    await userEvent.click(btn);
    const menu = within(screen.getByRole('menu', { name: 'Proyecto «Juego»' }));
    expect(menu.getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Crear proyecto', 'Abrir proyecto', 'Cerrar proyecto']);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(btn);
  });
});
