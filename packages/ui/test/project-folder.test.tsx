// @vitest-environment jsdom
import './setup';
import { describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createDiagram } from '@orquestador/editor';
import { App } from '../src/App';
import { settingsSection } from './nav';
import { createMemoryApi, type MemoryApiOptions } from '../src/memoryApi';

async function mount(options: MemoryApiOptions = {}) {
  const api = createMemoryApi([createDiagram('principal', 'Principal')], options);
  render(<App api={api} confirm={() => true} />);
  await userEvent.click(screen.getByRole('button', { name: 'Crear proyecto' }));
  return api;
}
async function openFolderSettings(options: MemoryApiOptions = {}) {
  const api = await mount(options);
  await userEvent.click(await screen.findByRole('button', { name: 'Ajustes' }));
  const dlg = within(await screen.findByRole('region', { name: 'Ajustes' }));
  await dlg.findByRole('heading', { name: 'Claude' });
  await settingsSection('Carpeta del proyecto');
  return { api, dlg };
}
async function openProjectScreen(options: MemoryApiOptions = {}) {
  const api = await mount(options);
  await userEvent.click(within(await screen.findByRole('navigation', { name: 'Secciones' })).getByRole('button', { name: 'Proyecto' }));
  return { api, page: within(await screen.findByRole('region', { name: 'Proyecto' })) };
}

describe('SPEC-096 · el proyecto es la carpeta en la que se trabaja (interfaz)', () => {
  it('[R96.3] «Proyecto» enseña siempre la carpeta, sin conectar, cambiar ni desconectar', async () => {
    const { page } = await openProjectScreen({ workFolder: { name: 'mi-juego', files: 7 } });
    expect(await page.findByText('mi-juego')).toBeTruthy();
    expect(page.getByText('7 archivos')).toBeTruthy();
    expect(page.getByRole('button', { name: 'Analizar de nuevo' })).toBeTruthy();
    expect(page.queryByRole('button', { name: /Cambiar carpeta|Desconectar|Conectar la carpeta/ })).toBeNull();
    expect(page.queryByText(/todavía no trabaja sobre ninguna carpeta/)).toBeNull();
    expect(page.queryByRole('note', { name: /otra carpeta/ })).toBeNull();
  });

  it('[R96.3] el asistente de la carpeta analiza la del proyecto sin pedir que se elija', async () => {
    const { page } = await openProjectScreen({ workFolder: { name: 'mi-juego', files: 7 }, workFolderTree: { files: [], summary: 'mi-juego/\n  src/', docs: [] } });
    await userEvent.click(await page.findByRole('button', { name: 'Analizar de nuevo' }));
    const wiz = within(await screen.findByRole('region', { name: 'Conectar la carpeta del proyecto' }));
    expect(await wiz.findByText('mi-juego')).toBeTruthy();
    expect(await wiz.findByText(/src\//)).toBeTruthy();
    expect(wiz.queryByRole('button', { name: /Elegir carpeta|Cambiar…/ })).toBeNull();
  });

  it('[R96.8] un proyecto antiguo avisa en «Proyecto» y «Unir en <carpeta>» lo deja en una sola', async () => {
    const { api, page } = await openProjectScreen({ workFolder: { name: 'mi-juego', files: 7, separate: true } });
    const note = within(await page.findByRole('note', { name: 'Este proyecto guarda su configuración en otra carpeta' }));
    expect(note.getByText(/No se borra nada/)).toBeTruthy();
    await userEvent.click(note.getByRole('button', { name: 'Unir en mi-juego' }));
    await waitFor(() => expect(page.queryByRole('note', { name: /otra carpeta/ })).toBeNull());
    expect(await api.getWorkFolder()).toEqual({ ok: true, value: { name: 'mi-juego', files: 7 } });
  });

  it('[R96.8] si unir falla, el motivo se ve junto al botón y el aviso sigue; también está en Ajustes', async () => {
    const { dlg } = await openFolderSettings({ workFolder: { name: 'mi-juego', files: 7, separate: true }, joinError: '«mi-juego» ya tiene su propio .orquestador.' });
    const note = within(await dlg.findByRole('note', { name: 'Este proyecto guarda su configuración en otra carpeta' }));
    await userEvent.click(note.getByRole('button', { name: 'Unir en mi-juego' }));
    expect((await note.findByRole('alert')).textContent).toContain('ya tiene su propio .orquestador');
    expect(note.getByRole('button', { name: 'Unir en mi-juego' })).toBeTruthy();
  });

  it('[R96.13] «Orquestador y git» solo se ofrece si la carpeta usa git; elegir «No subir nada» lo guarda y avisa de lo ya subido', async () => {
    const { api, dlg } = await openFolderSettings({ workFolder: { name: 'mi-juego', files: 7 }, gitIgnore: { available: true, exists: true, mode: 'shared' } });
    const group = within(await dlg.findByRole('group', { name: 'Orquestador y git' }));
    expect((group.getByRole('radio', { name: /^Compartir la configuración/ }) as HTMLInputElement).checked).toBe(true);
    expect(group.queryByText(/git rm -r --cached \.orquestador/)).toBeNull();
    await userEvent.click(group.getByRole('radio', { name: /^No subir nada de Orquestador/ }));
    expect(await group.findByText(/git rm -r --cached \.orquestador/)).toBeTruthy();
    expect(await api.getGitIgnore()).toMatchObject({ ok: true, value: { mode: 'all' } });
    await userEvent.click(group.getByRole('radio', { name: /^Compartir la configuración/ }));
    await waitFor(async () => expect(await api.getGitIgnore()).toMatchObject({ ok: true, value: { mode: 'shared' } }));
  });

  it('[R96.13] sin repositorio ni .gitignore la opción no aparece', async () => {
    const { dlg } = await openFolderSettings({ workFolder: { name: 'mi-juego', files: 7 } });
    expect(await dlg.findByText('mi-juego · 7 archivos')).toBeTruthy();
    expect(dlg.queryByRole('group', { name: 'Orquestador y git' })).toBeNull();
  });
});
