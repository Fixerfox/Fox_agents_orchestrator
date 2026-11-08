// @vitest-environment jsdom
import './setup';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MockAgent, MockDecider, Orchestrator, newAgent } from '@orquestador/core';
import { createDiagram } from '@orquestador/editor';
import { App } from '../src/App';
import { createMemoryApi, type MemoryApiOptions } from '../src/memoryApi';
import { goLib, stepTab } from './nav';

async function mount(options: MemoryApiOptions = {}) {
  const api = createMemoryApi([createDiagram('principal', 'Principal')], { agents: [{ ...newAgent('pix', 'Pixelador'), description: 'Pinta' }], ...options });
  render(<App initialProject="Juego" api={api} agents={[]} confirm={() => true} />);
  await userEvent.click(screen.getByRole('button', { name: /^Proyecto «/ }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Abrir proyecto' }));
  await screen.findByRole('button', { name: 'Añadir «Pixelador» al diagrama' });
  return api;
}

describe('SPEC-039 · agente supervisado e icono en la interfaz', () => {
  it('[R39.2][R39.8] la ficha pone «preguntar antes de actuar», el icono y el tono, y se guardan', async () => {
    const api = await mount();
    const s = await goLib('agents');
    await userEvent.click(s.getByRole('button', { name: 'Pixelador' }));
    await userEvent.click(s.getByRole('button', { name: /^Qué puede hacer/ }));
    const sup = within(s.getByRole('region', { name: 'Supervisión' }));
    expect(sup.getByText(/Trabaja por su cuenta/)).toBeTruthy();
    await userEvent.click(sup.getByRole('switch', { name: /Preguntar siempre antes de implementar o decidir/ }));
    expect(sup.getByText(/te presenta su plan y espera tu respuesta/)).toBeTruthy();
    await userEvent.click(s.getByRole('button', { name: /^Modelo y aspecto/ }));
    const look = within(s.getByRole('group', { name: 'Icono' }));
    await userEvent.click(look.getByRole('button', { name: 'Cambiar icono' }));
    expect(look.getByRole('radio', { name: 'Inicial' }).getAttribute('aria-checked')).toBe('true');
    await userEvent.click(look.getByRole('radio', { name: 'Icono paleta' }));
    await userEvent.click(look.getByRole('radio', { name: 'Tono violeta' }));
    await userEvent.click(s.getAllByRole('button', { name: 'Guardar' }).find((b) => b.getAttribute('type') === 'submit')!);
    await waitFor(() => expect(api.agents.get('pix')).toMatchObject({ askFirst: true, icon: 'palette', tone: 'violet' }));
    // la lista lo muestra con su icono y el semáforo
    const row = s.getByRole('button', { name: 'Pixelador' });
    expect(row.querySelector('[data-icon="palette"]')).toBeTruthy();
    expect(within(row).getByRole('img', { name: 'Pregunta antes de actuar' })).toBeTruthy();
  });

  it('[R39.5][R39.9] en el lienzo y en la paleta, el paso lleva su icono y el semáforo amarillo', async () => {
    await mount({ agents: [{ ...newAgent('pix', 'Pixelador'), description: 'Pinta', askFirst: true, icon: 'palette', tone: 'amber' }, { ...newAgent('libre', 'Libre'), description: 'x' }] });
    const pal = screen.getByRole('button', { name: 'Añadir «Pixelador» al diagrama' });
    expect(within(pal).getByRole('img', { name: 'Pregunta antes de actuar' })).toBeTruthy();
    expect(within(screen.getByRole('button', { name: 'Añadir «Libre» al diagrama' })).queryByRole('img', { name: 'Pregunta antes de actuar' })).toBeNull();
    await userEvent.click(pal);
    const node = await screen.findByLabelText(/^Agente «pix».*Pregunta antes de actuar/);
    expect(node.querySelector('[data-icon="palette"]')).toBeTruthy();
    expect(within(node).getByRole('img', { name: 'Pregunta antes de actuar' })).toBeTruthy();
  });

  it('[R39.6] cuando un agente pregunta, su paso, el diagrama de la paleta y el rail muestran la mano levantada', async () => {
    const agent = { output: 'hecho', tokens: ['hecho'], usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 }, latencyMs: 1 };
    const mock = new MockAgent({ pix: { ...agent, asks: [{ question: '¿Qué estilo?' }] } });
    await mount({ orchestrator: new Orchestrator({ getAdapter: () => mock, decider: new MockDecider() }) });
    fireEvent.click(await screen.findByRole('button', { name: 'Insertar un paso entre «Entrada» y «Salida»' }));
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Insertar paso' })).getByRole('button', { name: /Pixelador/ }));
    expect(screen.queryByRole('img', { name: 'Te está preguntando' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Lanzar…' }));
    const d = within(await screen.findByRole('dialog', { name: /^Ejecutar «/ }));
    await userEvent.type(d.getByLabelText('Entrada'), 'un dragón');
    await userEvent.click(d.getByRole('button', { name: 'Lanzar y ver la ejecución' }));
    await screen.findByRole('button', { name: '1 pregunta' });
    // en el lienzo de la ejecución
    expect(screen.getAllByLabelText(/^Agente «pix».*Te está preguntando/).length).toBeGreaterThan(0);
    const rail = within(screen.getByRole('navigation', { name: 'Secciones' }));
    expect(within(rail.getByRole('button', { name: 'Diseñador' })).getByRole('img', { name: 'Te está preguntando' })).toBeTruthy();
    await userEvent.click(rail.getByRole('button', { name: 'Diseñador' }));
    // el lienzo del Diseñador ya no pinta la ejecución [R52.8]
    expect(screen.getByLabelText(/^Agente «pix»/).getAttribute('aria-label')).not.toMatch(/Te está preguntando/);
    expect(within(screen.getByRole('button', { name: /^Abrir el diagrama «Principal»/ })).getByRole('img', { name: 'Un agente te está preguntando' })).toBeTruthy();
  });
});

describe('SPEC-039 · ficha del agente y panel del paso', () => {
  it('[R39.10][R57.5] los bloques quedan en sus secciones y «Así se ve» resume icono, modelo, conocimiento y supervisión', async () => {
    await mount({ agents: [{ ...newAgent('pix', 'Pixelador'), description: 'Pinta', askFirst: true, icon: 'palette' }] });
    const s = await goLib('agents');
    await userEvent.click(s.getByRole('button', { name: 'Pixelador' }));
    for (const name of [/Quién es/, /Cómo trabaja/]) expect(s.getByRole('region', { name })).toBeTruthy();
    await userEvent.click(s.getByRole('button', { name: /^Qué sabe/ }));
    const know = within(s.getByRole('region', { name: /Lo que sabe y usa/ }));
    expect(know.getByRole('button', { name: 'Añadir skills…' })).toBeTruthy();
    expect(know.getByRole('button', { name: 'Añadir contextos…' })).toBeTruthy();
    await userEvent.click(s.getByRole('button', { name: /^Modelo y aspecto/ }));
    const card = within(s.getByRole('region', { name: 'Así se ve' }));
    expect(card.getByText('Sonnet 5.5')).toBeTruthy();
    expect(card.getByText('0 skills · 0 contextos · 0 MCP')).toBeTruthy();
    expect(card.getAllByRole('img', { name: 'Pregunta antes de actuar' }).length).toBeGreaterThan(0);
    expect(card.queryByRole('radio', { name: 'Icono paleta' })).toBeNull();
    await userEvent.click(card.getByRole('button', { name: 'Cambiar icono' }));
    expect(card.getByRole('radio', { name: 'Icono paleta' }).getAttribute('aria-checked')).toBe('true');
  });

  it('[R39.11] el panel del paso agrupa tarea y agente en tarjetas, con su modelo y la supervisión', async () => {
    await mount({ agents: [{ ...newAgent('pix', 'Pixelador'), description: 'Pinta', askFirst: true, icon: 'palette' }] });
    await userEvent.click(screen.getByRole('button', { name: 'Añadir «Pixelador» al diagrama' }));
    const task = within(await screen.findByRole('region', { name: 'Tarea del paso' }));
    expect(task.getByLabelText('Qué tiene que hacer')).toBeTruthy();
    await stepTab('Agente');
    const who = within(screen.getByRole('group', { name: 'Quién lo hace' }));
    expect(who.getByText('Pixelador')).toBeTruthy();
    expect(who.getByText('Sonnet 5.5')).toBeTruthy();
    expect(who.getByRole('img', { name: 'Pregunta antes de actuar' })).toBeTruthy();
    expect(who.getByRole('button', { name: 'Cambiar el agente' })).toBeTruthy();
  });
});
