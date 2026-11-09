// @vitest-environment jsdom
import './setup';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RunEvent } from '@orquestador/core';
import { deriveLive, memoryCards } from '@orquestador/editor';
import { MemoryCards } from '../src/runs/MemoryCards';
import { NodePanel } from '../src/runs/NodePanel';

let seq = 0;
const ev = (b: object): RunEvent => ({ runId: 'r', seq: ++seq, ts: '2026-11-08T10:00:00.000Z', ...b }) as RunEvent;
const labels = (id: string) => ({ a: 'Especificador', b: 'Planificador' })[id] ?? id;

const run = [
  ev({ type: 'node.started', nodeId: 'a', input: { text: '', files: [] } }),
  ev({ type: 'agent.request', nodeId: 'a', agentId: 'a', attempt: 1, input: { text: 'x', files: [] } }),
  ev({ type: 'agent.question', nodeId: 'a', questionId: 'q', text: '¿Base de datos?' }),
  ev({ type: 'agent.answer', nodeId: 'a', questionId: 'q', text: 'PostgreSQL' }),
  ev({ type: 'memory.note', nodeId: 'a', text: 'Dejé el login a medias' }),
  ev({ type: 'supervisor.note', nodeId: 'a', text: 'Escribió la spec', reviewed: true }),
  ev({ type: 'node.finished', nodeId: 'a', status: 'succeeded', output: { text: 'Spec', files: [] } }),
];

describe('SPEC-072 · la memoria en la interfaz', () => {
  it('[R72.22] la pestaña Memoria va por bloques, en el orden de los agentes, y cada tarjeta dice de dónde sale', () => {
    render(<MemoryCards notes={memoryCards(run, labels)} />);
    const blocks = screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'));
    expect(blocks).toEqual(['Decisiones de la persona', 'Notas de los pasos', 'Lo que hizo cada paso']);
    expect(within(screen.getByRole('region', { name: 'Decisiones de la persona' })).getByText('de los eventos')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Notas de los pasos' })).getByText('de Especificador')).toBeTruthy();
    const steps = within(screen.getByRole('region', { name: 'Lo que hizo cada paso' }));
    expect(steps.getByText('del Supervisor')).toBeTruthy();
    expect(steps.getByText('Escribió la spec')).toBeTruthy();
  });

  it('[R72.23] junto a lo que recibió el paso: su memoria, qué se recortó y «Ver la memoria completa»', async () => {
    const events = [
      ...run,
      ev({ type: 'node.started', nodeId: 'b', input: { text: '', files: [] } }),
      ev({ type: 'agent.request', nodeId: 'b', agentId: 'b', attempt: 1, input: { text: 'Planifica', files: [] }, memory: 'Resumen de los pasos:\n- Especificador: Escribió la spec', memoryStats: { tokens: { steps: 20, files: 200 }, trimmed: ['files', 'steps'] } }),
    ];
    const onMemory = vi.fn();
    render(<NodePanel events={events} live={deriveLive(events)} nodeId="b" nodePath={[]} label="Planificador" onAnswer={vi.fn()} onMemory={onMemory} />);
    await userEvent.click(screen.getByText('Memoria que recibió'));
    expect(screen.getByText(/Especificador: Escribió la spec/)).toBeTruthy();
    expect(screen.getByText('Se recortó: Archivos, Lo que hizo cada paso')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Ver la memoria completa' }));
    expect(onMemory).toHaveBeenCalled();
  });

  it('[R72.24] la nota del agente se ve en su conversación como tarjeta', async () => {
    render(<NodePanel events={run} live={deriveLive(run)} nodeId="a" nodePath={[]} label="Especificador" onAnswer={vi.fn()} />);
    await userEvent.click(screen.getByRole('tab', { name: /Conversación/ }));
    expect(screen.getByText('Nota para los siguientes pasos')).toBeTruthy();
    expect(screen.getByText('Dejé el login a medias')).toBeTruthy();
  });
});
