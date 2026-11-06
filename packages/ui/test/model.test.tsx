// @vitest-environment jsdom
import './setup';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RunEvent } from '@orquestador/core';
import { deriveLive } from '@orquestador/editor';
import { App } from '../src/App';
import { NodePanel } from '../src/runs/NodePanel';
import { createMemoryApi } from '../src/memoryApi';

const AGENTS = [{ id: 'sprites', name: 'Sprites', description: 'Dibuja en píxel art', model: 'claude-sonnet-5-5' }];

describe('SPEC-040 · modelo por paso en la interfaz', () => {
  it('[R40.5] el panel del paso elige el modelo solo para ese paso y la tarjeta lo muestra; «El del agente» lo quita', async () => {
    render(<App initialProject="Juego" api={createMemoryApi()} agents={AGENTS} confirm={() => true} />);
    await userEvent.click(screen.getByRole('button', { name: '+ Agente' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Sprites/ }));
    const card = await screen.findByLabelText(/^Agente «sprites»/);
    const select = screen.getByLabelText('Modelo') as HTMLSelectElement;
    expect(select.value).toBe('');
    expect([...select.options].map((o) => o.textContent)).toEqual(['El del agente (Sonnet 5.5)', 'Sonnet 5.5', 'Opus 5.5', 'Haiku 5.5']);
    await userEvent.selectOptions(select, 'Opus 5.5');
    expect((screen.getByLabelText('Modelo') as HTMLSelectElement).value).toBe('claude-opus-5-5');
    expect(within(card).getByText('Sprites · Opus 5.5')).toBeTruthy();
    await userEvent.selectOptions(screen.getByLabelText('Modelo'), 'El del agente (Sonnet 5.5)');
    expect(within(card).queryByText(/Opus 5\.5/)).toBeNull();
    expect(within(card).getByText('Sprites')).toBeTruthy();
  });

  it('[R40.6] la entrada de un intento dice el modelo cuando el paso tenía uno propio', () => {
    const ev = (seq: number, body: object): RunEvent => ({ runId: 'r', seq, ts: 't', ...body }) as RunEvent;
    const withModel = [ev(1, { type: 'agent.request', nodeId: 'a', agentId: 'sprites', attempt: 1, model: 'claude-haiku-5-5', input: { text: 'hola' } })];
    const { unmount } = render(<NodePanel events={withModel} live={deriveLive(withModel)} nodeId="a" nodePath={[]} label="Sprites" onAnswer={vi.fn()} />);
    expect(screen.getByText('Recibió (intento 1) · Haiku 5.5')).toBeTruthy();
    unmount();
    const plain = [ev(1, { type: 'agent.request', nodeId: 'a', agentId: 'sprites', attempt: 1, input: { text: 'hola' } })];
    render(<NodePanel events={plain} live={deriveLive(plain)} nodeId="a" nodePath={[]} label="Sprites" onAnswer={vi.fn()} />);
    expect(screen.getByText('Recibió (intento 1)')).toBeTruthy();
  });
});
