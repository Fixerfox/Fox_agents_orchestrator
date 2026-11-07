// @vitest-environment jsdom
import './setup';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../src/App';
import { InsertPicker, type InsertChoice } from '../src/diagrams/InsertPicker';
import { createMemoryApi } from '../src/memoryApi';

const AGENTS = [{ id: 'sprites', name: 'Sprites', description: 'Dibuja' }];
const mount = () => render(<App initialProject="Proyecto" api={createMemoryApi()} agents={AGENTS} confirm={() => true} />);
const card = () => screen.findByLabelText(/^Transformar «Transformar»/);
const selectCard = async () => fireEvent.click((await card()).closest('.react-flow__node')!);

describe('SPEC-037 · nodo Transformar en el editor', () => {
  it('[R37.11][R37.14] la paleta lo añade con su icono y el subtítulo «JSON · por reglas»', async () => {
    mount();
    await userEvent.click(screen.getByRole('button', { name: '+ Transformar' }));
    const el = (await card()).closest('.react-flow__node') as HTMLElement;
    expect(el.textContent).toContain('JSON · por reglas');
    expect(el.querySelector('svg.lucide-braces')).toBeTruthy();
  });

  it('[R37.11] el botón derecho del lienzo ofrece «Transformar aquí»', async () => {
    mount();
    fireEvent.contextMenu(document.querySelector('.react-flow__pane')!, { clientX: 300, clientY: 200 });
    const menu = await screen.findByRole('menu');
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toContain('Transformar aquí');
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Transformar aquí' }));
    expect(await card()).toBeTruthy();
  });

  it('[R37.11] el botón derecho de una conexión la inserta en medio', async () => {
    mount();
    await waitFor(() => expect(document.querySelectorAll('.react-flow__edge').length).toBe(1));
    fireEvent.contextMenu(document.querySelector('.react-flow__edge')!);
    await userEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Insertar transformación' }));
    expect(await card()).toBeTruthy();
    await waitFor(() => expect(document.querySelectorAll('.react-flow__edge').length).toBe(2));
    await selectCard();
    const recv = within(await screen.findByRole('group', { name: 'Transformar' })).getByLabelText('Recibe:');
    expect(recv.textContent).toContain('@entrada');
  });

  it('[R37.11] el «+» de una conexión ofrece «Transformar · cambia el formato»', async () => {
    const picks: InsertChoice[] = [];
    render(<InsertPicker agents={AGENTS} at={{ x: 100, y: 100 }} onPick={(c) => picks.push(c)} onClose={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Transformar · cambia el formato' }));
    expect(picks).toEqual([{ kind: 'transform' }]);
    await userEvent.type(screen.getByLabelText(/Busca/i), 'formato');
    expect(screen.getByRole('button', { name: 'Transformar · cambia el formato' })).toBeTruthy();
  });

  it('[R37.12] el panel cambia modo y formato, avisa de un esquema que no es JSON y explica qué hará', async () => {
    mount();
    await userEvent.click(screen.getByRole('button', { name: '+ Transformar' }));
    await selectCard();
    const panel = await screen.findByRole('group', { name: 'Transformar' });
    expect(within(panel).getByText(/Sin IA: rellena la plantilla/)).toBeTruthy();
    expect(within(panel).getByLabelText('Plantilla')).toBeTruthy();

    const schema = within(panel).getByLabelText('Esquema JSON (opcional)');
    await userEvent.type(schema, '{{mal');
    expect(within(panel).getByRole('alert').textContent).toBe('El esquema no es un objeto JSON válido');

    await userEvent.selectOptions(within(panel).getByLabelText('Cómo se convierte'), 'ai');
    const panel2 = await screen.findByRole('group', { name: 'Transformar' });
    expect(within(panel2).getByLabelText('Instrucciones para Claude')).toBeTruthy();
    expect(within(panel2).getByLabelText('Intentos si no cumple el formato')).toBeTruthy();
    expect(within(panel2).getByText(/Claude verá lo que llega/)).toBeTruthy();
    expect((await card()).closest('.react-flow__node')!.textContent).toContain('JSON · con Claude');

    await userEvent.selectOptions(within(panel2).getByLabelText('Formato de salida'), 'markdown');
    await waitFor(() => expect(within(screen.getByRole('group', { name: 'Transformar' })).queryByLabelText('Esquema JSON (opcional)')).toBeNull());
  });

  it('[R37.13] sin ejecuciones, la vista previa aplica las reglas al ejemplo pegado, sin tokens', async () => {
    mount();
    await userEvent.click(screen.getByRole('button', { name: '+ Transformar' }));
    await selectCard();
    const panel = await screen.findByRole('group', { name: 'Transformar' });
    const preview = within(panel).getByRole('region', { name: 'Vista previa' });
    expect(within(preview).getByText(/Aún no hay ninguna ejecución/)).toBeTruthy();

    fireEvent.change(within(preview).getByLabelText('Ejemplo de entrada'), { target: { value: 'Listo: {"titulo":"Plan"}' } });
    fireEvent.blur(within(preview).getByLabelText('Ejemplo de entrada'));
    const out = await screen.findByTestId('tf-out');
    expect(JSON.parse(out.textContent!)).toEqual({ titulo: 'Plan' });

    const tpl = within(screen.getByRole('group', { name: 'Transformar' })).getByLabelText('Plantilla');
    fireEvent.change(tpl, { target: { value: '{"t": {{json.titulo}}' } });
    fireEvent.blur(tpl);
    await waitFor(() => expect(screen.getByRole('group', { name: 'Transformar' }).textContent).toContain('No se puede transformar'));
  });
});
