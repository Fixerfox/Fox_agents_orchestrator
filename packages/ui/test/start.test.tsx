// @vitest-environment jsdom
import './setup';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RecentView } from '@orquestador/core';
import { createDiagram } from '@orquestador/editor';
import { App } from '../src/App';
import { createMemoryApi, type MemoryApiOptions } from '../src/memoryApi';

const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const rec = (id: string, name: string, over: Partial<RecentView> = {}): RecentView => ({ id, name, folder: `Juegos / ${name}`, openedAt: day(0), missing: false, ...over });

function mount(options: MemoryApiOptions = {}, confirm = () => true) {
  const api = createMemoryApi([createDiagram('principal', 'Principal')], options);
  render(<App api={api} confirm={confirm} />);
  return api;
}

describe('SPEC-028 · pantalla de inicio', () => {
  it('[R28.1] sin proyecto se ve la pantalla de inicio y no el editor', () => {
    mount();
    expect(screen.getByRole('heading', { name: '¿Qué vas a orquestar?' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Crear proyecto' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Abrir proyecto' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Lanzar…' })).toBeNull();
    expect(screen.queryByLabelText('Añadir')).toBeNull();
  });

  it('[R28.1] crear y abrir llevan al editor', async () => {
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'Crear proyecto' }));
    expect(await screen.findByRole('button', { name: 'Lanzar…' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: '¿Qué vas a orquestar?' })).toBeNull();
  });

  it('[R28.1] desde la pantalla de inicio se abren los Ajustes', async () => {
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'Ajustes' }));
    expect(await screen.findByRole('region', { name: 'Ajustes' })).toBeTruthy();
  });

  it('[R28.5] sin recientes lo explica y ofrece crear o abrir', async () => {
    mount();
    expect(await screen.findByText(/Aún no has abierto ningún proyecto/)).toBeTruthy();
  });

  it('[R28.3] lista los recientes con nombre, carpeta y fecha, y abrir uno lleva al editor', async () => {
    const api = mount({ recent: [rec('p1', 'Sprites'), rec('p2', 'Tienda', { openedAt: day(1) }), rec('p3', 'Viejo', { openedAt: day(40) })] });
    const list = within(await screen.findByRole('list'));
    expect(list.getByText('Sprites')).toBeTruthy();
    expect(list.getByText('Juegos / Sprites')).toBeTruthy();
    expect(list.getByText('Hoy')).toBeTruthy();
    expect(list.getByText('Ayer')).toBeTruthy();
    expect(JSON.stringify(await api.listRecent())).not.toMatch(/[A-Za-z]:\\|\/home\//);
    await userEvent.click(list.getByRole('button', { name: 'Abrir Sprites' }));
    expect(await screen.findByRole('button', { name: 'Lanzar…' })).toBeTruthy();
  });

  it('[R28.3] un reciente cuya carpeta ya no existe lo indica, no se abre y se puede quitar', async () => {
    mount({ recent: [rec('p1', 'Borrado', { missing: true })] });
    const open = (await screen.findByRole('button', { name: 'Abrir Borrado' })) as HTMLButtonElement;
    expect(open.disabled).toBe(true);
    expect(screen.getByText('La carpeta ya no existe')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Lanzar…' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Quitar Borrado de la lista' }));
    await waitFor(() => expect(screen.queryByText('Borrado')).toBeNull());
    expect(screen.getByText(/Aún no has abierto ningún proyecto/)).toBeTruthy();
  });

  it('[R28.3] si al abrir falla, el motivo sale en su fila y sigue en la pantalla de inicio', async () => {
    const api = mount({ recent: [rec('p1', 'Raro')] });
    await screen.findByRole('button', { name: 'Abrir Raro' });
    api.openRecent = async () => ({ ok: false, error: { code: 'not-found', message: 'La carpeta del proyecto ya no existe o no es un proyecto. Puedes quitarlo de la lista.' } });
    await userEvent.click(screen.getByRole('button', { name: 'Abrir Raro' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Puedes quitarlo de la lista');
    expect(screen.getByRole('heading', { name: '¿Qué vas a orquestar?' })).toBeTruthy();
  });

  it('[R28.4] quitar de la lista solo quita ese elemento', async () => {
    const api = mount({ recent: [rec('p1', 'Uno'), rec('p2', 'Dos')] });
    await userEvent.click(await screen.findByRole('button', { name: 'Quitar Uno de la lista' }));
    await waitFor(() => expect(screen.queryByText('Uno')).toBeNull());
    expect(screen.getByText('Dos')).toBeTruthy();
    expect(((await api.listRecent()) as { value: RecentView[] }).value.map((r) => r.id)).toEqual(['p2']);
  });

  it('[R28.5] si crear falla, el motivo se muestra en la pantalla; cancelar el diálogo no hace nada', async () => {
    const api = mount();
    api.createProject = async () => ({ ok: false, error: { code: 'exists', message: 'Ya existe un proyecto en esa carpeta' } });
    await userEvent.click(screen.getByRole('button', { name: 'Crear proyecto' }));
    expect((await screen.findByRole('alert')).textContent).toBe('No se pudo abrir: Ya existe un proyecto en esa carpeta');
    api.openProject = async () => ({ ok: true, value: null });
    await userEvent.click(screen.getByRole('button', { name: 'Abrir proyecto' }));
    expect(screen.getByRole('heading', { name: '¿Qué vas a orquestar?' })).toBeTruthy();
  });

  it('[R28.7] «Cerrar proyecto» vuelve a la pantalla de inicio', async () => {
    const api = mount();
    await userEvent.click(screen.getByRole('button', { name: 'Crear proyecto' }));
    await userEvent.click(await screen.findByRole('button', { name: /^Proyecto «/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Cerrar proyecto' }));
    expect(await screen.findByRole('heading', { name: '¿Qué vas a orquestar?' })).toBeTruthy();
    expect(((await api.listDiagrams()) as { ok: boolean }).ok).toBe(false);
  });

  it('[R28.7][R32.38] al cerrar con cambios pendientes se guardan sin preguntar', async () => {
    const confirm = vi.fn(() => false);
    const api = mount({}, confirm);
    await userEvent.click(screen.getByRole('button', { name: 'Crear proyecto' }));
    await userEvent.click(await screen.findByRole('button', { name: '+ Router' }));
    await userEvent.click(screen.getByRole('button', { name: /^Proyecto «/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Cerrar proyecto' }));
    expect(confirm).not.toHaveBeenCalled();
    expect(await screen.findByRole('heading', { name: '¿Qué vas a orquestar?' })).toBeTruthy();
    expect([...api.saved.values()].some((d) => d.nodes.some((n) => n.kind === 'router'))).toBe(true);
  });
});
