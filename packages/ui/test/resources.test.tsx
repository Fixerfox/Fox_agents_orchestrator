// @vitest-environment jsdom
import './setup';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RunEvent } from '@orquestador/core';
import { deriveLive, historyRows, type RunSummary } from '@orquestador/editor';
import { NodePanel } from '../src/runs/NodePanel';
import { MetricsPanel } from '../src/runs/MetricsPanel';
import { HistorySection, type HistoryFilterState } from '../src/runs/HistorySection';
import { SettingsDialog } from '../src/settings/SettingsDialog';
import { createMemoryApi } from '../src/memoryApi';
import { useState } from 'react';
import { newAgent } from '@orquestador/core';
import { createDiagram } from '@orquestador/editor';
import { App } from '../src/App';
import { goLib } from './nav';

let seq = 0;
const at = (s: number) => new Date(Date.parse('2026-11-08T10:00:00.000Z') + s * 1000).toISOString();
const ev = (s: number, b: object): RunEvent => ({ runId: 'r1', seq: ++seq, ts: at(s), ...b }) as RunEvent;
const begun = [ev(0, { type: 'run.started', diagramId: 'd' }), ev(0, { type: 'node.started', nodeId: 'a' }), ev(0, { type: 'agent.request', nodeId: 'a', agentId: 'dev', attempt: 1, input: { text: '', files: [] } })];
const panel = (events: RunEvent[]) => render(<NodePanel events={events} live={deriveLive(events)} nodeId="a" nodePath={[]} label="Dev" onAnswer={vi.fn()} />);

describe('SPEC-077 · el paso en la interfaz', () => {
  it('[R77.3] «En cola» con los agentes que trabajan en toda la app', () => {
    panel([...begun, ev(1, { type: 'node.queued', nodeId: 'a', others: 8 })]);
    expect(screen.getByRole('status').textContent).toBe('En cola (8 agentes trabajando en toda la app)');
  });

  it('[R77.13] «Pausando: termina lo que está haciendo» y, retenido, «En pausa»', () => {
    const { unmount } = panel([...begun, ev(1, { type: 'run.paused' })]);
    expect(screen.getByRole('status').textContent).toBe('Pausando: termina lo que está haciendo');
    unmount();
    panel([...begun, ev(1, { type: 'run.paused' }), ev(2, { type: 'node.paused', nodeId: 'a', tool: 'Bash' })]);
    expect(screen.getByRole('status').textContent).toBe('En pausa');
  });
});

describe('SPEC-077 · «Rendimiento»', () => {
  it('[R77.18] cronograma de los pasos, tabla por agente con el Supervisor aparte, por modelo y CSV', async () => {
    const events = [
      ...begun,
      ev(2, { type: 'agent.question', nodeId: 'a', questionId: 'q', text: '¿?' }),
      ev(6, { type: 'agent.answer', nodeId: 'a', questionId: 'q', text: 'sí' }),
      ev(8, { type: 'agent.usage', nodeId: 'a', inputTokens: 100, outputTokens: 20, costUsd: 0.4 }),
      ev(9, { type: 'agent.usage', nodeId: 'a', inputTokens: 5, outputTokens: 5, costUsd: 0.02, source: 'supervisor' }),
      ev(10, { type: 'node.finished', nodeId: 'a', status: 'succeeded' }),
      ev(10, { type: 'run.finished', status: 'succeeded' }),
    ];
    const click = vi.fn();
    const anchor = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = click;
    const createObjectURL = (URL as unknown as { createObjectURL?: unknown }).createObjectURL;
    Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => undefined });
    try {
      render(<MetricsPanel events={events} label={(id) => (id === 'a' ? 'Especificador' : id)} runId="r1" agentName={(id) => (id === 'dev' ? 'Desarrollador' : id)} />);
      expect(within(screen.getByRole('region', { name: 'Cronograma de los pasos' })).getByRole('listitem', { name: 'Especificador' })).toBeTruthy();
      const table = within(screen.getByRole('region', { name: 'Por agente' }));
      const row = table.getByText('Desarrollador').closest('tr')!;
      expect(within(row).getByText('0,400 $')).toBeTruthy();
      expect(within(table.getByText('Supervisor y decisiones').closest('tr')!).getByText('0,020 $')).toBeTruthy();
      expect(within(screen.getByRole('region', { name: 'Por modelo' })).getByText('predeterminado')).toBeTruthy();
      expect(screen.getByText(/esperándote 4 s/)).toBeTruthy();
      await userEvent.click(screen.getByRole('button', { name: 'Exportar a CSV' }));
      expect(click).toHaveBeenCalled();
    } finally {
      HTMLAnchorElement.prototype.click = anchor;
      Object.assign(URL, { createObjectURL });
    }
  });
});

describe('SPEC-077 · historial', () => {
  it('[R77.19] se ordena y filtra por coste, duración y reintentos', async () => {
    const run = (id: string, o: Partial<RunSummary>): RunSummary => ({ runId: id, diagramId: 'd', diagramName: id, order: id, startedAt: '2026-11-08T10:00:00.000Z', finishedAt: '2026-11-08T10:01:00.000Z', status: 'succeeded', usage: { inputTokens: 1, outputTokens: 1, costUsd: 0.1 }, eventCount: 1, ...o });
    const rows = historyRows([run('nueva', { startedAt: '2026-11-08T12:00:00.000Z', finishedAt: '2026-11-08T12:00:30.000Z' }), run('cara', { usage: { inputTokens: 1, outputTokens: 1, costUsd: 5 } }), run('repetida', { retries: 3, startedAt: '2026-11-08T09:00:00.000Z', finishedAt: '2026-11-08T09:20:00.000Z' })], {}, 0);
    function Host() {
      const [filter, setFilter] = useState<HistoryFilterState>({ group: 'all', diagramId: '', text: '' });
      return <HistorySection rows={rows} filter={filter} setFilter={setFilter} names={{}} open={vi.fn()} />;
    }
    render(<Host />);
    const names = () => screen.getAllByRole('button', { name: /^Abrir/ }).map((b) => b.textContent);
    expect(names()).toEqual(['nueva', 'cara', 'repetida']);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /Ordenar por/ }), 'cost');
    expect(names()[0]).toBe('cara');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /Ordenar por/ }), 'duration');
    expect(names()[0]).toBe('repetida');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /Mostrar/ }), 'retried');
    expect(names()).toEqual(['repetida']);
    expect(screen.getByRole('columnheader', { name: 'Reintentos' })).toBeTruthy();
  });
});

describe('SPEC-077 · Ajustes', () => {
  it('[R77.1][R77.8][R77.10] agentes en toda la app y qué hacer al llegar al presupuesto, en Ejecución; el gasto por minuto, en Supervisor', async () => {
    const api = createMemoryApi([], {});
    render(<SettingsDialog api={api} onSaved={() => undefined} />);
    const page = within(screen.getByRole('region', { name: 'Ajustes' }));
    await page.findByRole('heading', { name: 'Claude' });
    const index = within(page.getByRole('navigation', { name: 'Ajustes' }));
    await userEvent.click(index.getByRole('button', { name: /^Ejecución y presupuesto/ }));
    const total = page.getByLabelText('Agentes a la vez en toda la app') as HTMLInputElement;
    expect(total.value).toBe('8');
    await userEvent.clear(total);
    await userEvent.type(total, '12');
    await userEvent.selectOptions(page.getByLabelText('Al llegar al presupuesto'), 'finish-running');
    await waitFor(async () => {
      const s = await api.getSettings();
      expect(s.ok && [s.value.maxAgentsTotal, s.value.onBudget]).toEqual([12, 'finish-running']);
    });
    await userEvent.click(index.getByRole('button', { name: /^Supervisor/ }));
    expect((page.getByLabelText(/Avisar si un paso gasta más de/) as HTMLInputElement).value).toBe('1');
  });
});

describe('SPEC-077 · ficha del agente', () => {
  it('[R77.9] el presupuesto de cada intento se pone en «Avanzado» de la ficha y se guarda en sus límites', async () => {
    const api = createMemoryApi([createDiagram('principal', 'Principal')], { agents: [{ ...newAgent('a', 'Alfa'), limits: { idleMinutes: 5 } }] });
    render(<App api={api} confirm={() => true} />);
    await userEvent.click(screen.getByRole('button', { name: 'Crear proyecto' }));
    const s = await goLib('agents');
    await userEvent.click(s.getByRole('button', { name: 'Alfa' }));
    await userEvent.click(s.getByRole('button', { name: /^Modelo y aspecto/ }));
    const adv = s.getByText('Avanzado').closest('details')!;
    await userEvent.type(within(adv).getByLabelText('Presupuesto de cada intento ($)'), '2');
    await userEvent.click(s.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(api.agents.get('a')?.limits).toEqual({ idleMinutes: 5, maxCostUsd: 2 }));
    await userEvent.clear(within(adv).getByLabelText('Presupuesto de cada intento ($)'));
    await userEvent.click(s.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(api.agents.get('a')?.limits).toEqual({ idleMinutes: 5 }));
  });
});
