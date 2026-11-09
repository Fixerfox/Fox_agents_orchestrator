// @vitest-environment jsdom
import './setup';
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { defaultSettings } from '@orquestador/core';
import { SettingsDialog } from '../src/settings/SettingsDialog';
import { createMemoryApi, type MemoryApiOptions } from '../src/memoryApi';

async function mount(opts: { project?: boolean; engine?: 'simulated' | 'claude'; api?: MemoryApiOptions } = {}) {
  const api = createMemoryApi([], opts.api ?? {});
  if (opts.engine) await api.saveSettings({ ...defaultSettings(), engine: opts.engine });
  if (opts.project) await api.createProject();
  render(<SettingsDialog api={api} onSaved={() => undefined} />);
  const page = within(screen.getByRole('region', { name: 'Ajustes' }));
  await page.findByRole('heading', { name: 'Claude' });
  return { api, page, index: within(page.getByRole('navigation', { name: 'Ajustes' })) };
}
const titles = () => [...document.querySelectorAll('.orq-setnav__title')].map((x) => x.textContent);
const groups = () => [...document.querySelectorAll('.orq-setnav__label')].map((x) => x.textContent);

describe('SPEC-067 · Ajustes por secciones', () => {
  it('[R67.1] índice «General» (y «Este proyecto» con proyecto), con resumen y una sección cada vez', async () => {
    const { page, index } = await mount({ project: true });
    expect(groups()).toEqual(['General', 'Este proyecto']);
    expect(titles()).toEqual(['Claude', 'Permisos de los agentes', 'Supervisor', 'Ejecución y presupuesto', 'Límites de tiempo', 'Memoria', 'Apariencia', 'Carpeta de trabajo']);
    expect(index.getByRole('button', { name: /^Claude/ }).getAttribute('aria-current')).toBe('page');
    expect(index.getByRole('button', { name: /^Ejecución y presupuesto/ }).textContent).toContain('4 en paralelo · sin límite');
    expect(index.getByRole('button', { name: /^Carpeta de trabajo/ }).textContent).toContain('Sin elegir');
    expect(page.queryByLabelText(/Agentes en paralelo/)).toBeNull();
    await userEvent.click(index.getByRole('button', { name: /^Ejecución y presupuesto/ }));
    expect(page.getByRole('heading', { name: 'Ejecución y presupuesto' })).toBeTruthy();
    expect(index.getByRole('button', { name: /^Ejecución y presupuesto/ }).getAttribute('aria-current')).toBe('page');
    expect(page.getByLabelText(/Agentes en paralelo/)).toBeTruthy();
    expect(page.queryByLabelText('Modelo por defecto')).toBeNull();
  });

  it('[R67.1] sin proyecto abierto no hay grupo «Este proyecto»', async () => {
    await mount();
    expect(groups()).toEqual(['General']);
    expect(titles()).not.toContain('Carpeta de trabajo');
  });

  it('[R67.2] la tarjeta de estado: simulado, sin probar y «Claude responde» con el mensaje', async () => {
    const sim = await mount();
    expect(sim.page.getByText('Motor simulado: no se conecta ni gasta')).toBeTruthy();
    document.body.innerHTML = '';
    const { page, index } = await mount({ engine: 'claude', api: { connection: { ok: true, message: 'Claude responde correctamente.', model: 'claude-sonnet-5-5', ms: 321 } } });
    expect(page.getByText('Sin probar todavía')).toBeTruthy();
    await userEvent.click(page.getByRole('button', { name: 'Probar conexión' }));
    expect(await page.findByText('Claude responde')).toBeTruthy();
    expect(page.getByRole('status').textContent).toBe('Claude responde correctamente. Modelo claude-sonnet-5-5, 321 ms.');
    expect(index.getByRole('button', { name: /^Claude/ }).textContent).toContain('Conectado · Sonnet 5.5');
  });

  it('[R67.2] si falla, la tarjeta dice «No se pudo conectar» con el motivo como alerta', async () => {
    const { page } = await mount({ engine: 'claude', api: { connection: { ok: false, message: 'Falta la clave API. Guárdala en Ajustes.', model: 'claude-sonnet-5-5', ms: 0 } } });
    await userEvent.click(page.getByRole('button', { name: 'Probar conexión' }));
    expect(await page.findByText('No se pudo conectar')).toBeTruthy();
    expect(page.getByRole('alert').textContent).toBe('No se pudo conectar: Falta la clave API. Guárdala en Ajustes.');
  });

  it('[R67.3] motor y conexión son tarjetas con explicación; modelo y Claude Code son filas', async () => {
    const { page } = await mount();
    const real = page.getByRole('radio', { name: 'Claude (real)' });
    expect(real.getAttribute('aria-describedby')).toBeTruthy();
    expect(document.getElementById(real.getAttribute('aria-describedby')!)!.textContent).toMatch(/^Claude Code completo/);
    expect(page.getByRole('radio', { name: 'Clave API' })).toBeTruthy();
    expect(page.getByLabelText('Modelo por defecto').closest('.orq-setrow')).toBeTruthy();
    expect(page.getByRole('checkbox', { name: 'Cargar la configuración de Claude Code' }).closest('.orq-setrow')).toBeTruthy();
    await userEvent.click(real);
    expect(real.closest('.orq-choice__opt')!.classList.contains('is-on')).toBe(true);
  });

  it('[R67.4] «Permisos de los agentes» tiene el selector y, debajo, las reglas de su nivel, también sin proyecto', async () => {
    const { page, index } = await mount();
    await userEvent.click(index.getByRole('button', { name: /^Permisos de los agentes/ }));
    expect(page.getByRole('group', { name: 'Permisos de los agentes' })).toBeTruthy();
    const list = within(page.getByRole('list', { name: 'Reglas de los agentes' }));
    expect(list.getAllByRole('listitem')).toHaveLength(8);
    await userEvent.click(within(page.getByRole('group', { name: 'Permisos de los agentes' })).getByRole('radio', { name: /^Automático/ }));
    expect(list.getByText(/^Modificar: cambian archivos existentes sin preguntar/)).toBeTruthy();
    expect(index.getByRole('button', { name: /^Permisos de los agentes/ }).textContent).toContain('Automático');
  });

  it('[R67.6] los niveles son una escala y la tabla dice qué pasa con cada uno, resaltando el elegido', async () => {
    const { page, index } = await mount();
    await userEvent.click(index.getByRole('button', { name: /^Permisos de los agentes/ }));
    const table = within(page.getByRole('table', { name: 'Lo que pasará con cada nivel' }));
    expect(table.getAllByRole('columnheader').map((c) => c.textContent)).toEqual(['Acción', 'Preguntar', 'Automático', 'Sin preguntar nunca']);
    expect(table.getAllByRole('row')).toHaveLength(10);
    const cells = (name: string) => within(table.getByRole('rowheader', { name }).closest('tr')!).getAllByRole('cell').map((c) => c.textContent?.trim());
    expect(cells('Borrar')).toEqual(['? Pregunta', '? Pregunta', '✓ Sí']);
    expect(cells('Escribir fuera de la carpeta')).toEqual(['✕ Nunca', '✕ Nunca', '✓ Sí']);
    // por defecto «Sin preguntar nunca» [R51.1]
    expect(table.getByRole('columnheader', { name: 'Sin preguntar nunca' }).getAttribute('aria-current')).toBe('true');
    await userEvent.click(within(page.getByRole('group', { name: 'Permisos de los agentes' })).getByRole('radio', { name: /^Preguntar/ }));
    expect(table.getByRole('columnheader', { name: 'Preguntar' }).getAttribute('aria-current')).toBe('true');
    expect(table.getByRole('columnheader', { name: 'Sin preguntar nunca' }).getAttribute('aria-current')).toBeNull();
  });

  it('[R67.5] al pie del índice: «Los cambios se guardan al momento» y el estado del guardado', async () => {
    const { page, index } = await mount();
    const aside = page.getByText(/Los cambios se guardan al momento/).closest('aside')!;
    expect(aside).toBeTruthy();
    await userEvent.click(index.getByRole('button', { name: /^Apariencia/ }));
    await userEvent.click(index.getByRole('button', { name: /^Supervisor/ }));
    await userEvent.click(page.getByRole('checkbox', { name: 'Revisar con IA que cada paso hizo lo pedido' }));
    expect(within(aside).getByRole('status').textContent).toMatch(/Guardando…|Ajustes guardados/);
    expect(await within(aside).findByText('Ajustes guardados')).toBeTruthy();
  });
});
