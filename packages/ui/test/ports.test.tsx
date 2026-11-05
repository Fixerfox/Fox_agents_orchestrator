// @vitest-environment jsdom
import './setup';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { newAgent, newContext, newMcpServer, newSkill } from '@orquestador/core';
import { createDiagram } from '@orquestador/editor';
import { App } from '../src/App';
import { DRAG_TYPE } from '../src/Canvas';
import { createMemoryApi } from '../src/memoryApi';

async function mount() {
  const api = createMemoryApi([createDiagram('principal', 'Principal')], {
    agents: [{ ...newAgent('pix', 'Pixelador'), description: 'Pinta', skillIds: ['paleta'] }],
    skills: [{ ...newSkill('paleta', 'Paleta'), description: 'Colores' }, { ...newSkill('trazo', 'Trazo'), description: 'Contornos' }],
    contexts: [{ ...newContext('glosario', 'Glosario'), value: 'Términos' }],
    mcp: [{ ...newMcpServer('pixelart', 'Pixelart'), command: 'npx' }],
  });
  render(<App initialProject="Juego" api={api} agents={[]} confirm={() => true} />);
  await userEvent.click(screen.getByRole('button', { name: /^Proyecto «/ }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Abrir proyecto' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Añadir «Pixelador» al diagrama' }));
  await screen.findByLabelText(/^Agente «pix»/);
  return api;
}
const step = () => screen.getByLabelText(/^Agente «pix»/);

describe('SPEC-033 · conectores de skills y MCP en el lienzo', () => {
  it('[R33.10] el «+» de arriba añade skills y contextos y el de abajo MCP, enchufados solo a ese paso', async () => {
    const api = await mount();
    await userEvent.click(screen.getByRole('button', { name: 'Añadir skill o contexto solo a «pix»' }));
    const pick = within(screen.getByRole('dialog', { name: 'Skills y contextos · solo en «pix»' }));
    await userEvent.click(pick.getByRole('button', { name: 'Añadir Trazo' }));
    await userEvent.click(pick.getByRole('button', { name: 'Añadir Glosario' }));
    await userEvent.click(pick.getByRole('button', { name: 'Listo' }));
    expect(await screen.findByRole('group', { name: 'Skill «Trazo» solo en este paso · Obligatoria' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Contexto «Glosario» solo en este paso' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Añadir MCP solo a «pix»' }));
    const mcp = within(screen.getByRole('dialog', { name: 'Servidores MCP · solo en «pix»' }));
    await userEvent.click(mcp.getByRole('button', { name: 'Añadir Pixelart' }));
    await userEvent.click(mcp.getByRole('button', { name: 'Listo' }));
    expect(await screen.findByRole('group', { name: 'MCP «Pixelart» solo en este paso · Obligatoria' })).toBeTruthy();
    // los conectores no comparten clase con las salidas de la revisión (su CSS los sacaba del nodo)
    const know = step().closest('.react-flow__node')!.querySelector('.react-flow__handle[data-handleid="know"]')!;
    const mcpPort = step().closest('.react-flow__node')!.querySelector('.react-flow__handle[data-handleid="mcp"]')!;
    expect(know.classList.contains('orq-resport--know')).toBe(true);
    expect(mcpPort.classList.contains('orq-resport--mcp')).toBe(true);
    expect(know.classList.contains('orq-port') || mcpPort.classList.contains('orq-port')).toBe(false);
    // la tarjeta del paso sigue mostrando solo lo del agente
    expect(within(step()).getByText('Paleta')).toBeTruthy();
    expect(within(step()).queryByText('Trazo')).toBeNull();
    expect(api.agents.get('pix')!.skillIds).toEqual(['paleta']);
    // la × quita la ficha y se deshace con Ctrl+Z
    await userEvent.click(screen.getByRole('button', { name: 'Quitar «Trazo» de este paso' }));
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Skill «Trazo» solo en este paso · Obligatoria' })).toBeNull());
    await userEvent.keyboard('{Control>}z{/Control}');
    expect(await screen.findByRole('group', { name: 'Skill «Trazo» solo en este paso · Obligatoria' })).toBeTruthy();
  });

  it('[R33.11] Skills, Contextos y MCP van en tres desplegables; arrastrar y soltar sobre el agente lo enchufa; fuera, avisa', async () => {
    await mount();
    const skills = within(screen.getByRole('region', { name: 'Skills' }));
    expect(skills.getAllByRole('listitem').map((x) => x.getAttribute('aria-label'))).toEqual(['Arrastra «Paleta» sobre un agente', 'Arrastra «Trazo» sobre un agente']);
    expect(within(screen.getByRole('region', { name: 'Contextos' })).getAllByRole('listitem')).toHaveLength(1);
    const sec = within(screen.getByRole('region', { name: 'MCP' }));
    expect(sec.getByRole('listitem', { name: 'Arrastra «Pixelart» sobre un agente' })).toBeTruthy();
    // cada uno se pliega por separado
    await userEvent.click(screen.getByRole('button', { name: /^Skills/ }));
    expect(screen.queryByRole('listitem', { name: 'Arrastra «Trazo» sobre un agente' })).toBeNull();
    expect(sec.getByRole('listitem', { name: 'Arrastra «Pixelart» sobre un agente' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /^Skills/ }));
    const drop = (target: Element, value: string) =>
      fireEvent.drop(target, { dataTransfer: { getData: (k: string) => (k === DRAG_TYPE ? value : ''), types: [DRAG_TYPE] }, clientX: 10, clientY: 10 });
    drop(step(), 'res:mcpIds:pixelart');
    expect(await screen.findByRole('group', { name: 'MCP «Pixelart» solo en este paso · Obligatoria' })).toBeTruthy();
    drop(screen.getByTestId('canvas'), 'res:skillIds:trazo');
    expect(await screen.findByText(/Suéltalo sobre un paso de agente/)).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Skill «Trazo» solo en este paso · Obligatoria' })).toBeNull();
  });
});
