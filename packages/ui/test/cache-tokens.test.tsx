// @vitest-environment jsdom
import './setup';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createDiagram } from '@orquestador/editor';
import { App } from '../src/App';
import { createMemoryApi } from '../src/memoryApi';
import { openSettingsPage, settingsSection } from './nav';

describe('SPEC-083 · los tokens de caché cuentan', () => {
  it('[R83.4] el límite de tokens de Ajustes explica que cuenta la caché y propone el límite de coste', async () => {
    render(<App api={createMemoryApi([createDiagram('principal', 'Principal')], {})} confirm={() => true} />);
    await userEvent.click(screen.getByRole('button', { name: 'Crear proyecto' }));
    const s = await openSettingsPage();
    await settingsSection('Ejecución y presupuesto');
    expect(await s.findByLabelText(/Límite de tokens por defecto/)).toBeTruthy();
    expect(s.getByText(/también lo que sale de la caché/).textContent).toContain('límite de coste en el agente o en el paso');
  });
});
