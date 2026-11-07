// @vitest-environment jsdom
import './setup';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../src/App';
import { createMemoryApi } from '../src/memoryApi';

const AGENTS = [{ id: 'sprites', name: 'Sprites' }];
const mount = (confirm = () => true) => {
  const api = createMemoryApi();
  const r = render(<App initialProject="Proyecto" api={api} agents={AGENTS} confirm={confirm} />);
  return { api, ...r };
};
const status = () => screen.getByText(/^(Guardado|Sin guardar|Guardando…)$/).textContent;

describe('abrir una ejecución desde un aviso [R61.11]', () => {
  it('[R61.11] lleva a Ejecuciones; en «En directo» si sigue en marcha y en «Historial» si ha terminado', async () => {
    let open: Parameters<ReturnType<typeof createMemoryApi>['onOpenRun']>[0] | undefined;
    const off = vi.fn();
    const api = { ...createMemoryApi(), onOpenRun: (l: NonNullable<typeof open>) => ((open = l), off) };
    const r = render(<App initialProject="Proyecto" api={api} agents={AGENTS} confirm={() => true} />);
    await waitFor(() => expect(open).toBeDefined());
    act(() => open!({ runId: 'nadie', live: true }));
    expect(await screen.findByRole('button', { name: /En directo/, current: 'page' })).toBeTruthy();
    act(() => open!({ runId: 'nadie', live: false }));
    expect(await screen.findByRole('button', { name: /Historial/, current: 'page' })).toBeTruthy();
    r.unmount();
    expect(off).toHaveBeenCalled();
  });
});

describe('aplicación [R14.1][R14.11]', () => {
  it('[R14.11] los nodos son enfocables y tienen nombre accesible con su tipo', async () => {
    mount();
    const entry = await screen.findByLabelText('Entrada «Entrada»');
    expect(entry.getAttribute('tabindex')).toBe('0');
    expect(screen.getByLabelText('Salida «Salida»')).toBeTruthy();
  });

  it('[R14.2][R14.11] añadir un agente crea un nodo; sin conectar, el nombre indica el problema', async () => {
    mount();
    await userEvent.click(screen.getByRole('button', { name: '+ Agente' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Sprites/ }));
    expect(await screen.findByLabelText('Agente «sprites», 1 problemas')).toBeTruthy();
    expect(screen.getByRole('button', { name: '1 aviso' })).toBeTruthy();
  });

  it('[R14.11] Ctrl+Z deshace y Ctrl+Y rehace', async () => {
    mount();
    await userEvent.click(screen.getByRole('button', { name: '+ Router' }));
    await screen.findByLabelText(/^Router «Router»/);
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    await waitFor(() => expect(screen.queryByLabelText(/^Router «Router»/)).toBeNull());
    fireEvent.keyDown(window, { key: 'y', ctrlKey: true });
    expect(await screen.findByLabelText(/^Router «Router»/)).toBeTruthy();
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    fireEvent.keyDown(window, { key: 'Z', ctrlKey: true, shiftKey: true });
    expect(await screen.findByLabelText(/^Router «Router»/)).toBeTruthy();
  });

  it('[R14.11] los atajos no se activan al escribir en un campo', async () => {
    mount();
    await userEvent.click(screen.getByRole('button', { name: '+ Router' }));
    await screen.findByLabelText(/^Router «Router»/);
    const field = screen.getByRole('searchbox', { name: 'Buscar nodo' });
    fireEvent.keyDown(field, { key: 'z', ctrlKey: true, bubbles: true });
    expect(screen.getByLabelText(/^Router «Router»/)).toBeTruthy();
  });

  it('[R14.5][R14.11][R32.38] Ctrl+S guarda con el proyecto abierto y limpia el indicador', async () => {
    const { api } = mount();
    await userEvent.click(screen.getByRole('button', { name: /^Proyecto «/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Abrir proyecto' }));
    // al abrir un proyecto sin diagramas se crea y guarda «Principal»
    await waitFor(() => expect(api.saved.has('principal')).toBe(true));
    await userEvent.click(screen.getByRole('button', { name: '+ Router' }));
    expect(status()).toBe('Sin guardar');
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => expect(status()).toBe('Guardado'));
    const saved = api.saved.get('principal')!;
    expect(saved.nodes.some((n) => n.kind === 'router')).toBe(true);
    expect(saved.nodes.every((n) => n.position !== undefined)).toBe(true);
  });

  it('[R14.5] sin proyecto abierto no hay editor, así que no se puede guardar', () => {
    render(<App api={createMemoryApi()} agents={AGENTS} confirm={() => true} />);
    expect(screen.queryByRole('button', { name: 'Guardar' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Crear proyecto' })).toBeTruthy();
  });

  it('[R14.9][R32.38] cargar una plantilla guarda antes lo pendiente (sin preguntar) y la abre como diagrama propio', async () => {
    const confirm = vi.fn(() => false);
    const { api } = mount(confirm);
    await userEvent.click(screen.getByRole('button', { name: '+ Router' }));
    const ex = await screen.findByRole('button', { name: 'Bucle de revisión' });
    await userEvent.click(ex);
    expect(confirm).not.toHaveBeenCalled();
    expect(await screen.findByLabelText(/^Bucle «Revisión»/)).toBeTruthy();
    await waitFor(() => expect([...api.saved.values()].some((d) => d.nodes.some((n) => n.kind === 'router'))).toBe(true));
    await waitFor(() => expect(status()).toBe('Guardado'));
    expect(screen.getByRole('button', { name: 'Nombre del diagrama' }).textContent).toBe('Bucle de revisión');
  });

  it('[R14.8] doble clic en un bucle entra en él y las migas permiten volver', async () => {
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Bucle de revisión' }));
    const loop = await screen.findByLabelText(/^Bucle «Revisión»/);
    fireEvent.doubleClick(loop);
    expect(await screen.findByLabelText(/^Agente «revisor»/)).toBeTruthy();
    const crumbs = within(screen.getByRole('navigation', { name: 'Ruta de navegación' }));
    await userEvent.click(crumbs.getByRole('button', { name: 'Bucle de revisión' }));
    expect(await screen.findByLabelText(/^Agente «creador»/)).toBeTruthy();
  });

  it('[R14.1][R32.38] Nuevo abre un diagrama vacío con nombre propio, listo para renombrar', async () => {
    const { api } = mount();
    await userEvent.click(screen.getByRole('button', { name: '+ Router' }));
    await userEvent.click(screen.getByRole('button', { name: 'Nuevo' }));
    await waitFor(() => expect(screen.queryByLabelText(/^Router «Router»/)).toBeNull());
    const field = (await screen.findByRole('textbox', { name: 'Nombre del diagrama' })) as HTMLInputElement;
    expect(field.value).toBe('Diagrama nuevo');
    await userEvent.clear(field);
    await userEvent.type(field, 'Mundo de hielo{Enter}');
    expect(screen.getByRole('button', { name: 'Nombre del diagrama' }).textContent).toBe('Mundo de hielo');
    await waitFor(() => expect([...api.saved.values()].some((d) => d.name === 'Mundo de hielo')).toBe(true));
    // un segundo «Nuevo» no pisa el anterior
    await userEvent.click(screen.getByRole('button', { name: 'Nuevo' }));
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(api.saved.size).toBeGreaterThanOrEqual(2));
  });
});
