// @vitest-environment jsdom
import './setup';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { defaultSettings, type DiagramNode, type RunEvent } from '@orquestador/core';
import { deriveLive } from '@orquestador/editor';
import { RunDialog } from '../src/runs/RunDialog';
import { NodePanel } from '../src/runs/NodePanel';
import { SettingsDialog } from '../src/settings/SettingsDialog';
import { stepSections } from '../src/diagrams/StepFields';
import { createMemoryApi } from '../src/memoryApi';

const ev = (seq: number, body: object): RunEvent => ({ runId: 'r', seq, ts: '2026-11-08T10:00:00.000Z', ...body }) as RunEvent;

describe('SPEC-070 · interfaz', () => {
  it('[R70.19] «Lanzar» tiene «Si nadie responde» y la opción elegida viaja con la ejecución', async () => {
    const onLaunch = vi.fn();
    render(<RunDialog diagramName="Web" engine="simulated" runnable lastInput="hola" onEngine={vi.fn()} onStart={vi.fn()} onClose={vi.fn()} onLaunch={onLaunch} unanswered={{ afterMinutes: 45, action: 'fail' }} />);
    const d = within(screen.getByRole('dialog'));
    const group = d.getByRole('group', { name: 'Si nadie responde' });
    expect((within(group).getByRole('radio', { name: /Fallar el paso/ }) as HTMLInputElement).checked).toBe(true);
    expect((within(group).getByRole('spinbutton') as HTMLInputElement).value).toBe('45');
    await userEvent.click(within(group).getByRole('radio', { name: /Elegir la respuesta segura/ }));
    await userEvent.click(d.getByRole('button', { name: /Lanzar y ver la ejecución/ }));
    expect(onLaunch.mock.calls[0]![4]).toMatchObject({ unanswered: { afterMinutes: 45, action: 'fallback' } });
  });

  it('[R70.19] con «Esperar» no se pide tiempo', () => {
    render(<RunDialog diagramName="Web" engine="simulated" runnable onEngine={vi.fn()} onStart={vi.fn()} onClose={vi.fn()} onLaunch={vi.fn()} />);
    const group = within(screen.getByRole('group', { name: 'Si nadie responde' }));
    expect((group.getByRole('radio', { name: /Esperar/ }) as HTMLInputElement).checked).toBe(true);
    expect(group.queryByRole('spinbutton')).toBeNull();
  });

  it('[R70.20] el paso enseña «Sin actividad desde hace N min» y, tras el corte, que se reintenta', () => {
    const base = [ev(1, { type: 'node.started', nodeId: 'a' }), ev(2, { type: 'agent.request', nodeId: 'a', agentId: 'a', attempt: 1, input: { text: 'x', files: [] } })];
    const stalled = [...base, ev(3, { type: 'supervisor.alert', nodeId: 'a', rule: 'stalled', severity: 'info', detail: 'Sin actividad desde hace 5 min.' })];
    const live = deriveLive(stalled);
    expect(live.health['a']).toEqual({ stalledMinutes: 5 });
    const { unmount } = render(<NodePanel events={stalled} live={live} nodeId="a" nodePath={[]} label="Web" onAnswer={vi.fn()} />);
    expect(screen.getByRole('status').textContent).toBe('Sin actividad desde hace 5 min');
    unmount();
    const cut = [...stalled, ev(4, { type: 'node.timeout', nodeId: 'a', attempt: 1, kind: 'idle', minutes: 10 })];
    render(<NodePanel events={cut} live={deriveLive(cut)} nodeId="a" nodePath={[]} label="Web" onAnswer={vi.fn()} />);
    expect(screen.getByRole('status').textContent).toBe('Cortado por inactividad, se reintenta');
    // Una señal de vida lo quita.
    const back = [...stalled, ev(4, { type: 'token.stream', nodeId: 'a', text: 'sigo' })];
    expect(deriveLive(back).health['a']).toBeUndefined();
  });

  it('[R70.21] Ajustes tiene «Límites de tiempo» con la inactividad y la política de preguntas', async () => {
    const api = createMemoryApi();
    await api.saveSettings({ ...defaultSettings(), limits: { idleMinutes: 12 } });
    render(<SettingsDialog api={api} onSaved={() => undefined} />);
    const page = within(screen.getByRole('region', { name: 'Ajustes' }));
    await page.findByRole('heading', { name: 'Claude' });
    const index = within(page.getByRole('navigation', { name: 'Ajustes' }));
    expect(index.getByRole('button', { name: /^Límites de tiempo/ }).textContent).toContain('Corta a los 12 min · Esperar');
    await userEvent.click(index.getByRole('button', { name: /^Límites de tiempo/ }));
    expect((page.getByLabelText('Inactividad sin herramienta en curso (minutos)') as HTMLInputElement).value).toBe('12');
    expect((page.getByLabelText('Inactividad con una herramienta en curso (minutos)') as HTMLInputElement).value).toBe('30');
    await userEvent.selectOptions(page.getByLabelText('Si nadie responde a una pregunta'), 'fallback');
    expect(page.getByLabelText('Minutos de espera')).toBeTruthy();
  });
});

describe('SPEC-071 · interfaz', () => {
  it('[R71.15] cada reintento es un separador con su motivo y, desplegado, el error y lo que recibió el nuevo intento', () => {
    const events = [
      ev(1, { type: 'node.started', nodeId: 'a' }),
      ev(2, { type: 'agent.request', nodeId: 'a', agentId: 'a', attempt: 1, input: { text: 'x', files: [] } }),
      ev(3, { type: 'error', nodeId: 'a', message: 'El paso no dio señales de vida en 10 min', retriable: true }),
      ev(4, { type: 'node.retrying', nodeId: 'a', attempt: 1, max: 3, delayMs: 1000, message: 'El paso no dio señales de vida en 10 min', kind: 'timeout', cause: 'timeout' }),
      ev(5, { type: 'agent.request', nodeId: 'a', agentId: 'a', attempt: 2, input: { text: 'x', files: [] }, previousAttempt: { attempt: 1, kind: 'timeout', ended: 'timeout', message: 'sin señales', actions: [], files: [{ path: 'a.ts', change: 'created' }] } }),
    ];
    render(<NodePanel events={events} live={deriveLive(events)} nodeId="a" nodePath={[]} label="Web" onAnswer={vi.fn()} />);
    expect(screen.getByText('Intento 2 · el anterior se cortó por inactividad')).toBeTruthy();
    expect(screen.getByText('Error del intento 1: El paso no dio señales de vida en 10 min')).toBeTruthy();
    expect(screen.getByText('Lo que se le contó del intento anterior')).toBeTruthy();
    expect(document.body.textContent).toContain('a.ts (creado)');
  });

  it('[R71.16] el lateral del paso tiene «Al reintentar» y los límites de tiempo propios', async () => {
    const node: DiagramNode = { id: 'a', kind: 'agent', agentId: 'a', label: 'Web' };
    const patch = vi.fn();
    const snap = { level: { id: 'd', name: 'd', schemaVersion: 1, nodes: [node], edges: [] } } as never;
    const section = stepSections({ node, snap, agents: [], patch }).find((s) => s.id === 'supervision')!;
    render(<>{section.content}</>);
    const select = screen.getByLabelText('Al reintentar') as HTMLSelectElement;
    expect(select.value).toBe('keep');
    expect(screen.getByText(/Lo que cambiaron los comandos no se puede deshacer/)).toBeTruthy();
    await userEvent.selectOptions(select, 'restore');
    expect(patch).toHaveBeenCalledWith({ onRetry: 'restore' });
    await userEvent.type(screen.getByLabelText('Inactividad (min)'), '5');
    expect(patch).toHaveBeenCalledWith({ limits: { idleMinutes: 5 } });
  });
});
