// @vitest-environment jsdom
import './setup';
import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createDiagram } from '@orquestador/editor';
import { App } from '../src/App';
import { createMemoryApi } from '../src/memoryApi';

beforeEach(() => localStorage.clear());

async function mount(diagrams = [createDiagram('mundo', 'Mundo'), createDiagram('cueva', 'Cueva')], confirm = () => true) {
  const api = createMemoryApi(diagrams);
  render(<App initialProject="Juego" api={api} agents={[{ id: 'sprites', name: 'Sprites' }]} confirm={confirm} />);
  await userEvent.click(screen.getByRole('button', { name: /^Proyecto «/ }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Abrir proyecto' }));
  await screen.findByRole('button', { name: 'Diagrama «Mundo»' });
  return api;
}
const openMenu = async () => {
  await userEvent.click(screen.getByRole('button', { name: /^Diagrama «/ }));
  return within(await screen.findByRole('menu', { name: /^Diagrama «/ }));
};

describe('SPEC-032 · guardar y cargar diagramas [R32.38]', () => {
  it('[R32.38] al abrir un proyecto se abre su primer diagrama, y desde el selector se carga otro', async () => {
    await mount();
    expect(screen.getByRole('button', { name: 'Nombre del diagrama' }).textContent).toBe('Mundo');
    const m = await openMenu();
    await userEvent.click(await m.findByRole('menuitemradio', { name: 'Cueva' }));
    expect(await screen.findByRole('button', { name: 'Diagrama «Cueva»' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Nombre del diagrama' }).textContent).toBe('Cueva');
  });

  it('[R32.38] los cambios se guardan solos y se ven en la barra', async () => {
    const api = await mount();
    await userEvent.click(screen.getByRole('button', { name: '+ Router' }));
    expect(screen.getByText('Sin guardar')).toBeTruthy();
    await waitFor(() => expect(api.saved.get('mundo')!.nodes.some((n) => n.kind === 'router')).toBe(true), { timeout: 2000 });
    await waitFor(() => expect(screen.getByText('Guardado')).toBeTruthy());
  });

  it('[R32.38] cambiar de diagrama guarda antes lo pendiente, sin preguntar', async () => {
    let asked = false;
    const api = await mount(undefined, () => ((asked = true), false));
    await userEvent.click(screen.getByRole('button', { name: '+ Router' }));
    const m = await openMenu();
    await userEvent.click(await m.findByRole('menuitemradio', { name: 'Cueva' }));
    await screen.findByRole('button', { name: 'Diagrama «Cueva»' });
    expect(asked).toBe(false);
    expect(api.saved.get('mundo')!.nodes.some((n) => n.kind === 'router')).toBe(true);
  });

  it('[R32.38] el nombre se edita en el título (Esc cancela) y desde «Renombrar»', async () => {
    const api = await mount();
    await userEvent.click(screen.getByRole('button', { name: 'Nombre del diagrama' }));
    const f = screen.getByRole('textbox', { name: 'Nombre del diagrama' });
    await userEvent.clear(f);
    await userEvent.type(f, 'No vale{Escape}');
    expect(screen.getByRole('button', { name: 'Nombre del diagrama' }).textContent).toBe('Mundo');
    const m = await openMenu();
    await userEvent.click(m.getByRole('menuitem', { name: 'Renombrar' }));
    const g = screen.getByRole('textbox', { name: 'Nombre del diagrama' });
    await userEvent.clear(g);
    await userEvent.type(g, 'Mundo helado{Enter}');
    expect(screen.getByRole('button', { name: 'Diagrama «Mundo helado»' })).toBeTruthy();
    await waitFor(() => expect(api.saved.get('mundo')!.name).toBe('Mundo helado'), { timeout: 2000 });
    // deshacer devuelve el nombre anterior
    await userEvent.keyboard('{Control>}z{/Control}');
    expect(screen.getByRole('button', { name: 'Nombre del diagrama' }).textContent).toBe('Mundo');
  });

  it('[R32.38] duplicar crea una copia con id y nombre propios; eliminar pide confirmación', async () => {
    const answers: boolean[] = [false, true];
    const api = await mount(undefined, () => answers.shift() ?? true);
    let m = await openMenu();
    await userEvent.click(m.getByRole('menuitem', { name: 'Duplicar' }));
    expect(await screen.findByRole('button', { name: 'Diagrama «Mundo (copia)»' })).toBeTruthy();
    const copy = [...api.saved.values()].find((d) => d.name === 'Mundo (copia)')!;
    expect(copy.id).not.toBe('mundo');
    m = await openMenu();
    await userEvent.click(m.getByRole('menuitem', { name: 'Eliminar…' }));
    expect(api.saved.has(copy.id)).toBe(true); // primera vez: no se confirma
    m = await openMenu();
    await userEvent.click(m.getByRole('menuitem', { name: 'Eliminar…' }));
    await waitFor(() => expect(api.saved.has(copy.id)).toBe(false));
    expect(await screen.findByRole('button', { name: /^Diagrama «(Mundo|Cueva)»/ })).toBeTruthy();
  });

  it('[R32.38] una plantilla se abre como diagrama propio con su nombre, sin pisar otro', async () => {
    const api = await mount();
    await userEvent.click(screen.getByRole('button', { name: 'Bucle de revisión' }));
    await userEvent.click(screen.getByRole('button', { name: 'Bucle de revisión' }));
    await waitFor(() => expect([...api.saved.values()].filter((d) => d.name.startsWith('Bucle de revisión'))).toHaveLength(2));
  });
});

describe('SPEC-032 · abrir desde el inicio carga el diagrama guardado [R32.38]', () => {
  const mundo = () => {
    const d = createDiagram('mundo', 'Mundo');
    d.nodes.push({ id: 'router-1', kind: 'router', label: 'Elegir bioma', router: { mode: 'ai' }, position: { x: 200, y: 120 } });
    return d;
  };

  it('[R32.38] «Abrir proyecto» en el inicio abre el diagrama del disco, no uno en blanco', async () => {
    localStorage.clear();
    const api = createMemoryApi([mundo(), createDiagram('cueva', 'Cueva')]);
    render(<App api={api} agents={[]} confirm={() => true} />);
    await userEvent.click(screen.getByRole('button', { name: 'Abrir proyecto' }));
    expect(await screen.findByLabelText(/^Router «Elegir bioma»/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Diagrama «Mundo»' })).toBeTruthy();
    // editar no pisa lo guardado con un diagrama vacío
    await userEvent.click(screen.getByRole('button', { name: '+ Bucle' }));
    await waitFor(() => expect(api.saved.get('mundo')!.nodes.some((n) => n.id === 'router-1')).toBe(true), { timeout: 2000 });
  });

  it('[R32.38] al volver a abrir el proyecto se abre el último diagrama que se usó', async () => {
    localStorage.clear();
    const api = createMemoryApi([mundo(), createDiagram('cueva', 'Cueva')]);
    render(<App api={api} agents={[]} confirm={() => true} />);
    await userEvent.click(screen.getByRole('button', { name: 'Abrir proyecto' }));
    await screen.findByRole('button', { name: 'Diagrama «Mundo»' });
    await userEvent.click(screen.getByRole('button', { name: 'Abrir el diagrama «Cueva»' }));
    await screen.findByRole('button', { name: 'Diagrama «Cueva»' });
    await userEvent.click(screen.getByRole('button', { name: /^Proyecto «/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Cerrar proyecto' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Abrir proyecto' }));
    expect(await screen.findByRole('button', { name: 'Diagrama «Cueva»' })).toBeTruthy();
  });
});
