// @vitest-environment jsdom
import './setup';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../src/App';
import { createMemoryApi } from '../src/memoryApi';

const errorAlert = () => screen.queryAllByRole('alert').find((a) => /disco lleno/.test(a.textContent ?? ''));

describe('SPEC-049 · cerrar los avisos de error', () => {
  it('[R49.1] el aviso de error se cierra con «Cerrar aviso» y vuelve a salir si el error se repite', async () => {
    const api = createMemoryApi();
    render(<App initialProject="Proyecto" api={api} agents={[]} confirm={() => true} />);
    await userEvent.click(screen.getByRole('button', { name: /^Proyecto «/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Abrir proyecto' }));
    await waitFor(() => expect(api.saved.has('principal')).toBe(true));
    api.saveDiagram = async () => ({ ok: false, error: { code: 'io', message: 'disco lleno' } }) as never;
    await userEvent.click(screen.getByRole('button', { name: '+ Router' }));
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => expect(errorAlert()).toBeTruthy());
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar aviso' }));
    expect(errorAlert()).toBeUndefined();
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => expect(errorAlert()).toBeTruthy());
  });
});
