// @vitest-environment jsdom
import './setup';
import { describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { defaultSettings, newMcpServer } from '@orquestador/core';
import { createDiagram, type AssistantMessage } from '@orquestador/editor';
import { App } from '../src/App';
import { createMemoryApi, type MemoryApiOptions } from '../src/memoryApi';
import { goLib } from './nav';

async function mount(assistant: MemoryApiOptions['assistant']) {
  const api = createMemoryApi([createDiagram('principal', 'Principal')], {
    mcp: [{ ...newMcpServer('github', 'GitHub'), transport: 'http', url: 'https://api.github.com/mcp' } as never, { ...newMcpServer('notion', 'Notion'), transport: 'http', url: 'https://mcp.notion.com/mcp' } as never],
    ...(assistant ? { assistant } : {}),
  });
  // Con «Automático» lo que borra pide «Permitir» [R51.3].
  await api.saveSettings({ ...defaultSettings(), permissions: 'auto' });
  render(<App api={api} confirm={() => true} />);
  await userEvent.click(screen.getByRole('button', { name: 'Crear proyecto' }));
  return api;
}
const panel = async () => within(await screen.findByRole('region', { name: 'Asistente' }));
const tabs = async () => within((await panel()).getByRole('tablist', { name: 'Conversaciones' }));
const log = async () => within((await panel()).getByRole('log'));
const configure = async (server: 'GitHub' | 'Notion') => {
  const s = await goLib('contexts');
  await userEvent.click(s.getByRole('tab', { name: /MCP/ }));
  await userEvent.click(s.getByRole('button', { name: server }));
  await userEvent.click(s.getByRole('button', { name: 'Configurar con Claude' }));
};
const about = (m: AssistantMessage[], name: string) => m[0]!.text.includes(`«${name}»`);

describe('SPEC-086 · pestañas del asistente (interfaz)', () => {
  it('[R86.7][R86.9][R86.10][R86.15] E86.a: cada petición de un botón abre su pestaña con su historial; la de fondo sigue y avisa', async () => {
    const api = await mount((m) => (about(m, 'GitHub') ? [{ tool: 'delete_agent', args: { id: 'nadie' } }, { text: 'Hecho en GitHub.' }] : [{ text: 'Reviso Notion.' }]));
    await configure('GitHub');
    const ask = await (await panel()).findByRole('article', { name: 'Acción: Borrar agente' });
    expect(within(ask).getByRole('button', { name: 'Permitir' })).toBeTruthy();
    await configure('Notion');
    expect(await (await log()).findByText('Reviso Notion.')).toBeTruthy();
    // La de Notion empieza de cero: Claude solo recibe su petición.
    expect(api.assistantTurns).toHaveLength(2);
    expect(api.assistantTurns[1]).toHaveLength(1);
    expect(api.assistantTurns[1]![0]!.text).toMatch(/«Notion»/);
    const strip = await tabs();
    expect(strip.getAllByRole('tab')).toHaveLength(2);
    // Cada botón da el título de su pestaña.
    expect(strip.getAllByRole('tab').map((x) => x.textContent)).toEqual(['MCP «GitHub»', 'MCP «Notion»']);
    const github = strip.getAllByRole('tab')[0]!;
    expect(github.getAttribute('aria-selected')).toBe('false');
    expect(within(github).getByRole('img', { name: 'Necesita tu respuesta' })).toBeTruthy();
    expect((await log()).queryByText('Hecho en GitHub.')).toBeNull();
    await userEvent.click(github);
    await userEvent.click((await panel()).getByRole('button', { name: 'Permitir' }));
    expect(await (await log()).findByText('Hecho en GitHub.')).toBeTruthy();
    expect((await log()).queryByText('Reviso Notion.')).toBeNull();
  });

  it('[R86.8] cerrar una pestaña que trabaja detiene su turno y no ejecuta nada más', async () => {
    const api = await mount(() => [{ tool: 'delete_agent', args: { id: 'nadie' } }, { text: 'No debería verse.' }]);
    await configure('GitHub');
    await (await panel()).findByRole('article', { name: 'Acción: Borrar agente' });
    const strip = await tabs();
    await userEvent.click(strip.getByRole('button', { name: /^Cerrar «/ }));
    await waitFor(() => expect(strip.getAllByRole('tab')).toHaveLength(1));
    expect(strip.getByRole('tab').textContent).toContain('Nueva conversación');
    expect(api.assistantResults.filter((r) => r.ok)).toHaveLength(0);
    expect(screen.queryByText('No debería verse.')).toBeNull();
  });

  it('[R86.7][R86.9] «Nueva conversación» abre otra pestaña y la anterior se conserva; lo escrito va a la activa', async () => {
    const api = await mount((m) => [{ text: `Respuesta a ${m.at(-1)!.text}` }]);
    await userEvent.click(screen.getByRole('button', { name: 'Asistente' }));
    const p = await panel();
    await userEvent.type(p.getByLabelText('Mensaje para el asistente'), 'hola{Enter}');
    expect(await (await log()).findByText('Respuesta a hola')).toBeTruthy();
    await userEvent.click(p.getByRole('button', { name: 'Nueva conversación' }));
    const strip = await tabs();
    expect(strip.getAllByRole('tab')).toHaveLength(2);
    await userEvent.type(p.getByLabelText('Mensaje para el asistente'), 'otra cosa{Enter}');
    expect(await (await log()).findByText('Respuesta a otra cosa')).toBeTruthy();
    expect(api.assistantTurns[1]).toHaveLength(1);
    await userEvent.click(strip.getByRole('tab', { name: /hola/ }));
    expect((await log()).getByText('Respuesta a hola')).toBeTruthy();
  });

  it('[R86.14] las pestañas se guardan tras cada cambio y vuelven al reabrir el proyecto', async () => {
    const api = await mount(() => [{ text: 'Listo.' }]);
    await userEvent.click(screen.getByRole('button', { name: 'Asistente' }));
    await userEvent.type((await panel()).getByLabelText('Mensaje para el asistente'), 'conecta GitHub{Enter}');
    await (await log()).findByText('Listo.');
    await waitFor(
      async () => {
        const r = await api.assistantTabsLoad();
        expect(r.ok ? r.value?.tabs[0]?.title : undefined).toBe('conecta GitHub');
      },
      { timeout: 3000 },
    );
    cleanup();
    render(<App api={api} confirm={() => true} />);
    await userEvent.click(screen.getByRole('button', { name: 'Crear proyecto' }));
    await userEvent.click(screen.getByRole('button', { name: 'Asistente' }));
    expect(await (await tabs()).findByRole('tab', { name: /conecta GitHub/ })).toBeTruthy();
    expect((await log()).getByText('Listo.')).toBeTruthy();
  });
});
