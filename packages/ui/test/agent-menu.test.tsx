// @vitest-environment jsdom
import './setup';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { newAgent, newContext, newSkill, type AgentDefinition } from '@orquestador/core';
import { createDiagram } from '@orquestador/editor';
import { App } from '../src/App';
import { createMemoryApi, type MemoryApiOptions } from '../src/memoryApi';
import { goLib } from './nav';

const agent = (id: string, name: string, patch: Partial<AgentDefinition> = {}): AgentDefinition => ({ ...newAgent(id, name), ...patch });
const OPTIONS: MemoryApiOptions = {
  agents: [agent('pix', 'Pixelador', { description: 'Pinta', skillIds: ['paleta'], contextIds: ['glosario'] }), agent('rev', 'Revisor', { description: 'Revisa' })],
  skills: [{ ...newSkill('paleta', 'Paleta'), description: 'Colores del juego' }],
  contexts: [{ ...newContext('glosario', 'Glosario'), value: 'Términos' }],
  skillFiles: { paleta: { 'referencias/colores.md': '# Colores' } },
};
async function mount(options: MemoryApiOptions = OPTIONS) {
  const api = createMemoryApi([createDiagram('principal', 'Principal')], options);
  render(<App initialProject="Juego" api={api} agents={[]} confirm={() => true} />);
  await userEvent.click(screen.getByRole('button', { name: /^Proyecto «/ }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Abrir proyecto' }));
  await screen.findByRole('button', { name: 'Añadir «Pixelador» al diagrama' });
  return api;
}
const menu = () => within(screen.getByRole('menu'));

describe('SPEC-032 · agentes a mano', () => {
  it('[R32.34] el botón derecho sobre un agente del lienzo lleva a editarlo, cambiarlo y a sus skills y contextos', async () => {
    await mount();
    await userEvent.click(screen.getByRole('button', { name: 'Añadir «Pixelador» al diagrama' }));
    const node = await screen.findByLabelText(/^Agente «pix»/);
    fireEvent.contextMenu(node);
    const items = menu().getAllByRole('menuitem').map((b) => b.textContent);
    expect(items.slice(0, 2)).toEqual(['Editar el agente', 'Cambiar el agente…']);
    expect(items).toContain('Paleta');
    expect(items).toContain('Glosario');
    expect(items[items.length - 1]).toBe('Eliminar');
    expect(screen.getByText('Skills de «Pixelador»')).toBeTruthy();
    await userEvent.click(menu().getByRole('menuitem', { name: 'Paleta' }));
    const lib = within(await screen.findByRole('region', { name: 'Conocimiento' }));
    await waitFor(() => expect((lib.getByLabelText('Nombre') as HTMLInputElement).value).toBe('Paleta'));
  });

  it('[R32.34] «Cambiar el agente…» abre la galería y sustituye el agente del nodo', async () => {
    await mount();
    await userEvent.click(screen.getByRole('button', { name: 'Añadir «Pixelador» al diagrama' }));
    fireEvent.contextMenu(await screen.findByLabelText(/^Agente «pix»/));
    await userEvent.click(menu().getByRole('menuitem', { name: 'Cambiar el agente…' }));
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Elige un agente' })).getByRole('button', { name: /Revisor/ }));
    expect(await screen.findByLabelText(/^Agente «pix»/)).toBeTruthy();
    expect(within(screen.getByRole('group', { name: 'Quién lo hace' })).getByText('Revisor', { selector: 'strong' })).toBeTruthy();
  });

  it('[R32.34] en «Tus agentes» el botón derecho y Mayús+F10 abren el mismo menú, con «Editar el agente»', async () => {
    await mount();
    const row = screen.getByRole('button', { name: 'Añadir «Pixelador» al diagrama' });
    fireEvent.contextMenu(row);
    expect(menu().getByRole('menuitem', { name: 'Añadir al diagrama' })).toBeTruthy();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.keyDown(row, { key: 'F10', shiftKey: true });
    await userEvent.click(menu().getByRole('menuitem', { name: 'Editar el agente' }));
    const lib = within(await screen.findByRole('region', { name: 'Agentes' }));
    await waitFor(() => expect((lib.getByLabelText('Nombre') as HTMLInputElement).value).toBe('Pixelador'));
  });

  it('[R32.34] en el editor del agente, el nombre de una skill asignada la abre sin perder el borrador', async () => {
    await mount();
    const s = await goLib('agents');
    await userEvent.click(s.getByRole('button', { name: 'Pixelador' }));
    await userEvent.type(s.getByLabelText('Instrucciones'), 'pendiente');
    await userEvent.click(s.getByRole('button', { name: /^Qué sabe/ }));
    await userEvent.click(s.getByRole('button', { name: 'Abrir «Paleta»' }));
    const k = within(await screen.findByRole('region', { name: 'Conocimiento' }));
    await waitFor(() => expect((k.getByLabelText('Nombre') as HTMLInputElement).value).toBe('Paleta'));
    const a = await goLib('agents');
    expect((a.getByLabelText('Instrucciones') as HTMLTextAreaElement).value).toBe('pendiente');
  });

  it('[R32.35] un archivo de referencia de texto se edita y se crea uno nuevo en referencias/', async () => {
    const api = await mount();
    const s = await goLib('skills');
    await userEvent.click(s.getByRole('button', { name: 'Paleta' }));
    await userEvent.click(await s.findByRole('button', { name: 'Ver referencias/colores.md' }));
    await userEvent.click(s.getByRole('button', { name: 'Editar' }));
    const area = s.getByLabelText('Editar referencias/colores.md');
    await userEvent.clear(area);
    await userEvent.type(area, '# Paleta nueva');
    await userEvent.click(s.getByRole('button', { name: 'Guardar archivo' }));
    await waitFor(async () => expect(await api.readSkillFile({ id: 'paleta', path: 'referencias/colores.md' })).toMatchObject({ ok: true, value: { text: '# Paleta nueva' } }));
    await userEvent.click(s.getByRole('button', { name: 'Nuevo archivo de texto' }));
    await userEvent.type(s.getByLabelText('Nombre del archivo'), 'estilo{Enter}');
    await userEvent.type(s.getByLabelText('Editar referencias/estilo.md'), 'Contornos de 1 px');
    fireEvent.keyDown(s.getByLabelText('Editar referencias/estilo.md'), { key: 's', ctrlKey: true });
    await waitFor(async () => expect(await api.readSkillFile({ id: 'paleta', path: 'referencias/estilo.md' })).toMatchObject({ ok: true, value: { text: 'Contornos de 1 px' } }));
    expect(await s.findByText('referencias/estilo.md', { selector: 'li code' })).toBeTruthy();
  });

  it('[R32.35] el contrato rechaza SKILL.md y rutas que salen de la skill', async () => {
    const api = createMemoryApi([], OPTIONS);
    expect(await api.saveSkillFile({ id: 'paleta', path: 'SKILL.md', text: 'x' })).toMatchObject({ ok: false });
    expect(await api.saveSkillFile({ id: 'paleta', path: '../x.md', text: 'x' })).toMatchObject({ ok: false });
  });
});
