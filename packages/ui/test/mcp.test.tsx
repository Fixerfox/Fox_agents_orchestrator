// @vitest-environment jsdom
import './setup';
import { describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { newAgent, newMcpServer } from '@orquestador/core';
import { createDiagram } from '@orquestador/editor';
import { App } from '../src/App';
import { createMemoryApi, type MemoryApiOptions } from '../src/memoryApi';
import { goLib } from './nav';

async function mount(options: MemoryApiOptions = {}) {
  const api = createMemoryApi([createDiagram('principal', 'Principal')], { agents: [{ ...newAgent('pintor', 'Pintor'), description: 'Pinta' }], ...options });
  render(<App initialProject="Juego" api={api} agents={[]} confirm={() => true} />);
  await userEvent.click(screen.getByRole('button', { name: /^Proyecto «/ }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Abrir proyecto' }));
  await screen.findByRole('button', { name: 'Añadir «Pintor» al diagrama' });
  return api;
}

describe('SPEC-030 · MCP en la interfaz', () => {
  it('[R30.7] crea un servidor con comando y argumentos, guarda un secreto sin que vuelva y prueba la conexión', async () => {
    const api = await mount();
    const s = await goLib('contexts');
    await userEvent.click(s.getByRole('tab', { name: /MCP/ }));
    await userEvent.click(s.getByRole('button', { name: 'Nuevo servidor MCP' }));
    // «Nuevo» empieza por el asistente; se elige hacerlo a mano [R38.6]
    await userEvent.click(s.getByRole('button', { name: /Configurar a mano/ }));
    expect(s.getAllByRole('note').some((n) => /ejecuta un programa/.test(n.textContent ?? ''))).toBe(true);
    await userEvent.type(s.getByLabelText('Nombre'), 'Pixel');
    await userEvent.type(s.getByLabelText('Comando'), 'npx');
    await userEvent.type(s.getByLabelText('Argumentos (uno por línea)'), '-y{Enter}pixelart-mcp');
    await userEvent.type(s.getByLabelText('Nombre del secreto nuevo'), 'API_KEY{Enter}');
    expect(s.getByText('Guarda el servidor para poder escribir los valores.')).toBeTruthy();
    await userEvent.click(s.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(api.mcp.get('pixel')).toMatchObject({ command: 'npx', args: ['-y', 'pixelart-mcp'], secretNames: ['API_KEY'], enabled: true }));
    const value = await s.findByLabelText('Valor de API_KEY');
    await userEvent.type(value, 'k-123{Enter}');
    await waitFor(() => expect(api.mcpSecrets.get('pixel')).toEqual({ API_KEY: 'k-123' }));
    expect(await s.findByText('guardado')).toBeTruthy();
    expect((s.getByLabelText('Valor de API_KEY') as HTMLInputElement).value).toBe('');
    await userEvent.click(s.getByRole('button', { name: 'Probar conexión' }));
    expect(await s.findByText(/responde \(simulado\)/)).toBeTruthy();
    expect(s.getByText('buscar')).toBeTruthy();
  });

  it('[R30.7] un servidor web pide dirección; apagado se marca en la lista', async () => {
    const api = await mount({ mcp: [{ ...newMcpServer('docs', 'Docs'), transport: 'http', url: 'https://docs.example.com/mcp', enabled: false }] });
    const s = await goLib('contexts');
    await userEvent.click(s.getByRole('tab', { name: /MCP/ }));
    expect(within(s.getByRole('button', { name: 'Docs' })).getByText('Apagado')).toBeTruthy();
    await userEvent.click(s.getByRole('button', { name: 'Docs' }));
    expect((s.getByLabelText('Dirección') as HTMLInputElement).value).toBe('https://docs.example.com/mcp');
    await userEvent.click(s.getByRole('switch', { name: 'Activado' }));
    await userEvent.click(s.getByRole('switch', { name: 'De confianza' }));
    await userEvent.click(s.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(api.mcp.get('docs')).toMatchObject({ enabled: true, trusted: true }));
  });

  it('[R30.3] el agente se asigna servidores MCP en su ficha y desde «Lo usan»', async () => {
    const api = await mount({ mcp: [{ ...newMcpServer('pixel', 'Pixel'), command: 'npx' }] });
    const a = await goLib('agents');
    await userEvent.click(a.getByRole('button', { name: 'Pintor' }));
    await userEvent.click(a.getByRole('button', { name: /^Qué sabe/ }));
    await userEvent.click(a.getByRole('button', { name: 'Añadir MCP…' }));
    const picker = within(screen.getByRole('dialog', { name: 'Servidores MCP del agente' }));
    await userEvent.click(picker.getByRole('button', { name: 'Añadir Pixel' }));
    await userEvent.click(picker.getByRole('button', { name: 'Listo' }));
    await userEvent.click(a.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(api.agents.get('pintor')!.mcpIds).toEqual(['pixel']));
    // el paso también puede añadir un MCP solo para él (SPEC-033)
    const rail = within(screen.getByRole('navigation', { name: 'Secciones' }));
    await userEvent.click(rail.getByRole('button', { name: 'Diseñador' }));
    await userEvent.click(screen.getByRole('button', { name: 'Añadir «Pintor» al diagrama' }));
    expect(within(await screen.findByRole('group', { name: 'Solo en este paso' })).getByRole('button', { name: /MCP/ })).toBeTruthy();
  });
});
