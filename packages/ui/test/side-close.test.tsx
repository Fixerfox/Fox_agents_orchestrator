// @vitest-environment jsdom
import './setup';
import { describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { newAgent } from '@orquestador/core';
import { createDiagram } from '@orquestador/editor';
import { App } from '../src/App';
import { createMemoryApi } from '../src/memoryApi';

describe('SPEC-068 · cerrar el lateral de un paso', () => {
  it('[R68.6] cerrar el lateral de un agente lo oculta sin abrir los ajustes del diagrama; esos ajustes siempre tienen «Cerrar»', async () => {
    const api = createMemoryApi([createDiagram('principal', 'Principal')], { agents: [newAgent('pix', 'Pixelador')] });
    render(<App initialProject="Juego" api={api} agents={[]} confirm={() => true} />);
    await userEvent.click(screen.getByRole('button', { name: /^Proyecto «/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Abrir proyecto' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Añadir «Pixelador» al diagrama' }));
    await screen.findByLabelText(/^Agente «pix»/);
    expect(screen.getByRole('complementary', { name: 'Propiedades' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar el panel' }));
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Propiedades' })).toBeNull());
    expect(screen.queryByText('Selecciona un nodo o una conexión')).toBeNull();
    // Los ajustes del diagrama, al pedirlos, llevan su cabecera con «Cerrar»
    await userEvent.click(screen.getByRole('button', { name: /Ajustes del diagrama/ }));
    const side = within(screen.getByRole('complementary', { name: 'Propiedades' }));
    expect(side.getByText('Selecciona un nodo o una conexión')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cerrar los ajustes del diagrama' })).toBeTruthy();
  });
});
