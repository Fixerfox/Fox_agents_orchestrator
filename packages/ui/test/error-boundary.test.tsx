// @vitest-environment jsdom
import './setup';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from '../src/App';
import { ErrorBoundary } from '../src/common';
import { createMemoryApi } from '../src/memoryApi';
import { ok } from '@orquestador/editor';

describe('la ventana nunca se queda vacía [R19.10]', () => {
  it('[R19.10] un error al pintar deja el mensaje, y «Reintentar» vuelve a pintar', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let broken = true;
    const Bomb = () => {
      if (broken) throw new Error('Se rompió la vista');
      return <p>Todo bien</p>;
    };
    function Page() {
      const [n] = useState(0);
      return (
        <main>
          <nav>Rail {n}</nav>
          <ErrorBoundary>
            <Bomb />
          </ErrorBoundary>
        </main>
      );
    }
    render(<Page />);
    expect(screen.getByRole('alert').textContent).toContain('Se rompió la vista');
    expect(screen.getByRole('alert').textContent).toContain('Las ejecuciones siguen en marcha');
    expect(screen.getByText('Rail 0')).toBeTruthy();
    broken = false;
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(screen.getByText('Todo bien')).toBeTruthy();
  });
});

describe('recargar la interfaz [R19.12]', () => {
  it('[R19.12] vuelve al proyecto abierto sin pasar por la pantalla de inicio', async () => {
    const api = { ...createMemoryApi(), currentProject: async () => ok({ name: 'WebApp' }) };
    render(<App api={api} agents={[]} confirm={() => true} />);
    await waitFor(() => expect(screen.getByText('WebApp')).toBeTruthy());
  });

  it('[R19.12] sin proyecto abierto se queda en la pantalla de inicio', async () => {
    render(<App api={createMemoryApi()} agents={[]} confirm={() => true} />);
    expect(await screen.findByText('¿Qué vas a orquestar?')).toBeTruthy();
  });
});
