// @vitest-environment jsdom
import './setup';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createDiagram } from '@orquestador/editor';
import { App } from '../src/App';
import { createMemoryApi } from '../src/memoryApi';

describe('SPEC-089 · aviso de ajustes dañados', () => {
  it('[R89.6] E89.b: con los ajustes recuperados, la app avisa de que los agentes preguntan', async () => {
    const api = createMemoryApi([createDiagram('principal', 'Principal')], { settingsRecovered: true });
    render(<App api={api} confirm={() => true} />);
    await userEvent.click(screen.getByRole('button', { name: 'Crear proyecto' }));
    expect(await screen.findByText(/Los ajustes estaban dañados/)).toBeTruthy();
  });

  it('[R89.6] sin ajustes dañados no hay aviso', async () => {
    const api = createMemoryApi([createDiagram('principal', 'Principal')]);
    render(<App api={api} confirm={() => true} />);
    await userEvent.click(screen.getByRole('button', { name: 'Crear proyecto' }));
    await screen.findByRole('navigation', { name: 'Secciones' });
    expect(screen.queryByText(/Los ajustes estaban dañados/)).toBeNull();
  });
});
