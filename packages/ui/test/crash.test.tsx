// @vitest-environment jsdom
import './setup';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ErrorBoundary } from '../src/common/ErrorBoundary';

function Broken(): never {
  const c = undefined as unknown as () => never;
  return c();
}

describe('SPEC-019 · un error al pintar', () => {
  it('[R19.12] enseña los detalles con la traza y los componentes, se copian y se apuntan', async () => {
    const logged: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((m: unknown) => void logged.push(String(m)));
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(
      <ErrorBoundary>
        <Broken />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert').textContent).toContain('c is not a function');
    await userEvent.click(screen.getByText('Detalles'));
    expect(screen.getByText(/Componentes:/).textContent).toContain('Broken');
    await userEvent.click(screen.getByRole('button', { name: 'Copiar detalles' }));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Broken'));
    expect(await screen.findByRole('button', { name: 'Copiado' })).toBeTruthy();
    expect(logged.some((l) => l.startsWith('[orquestador:interfaz]') && l.includes('c is not a function'))).toBe(true);
    spy.mockRestore();
  });
});
