// @vitest-environment jsdom
import './setup';
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
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
describe('SPEC-032 · varios a la vez [R32.36]', () => {
  it('[R32.36] la paleta no ofrece «Varios a la vez»: un paso se une con varios a mano', () => {
    mount();
    expect(screen.queryByRole('button', { name: '+ Varios a la vez' })).toBeNull();
    expect(screen.queryByRole('dialog', { name: 'Varios a la vez' })).toBeNull();
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
