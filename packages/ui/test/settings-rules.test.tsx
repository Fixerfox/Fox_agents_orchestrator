// @vitest-environment jsdom
import './setup';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { defaultSettings } from '@orquestador/core';
import { createDiagram } from '@orquestador/editor';
import { App } from '../src/App';
import { openSettingsPage, settingsSection } from './nav';
import { createMemoryApi } from '../src/memoryApi';

async function mount(permissions: 'ask' | 'auto' | 'full' = 'ask') {
  const api = createMemoryApi([createDiagram('principal', 'Principal')], {});
  await api.saveSettings({ ...defaultSettings(), permissions });
  render(<App api={api} confirm={() => true} />);
  await userEvent.click(screen.getByRole('button', { name: 'Crear proyecto' }));
  return api;
}

describe('SPEC-031 · reglas de los agentes en Ajustes', () => {
  it('[R31.14] Ajustes muestra «Reglas de los agentes» con todas las reglas y el límite de los comandos', async () => {
    await mount();
    const s = await openSettingsPage();
    // las reglas viven con los permisos [R67.4]
    await settingsSection('Permisos de los agentes');
    expect(s.getByRole('heading', { name: 'Así trabajan con este nivel' })).toBeTruthy();
    const rules = within(s.getByRole('list', { name: 'Reglas de los agentes' })).getAllByRole('listitem').map((li) => li.textContent ?? '');
    expect(rules).toHaveLength(8);
    for (const start of ['Leer:', 'Crear:', 'Modificar: te preguntan', 'Comandos: los sencillos', 'Por agente:', 'Fuera de la carpeta:', 'Explicar lo que tocan:', 'Registro:']) {
      expect(rules.some((r) => r.startsWith(start))).toBe(true);
    }
    expect(rules.join(' ')).toContain('«Cambios realizados»');
    expect(s.getByText(/Lo que cambie un comando permitido no se registra solo/)).toBeTruthy();
  });

  it('[R31.14] con el nivel «Automático», la regla de modificar lo dice', async () => {
    await mount('auto');
    const s = await openSettingsPage();
    await settingsSection('Permisos de los agentes');
    const list = within(await s.findByRole('list', { name: 'Reglas de los agentes' }));
    expect(list.getByText(/^Modificar: cambian archivos existentes sin preguntar/)).toBeTruthy();
    expect(list.queryByText(/^Modificar: te preguntan/)).toBeNull();
  });
});

describe('SPEC-047 · reglas según el nivel', () => {
  it('[R47.7] la regla de comandos cambia con el nivel: los sencillos, lo delicado o nada', async () => {
    await mount('auto');
    const s = await openSettingsPage();
    await settingsSection('Permisos de los agentes');
    const list = within(await s.findByRole('list', { name: 'Reglas de los agentes' }));
    expect(list.getByText(/^Comandos: no preguntan, salvo para borrar, salir de la carpeta del proyecto o publicar fuera/)).toBeTruthy();
    await userEvent.click(within(s.getByRole('group', { name: 'Permisos de los agentes' })).getByRole('radio', { name: /^Sin preguntar nunca/ }));
    expect(list.getByText(/^Comandos: no preguntan nunca, tampoco para borrar/)).toBeTruthy();
    expect(list.getByText(/^Modificar: cambian archivos existentes sin preguntar/)).toBeTruthy();
  });
});

describe('SPEC-050 · Claude Code en Ajustes', () => {
  it('[R50.10] el interruptor «Cargar la configuración de Claude Code» viene activado y se guarda', async () => {
    const api = await mount('auto');
    const s = await openSettingsPage();
    const box = (await s.findByRole('checkbox', { name: 'Cargar la configuración de Claude Code' })) as HTMLInputElement;
    expect(box.checked).toBe(true);
    expect(s.getByText(/leen CLAUDE\.md y \.claude de la carpeta/)).toBeTruthy();
    await userEvent.click(box);
    await vi.waitFor(async () => {
      const r = await api.getSettings();
      expect(r.ok && r.value.claudeConfig).toBe(false);
    });
  });

  it('[R50.10] con «Sin preguntar nunca», la regla de fuera de la carpeta lo dice y siguen siendo 8 reglas', async () => {
    await mount('full');
    const s = await openSettingsPage();
    await settingsSection('Permisos de los agentes');
    const list = within(await s.findByRole('list', { name: 'Reglas de los agentes' }));
    expect(list.getByText(/^Fuera de la carpeta: con «Sin preguntar nunca» escriben donde haga falta, como Claude Code, salvo en \.orquestador/)).toBeTruthy();
    expect(list.getAllByRole('listitem')).toHaveLength(8);
  });
});
