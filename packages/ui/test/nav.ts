import { expect } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/** Contenido de la sección actual (Agentes, Conocimiento, Ajustes…) [R32.13]. */
export const content = () => within(screen.getByTestId('content'));

/** Va a Agentes o a Conocimiento › Contextos/Skills desde el rail global [R32.13]. */
export async function goLib(tab: 'agents' | 'contexts' | 'skills') {
  const rail = within(screen.getByRole('navigation', { name: 'Secciones' }));
  if (tab === 'agents') {
    await userEvent.click(rail.getByRole('button', { name: 'Agentes' }));
    await screen.findByRole('region', { name: 'Agentes' });
  } else {
    await userEvent.click(rail.getByRole('button', { name: 'Conocimiento' }));
    const region = within(await screen.findByRole('region', { name: 'Conocimiento' }));
    await userEvent.click(region.getByRole('tab', { name: tab === 'contexts' ? /Contextos/ : /Skills/ }));
  }
  return content();
}

/** Abre la página de Ajustes desde el rail (o desde el botón de la pantalla de inicio). */
export async function openSettingsPage() {
  const nav = screen.queryByRole('navigation', { name: 'Secciones' });
  await userEvent.click(nav ? within(nav).getByRole('button', { name: 'Ajustes' }) : screen.getByRole('button', { name: 'Ajustes' }));
  return within(await screen.findByRole('region', { name: 'Ajustes' }));
}

/** Los ajustes se guardan solos: espera a que termine el guardado [R32.25]. */
export async function settingsSaved() {
  await new Promise((r) => setTimeout(r, 400));
  await waitFor(() => expect(screen.getByText('Ajustes guardados')).toBeTruthy());
}

/** Abre una pestaña del paso agente en el lateral («Tarea», «Agente», «Conocimiento» o «Permisos») [R66.6]. */
export async function stepTab(name: 'Tarea' | 'Agente' | 'Conocimiento' | 'Permisos') {
  const side = within(screen.getByRole('complementary', { name: 'Propiedades' }));
  await userEvent.click(side.getByRole('tab', { name: new RegExp(`^${name}`) }));
  return side;
}

/** Abre una sección de Ajustes desde su índice («Claude», «Permisos de los agentes»…) [R67.1]. */
export async function settingsSection(name: string) {
  const page = within(screen.getByRole('region', { name: 'Ajustes' }));
  await userEvent.click(within(page.getByRole('navigation', { name: 'Ajustes' })).getByRole('button', { name: new RegExp(`^${name}`) }));
  return page;
}
