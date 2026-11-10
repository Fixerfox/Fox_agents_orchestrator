// @vitest-environment jsdom
import './setup';
import { describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { defaultSettings, newAgent, type ProjectPermission } from '@orquestador/core';
import { createDiagram } from '@orquestador/editor';
import { App } from '../src/App';
import { createMemoryApi, type MemoryApiOptions } from '../src/memoryApi';

async function mount(options: MemoryApiOptions = {}, permissions: ProjectPermission = 'auto') {
  const api = createMemoryApi([createDiagram('principal', 'Principal')], { agents: [{ ...newAgent('pintor', 'Pintor'), description: 'Pinta' }], ...options });
  await api.saveSettings({ ...defaultSettings(), permissions });
  render(<App initialProject="Juego" api={api} agents={[]} confirm={() => true} />);
  await userEvent.click(screen.getByRole('button', { name: /^Proyecto «/ }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Abrir proyecto' }));
  await screen.findByRole('button', { name: 'Añadir «Pintor» al diagrama' });
  await userEvent.click(screen.getByRole('button', { name: 'Asistente' }));
  return { api, panel: within(await screen.findByRole('region', { name: 'Asistente' })) };
}
const say = async (panel: ReturnType<typeof within>, text: string) => {
  await userEvent.type(panel.getByLabelText('Mensaje para el asistente'), `${text}{Enter}`);
};

describe('SPEC-029 · asistente en la interfaz', () => {
  it('[R29.5][R29.6] se abre desde la barra, propone sugerencias y en simulado explica cómo activarlo', async () => {
    const { panel } = await mount();
    expect(screen.getByRole('button', { name: 'Asistente' }).getAttribute('aria-pressed')).toBe('true');
    expect(panel.getAllByRole('button', { name: /^(¿Qué agentes|Crea un agente|Pon tres agentes)/ })).toHaveLength(3);
    await say(panel, 'hola');
    expect(await panel.findByText(/modo simulado/)).toBeTruthy();
    expect(within(panel.getByRole('log')).getByText('hola')).toBeTruthy();
  });

  it('[R29.9] cada lectura se ve como una línea discreta, la denegada lo dice y no van al historial', async () => {
    const { api, panel } = await mount({
      assistant: (msgs) =>
        msgs.length === 1
          ? [
              { read: 'Glob', target: '*' },
              { read: 'Read', target: 'package.json' },
              { read: 'Read', target: '.env', ok: false },
              { text: 'Se arranca con node dist/index.js' },
            ]
          : [{ text: 'vale' }],
    });
    expect(panel.getByText(/Tengo todo Claude Code/)).toBeTruthy();
    await say(panel, 'mira C:\\pixelart-mcp');
    expect(await panel.findByText('Ha leído package.json')).toBeTruthy();
    expect(panel.getByText('Ha buscado archivos «*»')).toBeTruthy();
    expect(panel.getByText('Ha leído .env (bloqueado)').className).toContain('is-denied');
    expect(await panel.findByText('Se arranca con node dist/index.js')).toBeTruthy();
    await say(panel, 'gracias');
    expect(await panel.findByText('vale')).toBeTruthy();
    const second = api.assistantTurns[1]!;
    expect(second.map((m) => m.text)).toEqual(['mira C:\\pixelart-mcp', 'Se arranca con node dist/index.js', 'gracias']);
  });

  it('[R50.9] escrituras, comandos y subagentes se ven como una línea discreta', async () => {
    const { panel } = await mount({
      assistant: () => [
        { read: 'Write', target: 'notas.md' },
        { read: 'Edit', target: 'package.json' },
        { read: 'Bash', target: 'npm install' },
        { read: 'Agent', target: 'revisar el MCP' },
        { read: 'Write', target: 'x.json', ok: false },
        { text: 'Listo' },
      ],
    });
    await say(panel, 'instala el MCP');
    expect(await panel.findByText('Ha escrito notas.md')).toBeTruthy();
    expect(await panel.findByText('Ha editado package.json')).toBeTruthy();
    expect(await panel.findByText('Ha ejecutado «npm install»')).toBeTruthy();
    expect(await panel.findByText('Ha lanzado un subagente: revisar el MCP')).toBeTruthy();
    expect((await panel.findByText('Ha escrito x.json (bloqueado)')).className).toContain('is-denied');
  });

  it('[R29.2] crea un agente con el mismo contrato y la tarjeta permite deshacerlo', async () => {
    const { api, panel } = await mount({ assistant: () => [{ text: 'Creo el agente. ' }, { tool: 'create_agent', args: { name: 'Revisor', description: 'Revisa textos', instructions: '# Revisa' } }, { text: 'Hecho.' }] });
    await say(panel, 'crea un revisor');
    const card = within(await panel.findByRole('article', { name: 'Acción: Crear agente' }));
    expect(await card.findByText('Agente «Revisor» creado.')).toBeTruthy();
    expect(api.agents.get('revisor')).toMatchObject({ name: 'Revisor', description: 'Revisa textos' });
    expect(await panel.findByText('Hecho.')).toBeTruthy();
    expect(panel.getByText('Creo el agente.', { exact: false })).toBeTruthy();
    // el agente aparece en la paleta al momento
    expect(await screen.findByRole('button', { name: 'Añadir «Revisor» al diagrama' })).toBeTruthy();
    await userEvent.click(card.getByRole('button', { name: 'Deshacer' }));
    await waitFor(() => expect(api.agents.has('revisor')).toBe(false));
    expect(card.getByText('Deshecho.')).toBeTruthy();
  });

  it('[R29.2] añade un paso al diagrama abierto y se ve en el lienzo', async () => {
    const { panel } = await mount({ assistant: () => [{ tool: 'add_step', args: { agentId: 'pintor', task: 'Pinta el fondo' } }] });
    await say(panel, 'añade al pintor');
    expect(await screen.findByLabelText(/^Agente «pintor»/)).toBeTruthy();
    expect(within(screen.getByLabelText(/^Agente «pintor»/)).getByText('Pinta el fondo')).toBeTruthy();
  });

  it('[R29.3] borrar pide permiso; «Denegar» no borra y se lo dice a Claude', async () => {
    const { api, panel } = await mount({ assistant: () => [{ tool: 'delete_agent', args: { id: 'pintor' } }] });
    await say(panel, 'borra al pintor');
    const card = within(await panel.findByRole('article', { name: 'Acción: Borrar agente' }));
    expect(card.getByText('Quiere borrar «pintor» del proyecto.')).toBeTruthy();
    await userEvent.click(card.getByRole('button', { name: 'Denegar' }));
    expect(await card.findByText('No lo has permitido.')).toBeTruthy();
    expect(api.agents.has('pintor')).toBe(true);
  });

  it('[R51.3] con «Sin preguntar nunca», borrar se hace sin pedir permiso', async () => {
    const { api, panel } = await mount({ assistant: () => [{ tool: 'delete_agent', args: { id: 'pintor' } }] }, 'full');
    await say(panel, 'borra al pintor');
    const card = within(await panel.findByRole('article', { name: 'Acción: Borrar agente' }));
    await waitFor(() => expect(api.agents.has('pintor')).toBe(false));
    expect(card.queryByRole('button', { name: 'Permitir' })).toBeNull();
  });

  it('[R29.3] «Permitir» hace la acción destructiva', async () => {
    const { api, panel } = await mount({ assistant: () => [{ tool: 'delete_agent', args: { id: 'pintor' } }] });
    await say(panel, 'borra al pintor');
    const card = within(await panel.findByRole('article', { name: 'Acción: Borrar agente' }));
    await userEvent.click(card.getByRole('button', { name: 'Permitir' }));
    await waitFor(() => expect(api.agents.has('pintor')).toBe(false));
  });

  it('[R29.2] un error de la acción se ve en la tarjeta y no rompe la conversación', async () => {
    const { panel } = await mount({ assistant: () => [{ tool: 'get_agent', args: { id: 'nadie' } }, { text: 'No existe.' }] });
    await say(panel, 'lee a nadie');
    const card = within(await panel.findByRole('article', { name: 'Acción: Leer un agente' }));
    expect(await card.findByText('No existe el agente «nadie».')).toBeTruthy();
    expect(await panel.findByText('No existe.')).toBeTruthy();
  });

  it('[R29.5] la conversación se conserva al cambiar de sección', async () => {
    const { panel } = await mount();
    await say(panel, 'hola');
    await panel.findByText(/modo simulado/);
    const rail = within(screen.getByRole('navigation', { name: 'Secciones' }));
    await userEvent.click(rail.getByRole('button', { name: 'Agentes' }));
    await userEvent.click(rail.getByRole('button', { name: 'Diseñador' }));
    expect(within(within(await screen.findByRole('region', { name: 'Asistente' })).getByRole('log')).getByText('hola')).toBeTruthy();
  });
});
