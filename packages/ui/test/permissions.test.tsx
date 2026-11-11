// @vitest-environment jsdom
import './setup';
import { describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { defaultSettings, newAgent } from '@orquestador/core';
import { createDiagram } from '@orquestador/editor';
import { App } from '../src/App';
import { createMemoryApi, type MemoryApiOptions } from '../src/memoryApi';
import { goLib } from './nav';

async function mount(options: MemoryApiOptions = {}, permissions: 'ask' | 'auto' | 'full' = 'auto') {
  const api = createMemoryApi([createDiagram('principal', 'Principal')], { agents: [{ ...newAgent('rev', 'Revisor'), description: 'Revisa' }], ...options });
  await api.saveSettings({ ...defaultSettings(), permissions });
  render(<App initialProject="Juego" api={api} agents={[]} confirm={() => true} />);
  await userEvent.click(screen.getByRole('button', { name: /^Proyecto «/ }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Abrir proyecto' }));
  await screen.findByRole('button', { name: 'Añadir «Revisor» al diagrama' });
  return api;
}

describe('SPEC-047 · permisos en la ficha del agente', () => {
  it('[R47.12] por defecto usa el del proyecto; se puede poner «Solo lectura», se guarda y la tarjeta lo muestra', async () => {
    const api = await mount({}, 'ask');
    const s = await goLib('agents');
    await userEvent.click(s.getByRole('button', { name: 'Revisor' }));
    await userEvent.click(s.getByRole('button', { name: /^Qué puede hacer/ }));
    const perms = within(s.getByRole('group', { name: 'Qué puede hacer sin preguntarte' }));
    expect(perms.getAllByRole('radio')).toHaveLength(5);
    await waitFor(() => expect((perms.getByRole('radio', { name: /^El del proyecto \(Preguntar\)/ }) as HTMLInputElement).checked).toBe(true));
    await userEvent.click(perms.getByRole('radio', { name: /^Solo lectura/ }));
    // el resumen de la sección y la tarjeta (en «Modelo y aspecto») lo dicen [R57.5]
    expect(s.getByRole('button', { name: /^Qué puede hacer/ }).textContent).toContain('Solo lectura');
    await userEvent.click(s.getByRole('button', { name: /^Modelo y aspecto/ }));
    expect(s.getByText('Permisos: Solo lectura')).toBeTruthy();
    await userEvent.click(s.getAllByRole('button', { name: 'Guardar' }).find((b) => b.getAttribute('type') === 'submit')!);
    await waitFor(() => expect(api.agents.get('rev')).toMatchObject({ permissions: 'readonly' }));
  });

  it('[R47.12] volver a «El del proyecto» quita el nivel propio', async () => {
    const api = await mount({ agents: [{ ...newAgent('rev', 'Revisor'), description: 'Revisa', permissions: 'full' }] });
    const s = await goLib('agents');
    await userEvent.click(s.getByRole('button', { name: 'Revisor' }));
    await userEvent.click(s.getByRole('button', { name: /^Qué puede hacer/ }));
    const perms = within(s.getByRole('group', { name: 'Qué puede hacer sin preguntarte' }));
    expect((perms.getByRole('radio', { name: /^Sin preguntar nunca/ }) as HTMLInputElement).checked).toBe(true);
    expect(perms.getByText(/podrán borrar archivos/)).toBeTruthy();
    await userEvent.click(perms.getByRole('radio', { name: /^El del proyecto \(Automático\)/ }));
    await userEvent.click(s.getAllByRole('button', { name: 'Guardar' }).find((b) => b.getAttribute('type') === 'submit')!);
    await waitFor(() => expect(api.agents.get('rev')?.permissions).toBeUndefined());
  });

  it('[R47.11] «Proyecto · Acceso» muestra el nivel de los permisos', async () => {
    await mount({ workFolder: { name: 'INCWars', files: 10 } }, 'full');
    const rail = within(screen.getByRole('navigation', { name: 'Secciones' }));
    await userEvent.click(rail.getByRole('button', { name: 'Proyecto' }));
    const access = within(await screen.findByRole('region', { name: 'Acceso' }));
    expect(access.getByText(/^Permisos: Sin preguntar nunca\./)).toBeTruthy();
  });
});
