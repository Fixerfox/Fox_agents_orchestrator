// @vitest-environment jsdom
import './setup';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { defaultSettings, type RunEvent, type StepCheck } from '@orquestador/core';
import { deriveLive, summarizeRun, supervisorAlerts } from '@orquestador/editor';
import { ChecksEditor } from '../src/diagrams/ChecksEditor';
import { NodePanel } from '../src/runs/NodePanel';
import { SupervisorPanel } from '../src/runs/SupervisorTab';
import { SettingsDialog } from '../src/settings/SettingsDialog';
import { createMemoryApi } from '../src/memoryApi';

let seq = 0;
const ev = (b: Record<string, unknown>) => ({ runId: 'r', seq: ++seq, ts: '2026-11-08T10:00:00.000Z', ...b }) as unknown as RunEvent;

describe('SPEC-075 · en la interfaz', () => {
  it('[R75.24] el paso edita sus comprobaciones: añadir, nombrar, ordenar, quitar y «Ejecutar ahora»', async () => {
    const onChange = vi.fn();
    const onTry = vi.fn(async (c: StepCheck) => ({ checkId: c.id, label: c.label, kind: c.kind, ok: false, detail: '2 tests rojos', durationMs: 5 }));
    render(<ChecksEditor legend="Comprobaciones" checks={[]} onChange={onChange} onTry={onTry} />);
    const box = within(screen.getByRole('group', { name: 'Comprobaciones' }));
    await userEvent.click(box.getByRole('button', { name: 'Añadir comprobación' }));
    // Un comando vacío no se guarda: se dice qué falta.
    expect(onChange).not.toHaveBeenCalled();
    expect(box.getByRole('alert').textContent).toContain('falta el comando');
    await userEvent.type(box.getByLabelText('Línea de comandos'), 'npm test');
    expect(onChange).toHaveBeenLastCalledWith([{ id: 'c1', label: 'Comando', kind: 'command', run: 'npm test' }]);
    await userEvent.click(box.getByRole('button', { name: 'Ejecutar ahora' }));
    expect(onTry).toHaveBeenCalled();
    expect((await box.findByRole('status')).textContent).toBe('✗ 2 tests rojos');
    await userEvent.selectOptions(box.getByLabelText('Tipo de comprobación'), 'files');
    await userEvent.click(box.getByRole('button', { name: 'Añadir comprobación' }));
    await userEvent.type(box.getByLabelText('Tienen que existir (un patrón por línea)'), 'docs/*.md');
    expect(onChange.mock.lastCall![0].map((c: StepCheck) => c.id)).toEqual(['c1', 'c2']);
    await userEvent.click(box.getByRole('button', { name: 'Subir «Archivos»' }));
    expect(onChange.mock.lastCall![0].map((c: StepCheck) => c.id)).toEqual(['c2', 'c1']);
    await userEvent.click(box.getAllByRole('button', { name: 'Quitar' })[0]!);
    expect(onChange.mock.lastCall![0].map((c: StepCheck) => c.id)).toEqual(['c1']);
  });

  it('[R75.25] en la conversación, las comprobaciones son una fila «N de M bien» que se despliega', async () => {
    const events = [
      ev({ type: 'node.started', nodeId: 'a' }),
      ev({ type: 'agent.request', nodeId: 'a', agentId: 'a', attempt: 1, input: { text: 'x', files: [] } }),
      ev({ type: 'check.result', nodeId: 'a', checkId: 't', label: 'Tests', kind: 'command', ok: false, detail: '1 rojo', durationMs: 1 }),
      ev({ type: 'check.result', nodeId: 'a', checkId: 'l', label: 'Lint', kind: 'command', ok: true, detail: '', durationMs: 1 }),
    ];
    render(<NodePanel events={events} live={deriveLive(events)} nodeId="a" nodePath={[]} label="Web" onAnswer={vi.fn()} />);
    const row = screen.getByText('1 de 2 comprobaciones bien');
    await userEvent.click(row);
    expect(screen.getByText('✗ Tests')).toBeTruthy();
    expect(screen.getByText('1 rojo')).toBeTruthy();
  });

  it('[R75.21][R75.25] cada aviso enseña su gravedad y su evidencia, y se marca como falso o acertado', async () => {
    const events = [
      ev({ type: 'supervisor.started', review: true }),
      ev({ type: 'supervisor.alert', nodeId: 'a', rule: 'ai-review', severity: 'warning', detail: 'No añadió la documentación', gravity: 'high', evidence: ['Sin docs — ningún .md en el diff'] }),
    ];
    const onFeedback = vi.fn();
    const watch = summarizeRun(events, (id) => id).supervisor!;
    const { rerender } = render(<SupervisorPanel watch={watch} alerts={supervisorAlerts(events, (id) => id)} onPick={vi.fn()} onFeedback={onFeedback} />);
    expect(screen.getByText('grave')).toBeTruthy();
    expect(within(screen.getByRole('list', { name: 'Evidencia' })).getByText('Sin docs — ningún .md en el diff')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'No era un problema' }));
    expect(onFeedback).toHaveBeenCalledWith(events[1]!.seq, 'false-alarm');
    const marked = [...events, ev({ type: 'supervisor.feedback', alertSeq: events[1]!.seq, verdict: 'false-alarm' })];
    rerender(<SupervisorPanel watch={watch} alerts={supervisorAlerts(marked, (id) => id)} onPick={vi.fn()} onFeedback={onFeedback} />);
    expect(document.querySelector('.orq-supalert')!.className).toContain('is-dismissed');
    expect(screen.getByRole('button', { name: 'No era un problema' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('[R75.22] la pestaña dice cuánto acierta cada regla, aquí y en las últimas 50', () => {
    const events = [ev({ type: 'supervisor.started', review: true })];
    const watch = summarizeRun(events, (id) => id).supervisor!;
    render(<SupervisorPanel watch={watch} alerts={[]} onPick={vi.fn()} stats={{ run: [{ rule: 'ai-review', alerts: 2, falseAlarms: 1, confirmed: 1 }], recent: [{ rule: 'ai-review', alerts: 9, falseAlarms: 3, confirmed: 4 }] }} />);
    const table = within(screen.getByRole('region', { name: 'Cuánto acierta el Supervisor' }));
    expect(table.getByText('2 · 1 falsos · 1 acertados')).toBeTruthy();
    expect(table.getByText('9 · 3 falsos · 4 acertados')).toBeTruthy();
  });

  it('[R75.10][R75.19][R75.20] Ajustes › Supervisor: cuándo para, modelo de la comprobación final y qué hacer si no se puede', async () => {
    const api = createMemoryApi();
    await api.saveSettings({ ...defaultSettings() });
    render(<SettingsDialog api={api} onSaved={() => undefined} />);
    const page = within(screen.getByRole('region', { name: 'Ajustes' }));
    await page.findByRole('heading', { name: 'Claude' });
    await userEvent.click(within(page.getByRole('navigation', { name: 'Ajustes' })).getByRole('button', { name: /^Supervisor/ }));
    expect((page.getByLabelText('Parar y preguntarme cuando el problema sea…') as HTMLSelectElement).value).toBe('high');
    expect((page.getByLabelText('Modelo de la comprobación final') as HTMLSelectElement).value).toBe('claude-sonnet-5-5');
    expect((page.getByLabelText('Si no se puede comprobar el resultado') as HTMLSelectElement).value).toBe('warn');
    await userEvent.selectOptions(page.getByLabelText('Parar y preguntarme cuando el problema sea…'), 'medium');
    for (let i = 0; i < 50; i++) {
      const s = await api.getSettings();
      if (s.ok && s.value.supervisorStopAt === 'medium') break;
      await new Promise((r) => setTimeout(r, 20));
    }
    const saved = await api.getSettings();
    expect(saved.ok && saved.value.supervisorStopAt).toBe('medium');
  });
});
