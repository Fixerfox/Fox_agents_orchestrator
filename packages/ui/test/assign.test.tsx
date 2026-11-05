// @vitest-environment jsdom
import './setup';
import { describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { newAgent, newContext, type AgentDefinition, type ContextDefinition, type SkillDefinition } from '@orquestador/core';
import { createDiagram } from '@orquestador/editor';
import { App } from '../src/App';
import { goLib } from './nav';
import { createMemoryApi, type MemoryApiOptions } from '../src/memoryApi';

async function mount(options: MemoryApiOptions = {}) {
  const api = createMemoryApi([createDiagram('principal', 'Principal')], options);
  render(<App api={api} confirm={() => true} />);
  await userEvent.click(screen.getByRole('button', { name: 'Crear proyecto' }));
  return api;
}
const agent = (id: string, name: string, patch: Partial<AgentDefinition> = {}): AgentDefinition => ({ ...newAgent(id, name), ...patch });
const ctx = (id: string, name: string): ContextDefinition => ({ ...newContext(id, name), value: 'x' });
const skill = (id: string, name: string, description: string): SkillDefinition => ({ id, name, description, body: 'cuerpo' });
const openAgent = async (name: string) => {
  await userEvent.click(screen.getByRole('button', { name: 'Agentes' }));
  const s = within(await screen.findByTestId('content'));
  await userEvent.click(await s.findByRole('button', { name }));
  return s;
};
const SKILLS = [skill('pixel', 'Pixel art', 'Dibuja sprites con paleta limitada'), skill('rev', 'Revisión', 'Revisa textos largos')];

describe('SPEC-022 · asignar skills y contextos desde una pantalla aparte', () => {
  it('[R22.16] el agente muestra solo lo asignado como fichas, sin casillas sueltas', async () => {
    await mount({ agents: [agent('a', 'A', { skillIds: ['pixel'] })], skills: SKILLS });
    const s = await openAgent('A');
    expect(s.queryAllByRole('checkbox')).toHaveLength(0);
    const section = within(s.getByRole('region', { name: 'Skills' }));
    expect(section.getByText('Pixel art')).toBeTruthy();
    expect(section.queryByText('Revisión')).toBeNull();
    expect(s.getByText('Este agente no usa ningún contexto.')).toBeTruthy();
  });

  it('[R22.16] la pantalla de selección enseña la descripción y filtra con el buscador', async () => {
    await mount({ agents: [agent('a', 'A')], skills: SKILLS });
    const s = await openAgent('A');
    await userEvent.click(s.getByRole('button', { name: 'Añadir skills…' }));
    const dlg = within(s.getByRole('dialog', { name: 'Skills del agente' }));
    expect(dlg.getByText('Dibuja sprites con paleta limitada')).toBeTruthy();
    await userEvent.type(dlg.getByRole('searchbox'), 'texto');
    expect(dlg.queryByText('Pixel art')).toBeNull();
    expect(dlg.getByText('Revisión')).toBeTruthy();
    await userEvent.clear(dlg.getByRole('searchbox'));
    await userEvent.type(dlg.getByRole('searchbox'), 'zzz');
    expect(dlg.getByText(/Nada coincide con «zzz»/)).toBeTruthy();
  });

  it('[R22.16] elegir y pulsar Listo asigna; Cancelar o Escape no cambian nada', async () => {
    const api = await mount({ agents: [agent('a', 'A')], skills: SKILLS });
    const s = await openAgent('A');
    await userEvent.click(s.getByRole('button', { name: 'Añadir skills…' }));
    await userEvent.click(s.getByRole('button', { name: 'Añadir Pixel art' }));
    expect(s.getByText('1 seleccionado')).toBeTruthy();
    await userEvent.click(s.getByRole('button', { name: 'Cancelar' }));
    expect(s.queryByRole('dialog', { name: 'Skills del agente' })).toBeNull();
    expect(s.getByText('Este agente no usa ninguna skill.')).toBeTruthy();
    await userEvent.click(s.getByRole('button', { name: 'Añadir skills…' }));
    await userEvent.click(s.getByRole('button', { name: 'Añadir Pixel art' }));
    await userEvent.click(s.getByRole('button', { name: 'Añadir Revisión' }));
    expect(s.getByText('2 seleccionados')).toBeTruthy();
    await userEvent.click(s.getByRole('button', { name: 'Listo' }));
    await userEvent.click(s.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(api.agents.get('a')?.skillIds).toEqual(['pixel', 'rev']));
  });

  it('[R22.16] cada ficha se quita con su botón y la lista se puede desmarcar', async () => {
    const api = await mount({ agents: [agent('a', 'A', { skillIds: ['pixel', 'rev'] })], skills: SKILLS });
    const s = await openAgent('A');
    await userEvent.click(s.getByRole('button', { name: 'Quitar Pixel art' }));
    await userEvent.click(s.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(api.agents.get('a')?.skillIds).toEqual(['rev']));
    await userEvent.click(s.getByRole('button', { name: 'Añadir skills…' }));
    const dlg = within(s.getByRole('dialog', { name: 'Skills del agente' }));
    expect(dlg.getByRole('button', { name: 'Quitar Revisión' })).toHaveProperty('ariaPressed', 'true');
  });

  it('[R22.16] los contextos usan la misma pantalla y muestran su tipo', async () => {
    const api = await mount({ agents: [agent('a', 'A')], contexts: [ctx('guia', 'Guía de estilo')] });
    const s = await openAgent('A');
    await userEvent.click(s.getByRole('button', { name: 'Añadir contextos…' }));
    const dlg = within(s.getByRole('dialog', { name: 'Contextos del agente' }));
    expect(dlg.getByText('Texto')).toBeTruthy();
    await userEvent.click(dlg.getByRole('button', { name: 'Añadir Guía de estilo' }));
    await userEvent.click(dlg.getByRole('button', { name: 'Listo' }));
    await userEvent.click(s.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(api.agents.get('a')?.contextIds).toEqual(['guia']));
  });

  it('[R22.16] «Crear una skill nueva» abre la pestaña Skills sin perder el borrador del agente', async () => {
    await mount({ agents: [agent('a', 'A')] });
    const s = await openAgent('A');
    await userEvent.type(s.getByLabelText('Para qué sirve'), 'pendiente');
    await userEvent.click(s.getByRole('button', { name: 'Añadir skills…' }));
    await userEvent.click(s.getByRole('button', { name: 'Crear una skill nueva' }));
    expect(s.getByRole('tab', { name: /Skills/ }).getAttribute('aria-selected')).toBe('true');
    // la skill nueva empieza por la bienvenida [R38.19]
    await userEvent.click(s.getByRole('button', { name: 'Escribir' }));
    expect(s.getByLabelText('Pasos')).toBeTruthy();
    await goLib('agents');
    expect((s.getByLabelText('Para qué sirve') as HTMLInputElement).value).toBe('pendiente');
  });
});
