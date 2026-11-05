// @vitest-environment jsdom
import './setup';
import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { newAgent, newSkill, type AgentDefinition, type Diagram, type RunEvent } from '@orquestador/core';
import { ASSISTANT_TOOLS, createDiagram, t, type RunSummary } from '@orquestador/editor';
import { isDestructive, runAssistantTool, type AssistantHost } from '../src/assistantTools';
import { createMemoryApi } from '../src/memoryApi';
import { App } from '../src/App';
import { goLib } from './nav';

const D: Diagram = {
  id: 'd',
  name: 'D',
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
const ev = (seq: number, body: Record<string, unknown>) => ({ runId: 'old', seq, ts: '2026-11-05T10:00:00.000Z', ...body }) as unknown as RunEvent;
const OLD: { summary: RunSummary; events: RunEvent[] } = {
  summary: { runId: 'old', diagramId: 'd', status: 'failed', startedAt: '2026-11-05T10:00:00.000Z', usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 }, eventCount: 3, order: 'hola' },
  events: [ev(1, { type: 'run.started', diagramId: 'd' }), ev(2, { type: 'node.started', nodeId: 'entry', input: { text: 'hola', files: [] } }), ev(3, { type: 'run.finished', status: 'failed' })],
};

describe('SPEC-041 · el asistente [R41.6]', () => {
  it('[R41.6] resume_run pide permiso; list_runs y get_run dicen si se puede reanudar; reanudar devuelve la nueva', async () => {
    expect(ASSISTANT_TOOLS.find((x) => x.name === 'resume_run')).toBeTruthy();
    expect(isDestructive('resume_run')).toBe(true);
    const api = createMemoryApi([D], { pastRuns: [OLD] });
    const host = { api, refresh: () => {} } as unknown as AssistantHost;
    const list = await runAssistantTool(host, 'list_runs', {});
    expect((list.result as { runId: string; canResume: boolean }[]).find((r) => r.runId === 'old')).toMatchObject({ canResume: true });
    const got = await runAssistantTool(host, 'get_run', { runId: 'old' });
    expect(got.result).toMatchObject({ canResume: true });
    const res = await runAssistantTool(host, 'resume_run', { runId: 'old' });
    expect(res.ok).toBe(true);
    const again = await runAssistantTool(host, 'list_runs', {});
    expect((again.result as { runId: string; canResume: boolean; resumedBy?: string }[]).find((r) => r.runId === 'old')).toMatchObject({ canResume: false, resumedBy: expect.any(String) });
    expect(t('as.ask.resume', { id: 'old' })).toContain('old');
  });
});

const saveBtn = () => screen.getAllByRole('button', { name: 'Guardar' }).find((b) => b.classList.contains('orq-btn--primary'))!;

describe('SPEC-039 · «Obligatoria» en la ficha del agente [R39.13]', () => {
  it('[R39.13] cada skill asignada tiene «Obligatoria»; activarla la guarda y quitar la skill la quita de lo obligatorio', async () => {
    const agent: AgentDefinition = { ...newAgent('imp', 'Implementador'), skillIds: ['impl'] };
    const api = createMemoryApi([createDiagram('principal', 'Principal')], { agents: [agent], skills: [{ ...newSkill('impl', 'Implementar'), body: 'x' }] });
    render(<App api={api} confirm={() => true} />);
    await userEvent.click(screen.getByRole('button', { name: 'Crear proyecto' }));
    const lib = await goLib('agents');
    await userEvent.click((await lib.findAllByRole('button', { name: /Implementador/ }))[0]!);
    await userEvent.click(lib.getByRole('button', { name: /^Qué sabe/ }));
    const toggle = await screen.findByRole('button', { name: t('assign.required', { name: 'Implementar' }) });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    await userEvent.click(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    await userEvent.click(saveBtn());
    await waitFor(() => expect(api.agents.get('imp')?.required).toEqual({ skillIds: ['impl'] }));
    await userEvent.click(screen.getByRole('button', { name: 'Quitar Implementar' }));
    await userEvent.click(saveBtn());
    await waitFor(() => expect(api.agents.get('imp')?.skillIds).toEqual([]));
    expect(api.agents.get('imp')?.required?.skillIds ?? []).toEqual([]);
  });
});
