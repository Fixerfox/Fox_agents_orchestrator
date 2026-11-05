// @vitest-environment jsdom
import './setup';
import { describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createDiagram } from '@orquestador/editor';
import { App } from '../src/App';
import { settingsSaved } from './nav';
import { createMemoryApi, type MemoryApiOptions } from '../src/memoryApi';

async function openSettings(options: MemoryApiOptions = {}, createProject = true) {
  const api = createMemoryApi([createDiagram('principal', 'Principal')], options);
  render(<App api={api} confirm={() => true} />);
  if (createProject) await userEvent.click(screen.getByRole('button', { name: 'Crear proyecto' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Ajustes' }));
  return { api, dlg: within(await screen.findByRole('region', { name: 'Ajustes' })) };
}

describe('SPEC-031 · carpeta de trabajo en Ajustes', () => {
  it('[R31.1] sin carpeta lo explica y ofrece elegirla; al elegirla muestra nombre y número de archivos, nunca la ruta', async () => {
    const { dlg } = await openSettings({ workFolderPick: { name: 'mi-juego', files: 42 } });
    expect(await dlg.findByText(/Sin carpeta: los agentes trabajan en la carpeta del proyecto/)).toBeTruthy();
    await userEvent.click(dlg.getByRole('button', { name: 'Elegir carpeta…' }));
    expect(await dlg.findByText('mi-juego · 42 archivos')).toBeTruthy();
    expect(dlg.getByRole('button', { name: 'Cambiar carpeta…' })).toBeTruthy();
  });

  it('[R31.1] cancelar el diálogo del sistema no cambia nada y «Quitar carpeta» la deja sin elegir', async () => {
    const { dlg, api } = await openSettings();
    await userEvent.click(await dlg.findByRole('button', { name: 'Elegir carpeta…' }));
    expect(dlg.queryByText(/archivos$/)).toBeNull();
    const picked = await createMemoryApi([], { workFolderPick: { name: 'x', files: 1 } }).pickWorkFolder();
    expect(picked.ok && picked.value).toEqual({ name: 'x', files: 1 });
    expect(await api.getWorkFolder()).toEqual({ ok: true, value: null });
  });

  it('[R31.1] quitar la carpeta vuelve al estado inicial', async () => {
    const { dlg } = await openSettings({ workFolderPick: { name: 'mi-juego', files: 3 } });
    await userEvent.click(await dlg.findByRole('button', { name: 'Elegir carpeta…' }));
    await userEvent.click(await dlg.findByRole('button', { name: 'Quitar carpeta' }));
    expect(await dlg.findByText(/Sin carpeta/)).toBeTruthy();
  });

  it('[R31.1] desde la pantalla de inicio, sin proyecto, la sección no aparece', async () => {
    const api = createMemoryApi([createDiagram('principal', 'Principal')]);
    render(<App api={api} confirm={() => true} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Ajustes' }));
    const dlg = within(await screen.findByRole('region', { name: 'Ajustes' }));
    await waitFor(() => expect(dlg.getByRole('heading', { name: 'Claude' })).toBeTruthy());
    expect(dlg.queryByText('Carpeta de trabajo')).toBeNull();
  });

  it('[R31.4][R47.11][R51.1] los permisos están en «Sin preguntar nunca» por defecto, se cambian y se guardan', async () => {
    const { dlg, api } = await openSettings();
    const perms = within(await dlg.findByRole('group', { name: 'Permisos de los agentes' }));
    expect((perms.getByRole('radio', { name: /^Sin preguntar nunca/ }) as HTMLInputElement).checked).toBe(true);
    expect(dlg.getByText('Cada agente puede tener sus propios permisos en su ficha.')).toBeTruthy();
    await userEvent.click(perms.getByRole('radio', { name: /^Preguntar/ }));
    await settingsSaved();
    await waitFor(async () => expect(await api.getSettings()).toMatchObject({ ok: true, value: { permissions: 'ask' } }));
  });

  it('[R31.6] listar y restaurar copias de una ejecución', async () => {
    const api = createMemoryApi([createDiagram('principal', 'Principal')], { backups: { r1: { 'src/a.ts': 'antes', 'b.md': 'x' } } });
    expect(await api.listBackups('r1')).toEqual({ ok: true, value: ['b.md', 'src/a.ts'] });
    expect(await api.restoreBackup({ runId: 'r1', path: 'src/a.ts' })).toEqual({ ok: true, value: true });
    expect(await api.restoreBackup({ runId: 'r1', path: 'nada.ts' })).toEqual({ ok: true, value: false });
    expect(api.restored).toEqual(['r1:src/a.ts']);
  });
});
