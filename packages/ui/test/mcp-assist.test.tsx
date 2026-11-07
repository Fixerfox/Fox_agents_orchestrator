// @vitest-environment jsdom
import './setup';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { defaultSettings, newAgent, newMcpServer } from '@orquestador/core';
import { createDiagram } from '@orquestador/editor';
import { App } from '../src/App';
import { createMemoryApi, type MemoryApiOptions } from '../src/memoryApi';
import { goLib } from './nav';

// xterm.js necesita un navegador de verdad: en jsdom una pantalla falsa que guarda lo escrito y deja teclear.
const screens: { text: string; input?: (d: string) => void }[] = [];
vi.mock('../src/shell/terminalScreen', () => ({
  createTerminalScreen: (el: HTMLElement) => {
    const s: { text: string; input?: (d: string) => void } = { text: '' };
    screens.push(s);
    const pre = document.createElement('pre');
    el.appendChild(pre);
    return {
      write: (d: string) => ((s.text += d), (pre.textContent = s.text)),
      onInput: (cb: (d: string) => void) => void (s.input = cb),
      fit: () => ({ cols: 90, rows: 20 }),
      focus: () => undefined,
      dispose: () => undefined,
    };
  },
}));

async function mount(options: MemoryApiOptions = {}) {
  screens.length = 0;
  const api = createMemoryApi([createDiagram('principal', 'Principal')], {
    agents: [{ ...newAgent('pix', 'Pixelador'), description: 'Pinta' }],
    mcp: [{ ...newMcpServer('github', 'GitHub'), transport: 'http', url: 'https://api.github.com/mcp', secretNames: ['Authorization'] } as never],
    ...options,
  });
  // Estos tests comprueban el «Permitir»: con «Sin preguntar nunca» no se pide [R51.3].
  await api.saveSettings({ ...defaultSettings(), permissions: 'auto' });
  render(<App initialProject="Juego" api={api} agents={[]} confirm={() => true} />);
  await userEvent.click(screen.getByRole('button', { name: /^Proyecto «/ }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Abrir proyecto' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Añadir «Pixelador» al diagrama' }));
  await screen.findByLabelText(/^Agente «pix»/);
  return api;
}
const menu = () => within(screen.getByRole('menu'));
const nodeId = (api: ReturnType<typeof createMemoryApi>) => {
  void api;
  return screen.getByLabelText(/^Agente «pix»/).closest('[data-id]')!.getAttribute('data-id')!;
};
const panel = async () => within(await screen.findByRole('region', { name: 'Asistente' }));
const say = async (text: string) => userEvent.type((await panel()).getByLabelText('Mensaje para el asistente'), `${text}{Enter}`);

describe('SPEC-030 · alta asistida de MCP (interfaz)', () => {
  it('[R30.10] el botón derecho de un agente ofrece conocimiento y MCP solo para ese paso y el alta con Claude', async () => {
    const api = await mount({ assistant: () => [{ text: 'Vale, ¿qué servicio quieres conectar?' }] });
    fireEvent.contextMenu(screen.getByLabelText(/^Agente «pix»/));
    expect(menu().getByText('Solo en este paso')).toBeTruthy();
    await userEvent.click(menu().getByRole('menuitem', { name: 'MCP solo aquí…' }));
    const pick = within(screen.getByRole('dialog', { name: 'Servidores MCP · solo en «pix»' }));
    await userEvent.click(pick.getByRole('button', { name: 'Añadir GitHub' }));
    await userEvent.click(pick.getByRole('button', { name: 'Listo' }));
    expect(await screen.findByRole('group', { name: 'MCP «GitHub» solo en este paso · Obligatoria' })).toBeTruthy();
    fireEvent.contextMenu(screen.getByLabelText(/^Agente «pix»/));
    await userEvent.click(menu().getByRole('menuitem', { name: 'Skill o contexto solo aquí…' }));
    expect(screen.getByRole('dialog', { name: 'Skills y contextos · solo en «pix»' })).toBeTruthy();
    await userEvent.keyboard('{Escape}');
    fireEvent.contextMenu(screen.getByLabelText(/^Agente «pix»/));
    await userEvent.click(menu().getByRole('menuitem', { name: 'Alta de MCP con Claude…' }));
    const p = await panel();
    expect(await p.findByText('Vale, ¿qué servicio quieres conectar?')).toBeTruthy();
    expect(api.assistantTurns[0]!.at(-1)!.text).toMatch(/servidor MCP para el agente «Pixelador» \(id pix\)/);
  });

  it('[R30.11] el asistente da de alta un servidor para todos los proyectos, lo prueba y lo enchufa solo a un paso', async () => {
    let node = '';
    const api = await mount({
      assistant: () => [
        { tool: 'create_mcp', args: { name: 'Figma', transport: 'stdio', command: 'npx', args: ['-y', 'figma-mcp'], secretNames: ['FIGMA_TOKEN'], scope: 'app' } },
        { tool: 'test_mcp', args: { id: 'figma' } },
        { tool: 'assign_mcp', args: { mcpId: 'figma', nodeId: node } },
        { tool: 'assign_mcp', args: { mcpId: 'figma', agentId: 'pix' } },
      ],
    });
    node = nodeId(api);
    await userEvent.click(screen.getByRole('button', { name: 'Asistente' }));
    await say('conecta figma');
    const p = await panel();
    const created = within(await p.findByRole('article', { name: 'Acción: Dar de alta un servidor MCP' }));
    expect(await created.findByText('Servidor MCP «Figma» creado para todos tus proyectos.')).toBeTruthy();
    expect(api.mcp.get('figma')).toMatchObject({ command: 'npx', args: ['-y', 'figma-mcp'], secretNames: ['FIGMA_TOKEN'], scope: 'app' });
    const test = within(await p.findByRole('article', { name: 'Acción: Probar un servidor MCP' }));
    expect(test.getByText(/Quiere arrancar el servidor «figma»/)).toBeTruthy();
    await userEvent.click(test.getByRole('button', { name: 'Permitir' }));
    expect(await p.findByText('«Figma» responde: buscar, leer.')).toBeTruthy();
    expect(await screen.findByRole('group', { name: 'MCP «Figma» solo en este paso · Obligatoria' })).toBeTruthy();
    await waitFor(() => expect(api.agents.get('pix')!.mcpIds).toEqual(['figma']));
    // «Deshacer» la asignación al agente
    const assigned = within((await p.findAllByRole('article', { name: 'Acción: Asignar un servidor MCP' }))[1]!);
    await userEvent.click(assigned.getByRole('button', { name: 'Deshacer' }));
    await waitFor(() => expect(api.agents.get('pix')!.mcpIds ?? []).toEqual([]));
  });

  it('[R30.12] pedir un secreto muestra un campo de contraseña; el valor se guarda cifrado y Claude no lo ve', async () => {
    const api = await mount({ assistant: () => [{ tool: 'request_secret', args: { mcpId: 'github', name: 'GITHUB_TOKEN', why: 'Créalo en Ajustes › Tokens de GitHub' } }, { text: 'Listo.' }] });
    await userEvent.click(screen.getByRole('button', { name: 'Asistente' }));
    await say('pídeme el token');
    const p = await panel();
    const card = within(await p.findByRole('article', { name: 'Acción: Pedir un secreto' }));
    expect(card.getByText('GITHUB_TOKEN para «github»')).toBeTruthy();
    expect(card.getByText('Créalo en Ajustes › Tokens de GitHub')).toBeTruthy();
    const field = card.getByLabelText('Valor de GITHUB_TOKEN') as HTMLInputElement;
    expect(field.type).toBe('password');
    await userEvent.type(field, 'ghp_supersecreto123{Enter}');
    expect(await card.findByText('GITHUB_TOKEN guardado y cifrado. Claude no ha visto el valor.')).toBeTruthy();
    expect(api.mcpSecrets.get('github')).toEqual({ GITHUB_TOKEN: 'ghp_supersecreto123' });
    expect(api.mcp.get('github')!.secretNames).toEqual(['Authorization', 'GITHUB_TOKEN']);
    expect(await p.findByText('Listo.')).toBeTruthy();
    expect(JSON.stringify(api.assistantResults)).not.toContain('ghp_supersecreto123');
    expect(api.assistantResults[0]).toMatchObject({ name: 'request_secret', ok: true, result: { saved: true } });
    expect(screen.queryByDisplayValue('ghp_supersecreto123')).toBeNull();
    // el siguiente turno tampoco lo lleva en el historial
    await say('gracias');
    await waitFor(() => expect(api.assistantTurns).toHaveLength(2));
    expect(JSON.stringify(api.assistantTurns)).not.toContain('ghp_supersecreto123');
  });

  it('[R30.12] «No darlo» no guarda nada y se lo dice a Claude', async () => {
    const api = await mount({ assistant: () => [{ tool: 'request_secret', args: { mcpId: 'github', name: 'GITHUB_TOKEN' } }] });
    await userEvent.click(screen.getByRole('button', { name: 'Asistente' }));
    await say('pídeme el token');
    const card = within(await (await panel()).findByRole('article', { name: 'Acción: Pedir un secreto' }));
    await userEvent.click(card.getByRole('button', { name: 'No darlo' }));
    expect(await card.findByText('No has dado GITHUB_TOKEN.')).toBeTruthy();
    expect(api.mcpSecrets.get('github')).toBeUndefined();
    expect(api.assistantResults[0]).toMatchObject({ ok: false });
  });

  it('[R30.9] la ficha MCP guarda en «Todos mis proyectos» y la lista lo marca', async () => {
    const api = await mount();
    const s = await goLib('contexts');
    await userEvent.click(s.getByRole('tab', { name: /MCP/ }));
    await userEvent.click(s.getByRole('button', { name: 'GitHub' }));
    expect((s.getByRole('radio', { name: 'Solo este proyecto' }) as HTMLInputElement).checked).toBe(true);
    await userEvent.click(s.getByRole('radio', { name: 'Todos mis proyectos' }));
    expect(s.getByText(/lo verás en todos tus proyectos/)).toBeTruthy();
    await userEvent.click(s.getAllByRole('button', { name: 'Guardar' }).find((b) => b.getAttribute('type') === 'submit')!);
    await waitFor(() => expect(api.mcp.get('github')!.scope).toBe('app'));
    expect(await within(s.getByRole('button', { name: 'GitHub' })).findByText(/Todos tus proyectos/)).toBeTruthy();
  });

  it('[R30.10][R30.13] «Abrir terminal» abre Claude Code abajo; se escribe en él, se oculta sin perder nada y se cierra', async () => {
    const api = await mount();
    const s = await goLib('contexts');
    await userEvent.click(s.getByRole('tab', { name: /MCP/ }));
    await userEvent.click(s.getByRole('button', { name: 'GitHub' }));
    await userEvent.click(s.getByRole('button', { name: 'Abrir terminal' }));
    const term = within(await screen.findByRole('region', { name: 'Terminal' }));
    expect(term.getByRole('tab', { name: 'Claude Code 1' }).getAttribute('aria-selected')).toBe('true');
    await waitFor(() => expect(screens[0]!.text).toContain('Claude Code (simulado)'));
    const [id] = [...api.terminals.keys()];
    expect(api.terminals.get(id!)).toMatchObject({ program: 'claude', alive: true });
    screens[0]!.input!('/mcp\r');
    await waitFor(() => expect(api.terminals.get(id!)!.written).toBe('/mcp\r'));
    // ocultar no cierra: la salida que llega mientras tanto se conserva
    await userEvent.click(term.getByRole('button', { name: 'Ocultar las terminales' }));
    api.terminalOutput(id!, 'conectado');
    await userEvent.click(screen.getByRole('button', { name: 'Terminales (1)' }));
    await waitFor(() => expect(screens[0]!.text).toContain('conectado'));
    // otra consola en una pestaña nueva
    await userEvent.click(term.getByRole('button', { name: 'Nueva consola' }));
    expect(await term.findByRole('tab', { name: 'Consola 2' })).toBeTruthy();
    await userEvent.click(term.getByRole('button', { name: 'Cerrar Claude Code 1' }));
    expect(api.terminals.get(id!)!.alive).toBe(false);
    expect(term.queryByRole('tab', { name: 'Claude Code 1' })).toBeNull();
    expect(term.getByRole('tab', { name: 'Consola 2' }).getAttribute('aria-selected')).toBe('true');
  });

  it('[R30.11][R30.13] el asistente abre la terminal solo con permiso y con la petición escrita', async () => {
    const api = await mount({ assistant: () => [{ tool: 'open_terminal', args: { program: 'claude', prompt: 'Inicia sesión en Figma' } }] });
    await userEvent.click(screen.getByRole('button', { name: 'Asistente' }));
    await say('abre la terminal');
    const card = within(await (await panel()).findByRole('article', { name: 'Acción: Abrir una terminal' }));
    expect(card.getByText('Quiere abrir Claude Code en la carpeta del proyecto con: «Inicia sesión en Figma».')).toBeTruthy();
    expect(api.terminals.size).toBe(0);
    await userEvent.click(card.getByRole('button', { name: 'Permitir' }));
    expect(await card.findByText('Terminal abierta abajo.')).toBeTruthy();
    expect([...api.terminals.values()][0]).toMatchObject({ program: 'claude', prompt: 'Inicia sesión en Figma' });
    expect(screen.getByRole('region', { name: 'Terminal' })).toBeTruthy();
  });

  it('[R30.14] si la terminal integrada no arranca se abre la del sistema y se avisa', async () => {
    await mount({ terminal: { external: true } });
    const s = await goLib('contexts');
    await userEvent.click(s.getByRole('tab', { name: /MCP/ }));
    await userEvent.click(s.getByRole('button', { name: 'GitHub' }));
    await userEvent.click(s.getByRole('button', { name: 'Abrir terminal' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/se ha abierto la terminal del sistema/);
    expect(screen.queryByRole('region', { name: 'Terminal' })).toBeNull();
  });

  it('[R30.10] «Configurar con Claude» en la ficha abre el asistente con la petición sobre ese servidor', async () => {
    const api = await mount({ assistant: () => [{ text: 'Reviso GitHub.' }] });
    const s = await goLib('contexts');
    await userEvent.click(s.getByRole('tab', { name: /MCP/ }));
    await userEvent.click(s.getByRole('button', { name: 'GitHub' }));
    await userEvent.click(s.getByRole('button', { name: 'Configurar con Claude' }));
    expect(await (await panel()).findByText('Reviso GitHub.')).toBeTruthy();
    expect(api.assistantTurns[0]!.at(-1)!.text).toMatch(/servidor MCP «GitHub» \(id github\)/);
  });
});
