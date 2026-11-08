// @vitest-environment jsdom
import './setup';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { defaultSettings, newAgent, type Diagram, type RunEvent } from '@orquestador/core';
import { EMPTY_LIVE, createDiagram, type RunSummary } from '@orquestador/editor';
import { App } from '../src/App';
import { alwaysConfirms, runAssistantTool, type AssistantHost } from '../src/assistant/assistantTools';
import { RunDoneBanner } from '../src/runs/RunDoneBanner';
import { RunsScreen } from '../src/runs/RunsScreen';
import { createMemoryApi } from '../src/memoryApi';
import { settingsSection } from './nav';
import type { RunsIndex } from '../src/runs/useRunsIndex';

const D: Diagram = {
  id: 'd',
  name: 'Quickstart',
  schemaVersion: 1,
  nodes: [
    { id: 'entry', kind: 'entry', position: { x: 0, y: 0 } },
    { id: 'a', kind: 'agent', agentId: 'a', label: 'A', position: { x: 1, y: 0 } },
    { id: 'output', kind: 'output', position: { x: 2, y: 0 } },
  ],
  edges: [
    { id: 'e1', from: 'entry', to: 'a' },
    { id: 'e2', from: 'a', to: 'output' },
  ],
};
const REASON = 'No cumple lo pedido: la medición real de 30 minutos no se hizo';
const ev = (seq: number, body: Record<string, unknown>) => ({ runId: 'old', seq, ts: `2026-11-07T10:00:0${seq}.000Z`, ...body }) as unknown as RunEvent;
const failedRun = (): { summary: RunSummary; events: RunEvent[]; diagram: Diagram } => ({
  summary: { runId: 'old', diagramId: 'd', diagramName: 'Quickstart', status: 'failed', reason: REASON, startedAt: '2026-11-07T10:00:01.000Z', finishedAt: '2026-11-07T10:00:04.000Z', usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 }, eventCount: 4, order: 'Mide el quickstart' },
  events: [
    ev(1, { type: 'run.started', diagramId: 'd' }),
    ev(2, { type: 'node.started', nodeId: 'entry', input: { text: 'Mide el quickstart', files: [] } }),
    ev(3, { type: 'supervisor.verified', met: false, detail: 'la medición real de 30 minutos no se hizo' }),
    ev(4, { type: 'run.finished', status: 'failed', reason: REASON }),
  ],
  diagram: D,
});

function runsScreen(api: ReturnType<typeof createMemoryApi>, runs: RunSummary[], onAskAssistant = vi.fn()) {
  const index: RunsIndex = { runs, diagramNames: { d: 'Quickstart' }, pending: [], queue: [], loaded: true, refresh: vi.fn() };
  render(<RunsScreen api={api} main={{ version: 0, events: [], live: EMPTY_LIVE }} index={index} nav={{ section: 'history', runId: 'old' }} onNav={vi.fn()} subOpen onToggleSub={vi.fn()} onControlMain={vi.fn()} onAnswerMain={vi.fn()} agentNames={{ a: 'A' }} onExport={vi.fn()} onAskAssistant={onAskAssistant} />);
  return { index, onAskAssistant };
}

describe('SPEC-065 · en la interfaz', () => {
  it('[R65.8] «Dar por bueno» pide el motivo y deja la ejecución aceptada por ti, sin olvidar por qué falló', async () => {
    const past = failedRun();
    const api = createMemoryApi([D], { pastRuns: [past] });
    const { index } = runsScreen(api, [past.summary]);
    await userEvent.click(await screen.findByRole('button', { name: 'Dar por bueno' }, { timeout: 4000 }));
    const dlg = within(screen.getByRole('dialog', { name: 'Dar por bueno' }));
    await userEvent.click(dlg.getByRole('button', { name: 'Dar por bueno' }));
    expect(dlg.getByRole('alert').textContent).toBe('Escribe por qué lo das por bueno');
    await userEvent.type(dlg.getByLabelText('¿Por qué lo das por bueno?'), 'La medición la hago yo');
    await userEvent.click(dlg.getByRole('button', { name: 'Dar por bueno' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Dar por bueno' })).toBeNull());
    expect(index.refresh).toHaveBeenCalled();
    const note = await screen.findByRole('note', {}, { timeout: 4000 });
    expect(note.textContent).toContain('Aceptada por ti: La medición la hago yo');
    expect(note.textContent).toContain(`Había fallado: ${REASON}`);
    expect(await screen.findByText('Aceptada por ti: La medición la hago yo', { selector: 'strong' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Dar por bueno' })).toBeNull();
    const list = await api.listRuns();
    expect(list.ok && list.value.find((r) => r.runId === 'old')).toMatchObject({ status: 'succeeded', accepted: { by: 'user', reason: 'La medición la hago yo', previousReason: REASON } });
  });

  it('[R65.10] «Hablar con el asistente» abre el asistente con el id de la ejecución', async () => {
    const past = failedRun();
    const api = createMemoryApi([D], { pastRuns: [past] });
    const { onAskAssistant } = runsScreen(api, [past.summary]);
    await userEvent.click(await screen.findByRole('button', { name: 'Hablar con el asistente' }, { timeout: 4000 }));
    expect(onAskAssistant).toHaveBeenCalledWith('Quiero hablar de la ejecución old (Quickstart, Fallida).');
  });

  it('[R65.10] en la app, el botón abre el panel del asistente con la petición ya enviada', async () => {
    const past = failedRun();
    const api = createMemoryApi([D, createDiagram('principal', 'Principal')], { pastRuns: [past], agents: [newAgent('a', 'A')] });
    render(<App initialProject="Juego" api={api} agents={[]} confirm={() => true} />);
    await userEvent.click(screen.getByRole('button', { name: /^Proyecto «/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Abrir proyecto' }));
    await userEvent.click(await within(screen.getByRole('navigation', { name: 'Secciones' })).findByRole('button', { name: 'Ejecuciones' }));
    await userEvent.click(await screen.findByRole('button', { name: /Quickstart/ }, { timeout: 4000 }));
    await userEvent.click(await screen.findByRole('button', { name: 'Hablar con el asistente' }, { timeout: 4000 }));
    const panel = within(await screen.findByRole('region', { name: 'Asistente' }));
    expect(await panel.findByText('Quiero hablar de la ejecución old (Quickstart, Fallida).')).toBeTruthy();
  });

  it('[R65.4] terminada con algo para una persona: el aviso del final lo marca como atención', () => {
    const events = [ev(1, { type: 'run.started', diagramId: 'd' }), ev(2, { type: 'supervisor.verified', met: true, detail: '', forPerson: 'Medir los 30 minutos' }), ev(3, { type: 'run.finished', status: 'succeeded' })];
    render(<RunDoneBanner events={events} labelOf={(n) => n} onSummary={vi.fn()} onAccept={vi.fn()} />);
    const banner = screen.getByRole('region', { name: /./ });
    expect(banner.className).toContain('is-attention');
    expect(banner.textContent).toContain('Terminada · te toca comprobar algo');
    // terminó bien: no hay nada que dar por bueno
    expect(screen.queryByRole('button', { name: 'Dar por bueno' })).toBeNull();
  });

  it('[R65.4] Ajustes del Supervisor elige qué hacer con lo que solo puede comprobar una persona', async () => {
    const api = createMemoryApi([]);
    render(<App api={api} confirm={() => true} />);
    await userEvent.click(screen.getByRole('button', { name: 'Ajustes' }));
    const page = within(await screen.findByRole('region', { name: 'Ajustes' }));
    await page.findByRole('heading', { name: 'Claude' });
    await settingsSection('Supervisor');
    const select = page.getByLabelText('Lo que solo puede comprobar una persona') as HTMLSelectElement;
    expect(select.value).toBe('warn');
    expect([...select.options].map((o) => o.textContent)).toEqual(['Avisar', 'Hacer fallar la ejecución']);
    await userEvent.selectOptions(select, 'fail');
    await waitFor(async () => {
      const s = await api.getSettings();
      expect(s.ok && s.value.supervisorHumanChecks).toBe('fail');
    });
  });

  it('[R65.9] accept_run da por buena la ejecución como asistente, pide permiso siempre y list_runs lo dice', async () => {
    expect(alwaysConfirms('accept_run')).toBe(true);
    expect(alwaysConfirms('delete_agent')).toBe(false);
    const past = failedRun();
    const api = createMemoryApi([D], { pastRuns: [past] });
    const host = { api, refresh: () => {} } as unknown as AssistantHost;
    const res = await runAssistantTool(host, 'accept_run', { runId: 'old', reason: 'Lo ha pedido la persona' });
    expect(res.ok).toBe(true);
    const list = await runAssistantTool(host, 'list_runs', {});
    expect((list.result as { runId: string }[]).find((r) => r.runId === 'old')).toMatchObject({ status: 'succeeded', canResume: false, accepted: { by: 'assistant', reason: 'Lo ha pedido la persona' } });
    const again = await runAssistantTool(host, 'accept_run', { runId: 'old', reason: 'otra vez' });
    expect(again.ok).toBe(false);
  });

  it('[R65.9] con «Sin preguntar nunca», accept_run sigue pidiendo «Permitir»', async () => {
    const past = failedRun();
    const api = createMemoryApi([createDiagram('principal', 'Principal'), D], { pastRuns: [past], agents: [newAgent('a', 'A')], assistant: () => [{ tool: 'accept_run', args: { runId: 'old', reason: 'la medición la hago yo' } }] });
    await api.saveSettings({ ...defaultSettings(), permissions: 'full' });
    render(<App initialProject="Juego" api={api} agents={[]} confirm={() => true} />);
    await userEvent.click(screen.getByRole('button', { name: /^Proyecto «/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Abrir proyecto' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Asistente' }));
    const panel = within(await screen.findByRole('region', { name: 'Asistente' }));
    await userEvent.type(panel.getByLabelText('Mensaje para el asistente'), 'dala por buena{Enter}');
    const card = within(await panel.findByRole('article', { name: 'Acción: Dar por buena una ejecución' }));
    expect(card.getByText('Quiere dar por buena la ejecución «old», que falló. Motivo: «la medición la hago yo».')).toBeTruthy();
    let list = await api.listRuns();
    expect(list.ok && list.value.find((r) => r.runId === 'old')?.status).toBe('failed');
    await userEvent.click(card.getByRole('button', { name: 'Permitir' }));
    await waitFor(async () => {
      list = await api.listRuns();
      expect(list.ok && list.value.find((r) => r.runId === 'old')?.status).toBe('succeeded');
    });
  });
});
