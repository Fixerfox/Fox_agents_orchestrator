// @vitest-environment jsdom
import './setup';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReactFlowProvider } from '@xyflow/react';
import { CONFLICT_PREVIEW_KEY, defaultSettings, isolatesBranches, normalizeSettings, validateSettings, type Diagram, type RunEvent } from '@orquestador/core';
import { EditorSession, computeProblems, deriveLive, transcriptItems } from '@orquestador/editor';
import { buildFlowNodes } from '../src/diagrams/Canvas';
import { OrqNode } from '../src/diagrams/OrqNode';
import { Question } from '../src/runs/NodePanel';
import { SettingsDialog } from '../src/settings/SettingsDialog';
import { createMemoryApi } from '../src/memoryApi';

const D: Diagram = {
  id: 'd',
  name: 'D',
  schemaVersion: 1,
  nodes: [
    { id: 'entry', kind: 'entry', position: { x: 0, y: 0 } },
    { id: 'a', kind: 'agent', agentId: 'a', label: 'Web', position: { x: 300, y: 0 } },
    { id: 'b', kind: 'agent', agentId: 'b', label: 'Api', position: { x: 300, y: 200 } },
    { id: 'j', kind: 'agent', agentId: 'j', label: 'Junta', position: { x: 600, y: 0 } },
    { id: 'output', kind: 'output', position: { x: 900, y: 0 } },
  ],
  edges: [
    { id: 'e1', from: 'entry', to: 'a' },
    { id: 'e2', from: 'entry', to: 'b' },
    { id: 'e3', from: 'a', to: 'j' },
    { id: 'e4', from: 'b', to: 'j' },
    { id: 'e5', from: 'j', to: 'output' },
  ],
};
let seq = 0;
const ev = (body: Record<string, unknown>) => ({ runId: 'r', seq: ++seq, ts: '2026-11-08T10:00:00.000Z', ...body }) as unknown as RunEvent;
const opened = [ev({ type: 'workspace.opened', regionId: 'entry', branchNodeIds: ['a'], strategy: 'git' }), ev({ type: 'workspace.opened', regionId: 'entry', branchNodeIds: ['b'], strategy: 'git' })];

describe('SPEC-073 · ramas aisladas en la interfaz', () => {
  it('[R73.20] las ramas llevan «aislada» y lo que las junta, «fusionada» o «conflicto»', () => {
    const merged = [...opened, ev({ type: 'workspace.merged', nodeId: 'j', regionId: 'entry', branchNodeIds: ['a'], files: ['web.ts'] })];
    const nodes = buildFlowNodes(D, [], {}, deriveLive(merged));
    expect(nodes.find((n) => n.id === 'a')!.data['isolation']).toBe('isolated');
    expect(nodes.find((n) => n.id === 'b')!.data['isolation']).toBe('isolated');
    expect(nodes.find((n) => n.id === 'j')!.data['isolation']).toBe('merged');
    const conflict = [...merged, ev({ type: 'workspace.conflict', nodeIds: ['j'], files: ['x.json'], regionId: 'entry' })];
    expect(deriveLive(conflict).isolation['j']).toBe('conflict');
    expect(deriveLive([...conflict, ev({ type: 'workspace.resolved', regionId: 'entry', nodeIds: ['j'], files: ['x.json'], choice: 'target' })]).isolation['j']).toBe('merged');
    const props = { id: 'j', type: 'orq', data: { kind: 'agent', label: 'Junta', problems: [], isolation: 'conflict' } } as unknown as Parameters<typeof OrqNode>[0];
    const { container } = render(
      <ReactFlowProvider>
        <OrqNode {...props} />
      </ReactFlowProvider>,
    );
    expect(container.querySelector('.orq-node__iso.is-conflict')!.textContent).toBe('conflicto');
  });

  it('[R73.21] con el aislamiento apagado, el abanico avisa de que sus ramas comparten carpeta', () => {
    expect(computeProblems(D, []).all.some((p) => p.code === 'shared-fan')).toBe(false);
    const p = computeProblems(D, [], { sharedFans: true });
    expect(p.all).toEqual([expect.objectContaining({ code: 'shared-fan', nodeId: 'entry', severity: 'warning', message: '«entry»: estas ramas comparten carpeta: si tocan los mismos archivos, se pisan' })]);
    expect(p.runnable).toBe(true);
    const s = new EditorSession(D);
    s.setSharedFans(true);
    expect(s.getSnapshot().problems.byNode['entry']).toEqual(['«entry»: estas ramas comparten carpeta: si tocan los mismos archivos, se pisan']);
  });

  it('[R73.14][R73.16] la pregunta de conflicto enseña los archivos, deja ver las dos versiones y ofrece qué hacer', async () => {
    const q = ev({ type: 'agent.question', nodeId: 'j', questionId: 'q1', kind: 'conflict', text: 'x', options: ['Quedarme con la de Web', 'Quedarme con la de Api', 'Que lo junte un agente', 'Parar la ejecución'], conflict: { files: ['config.json'], savedTo: 'Api', branches: ['Web', 'Api'] } });
    const item = transcriptItems([q], 'j').find((i) => i.kind === 'question')!;
    const onPreview = vi.fn();
    const onAnswer = vi.fn();
    render(<Question item={item as never} onAnswer={onAnswer} onPreview={onPreview} />);
    expect(screen.getByText('Conflicto al juntar las ramas')).toBeTruthy();
    expect(screen.getByText('config.json')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Ver la de Web' }));
    await userEvent.click(screen.getByRole('button', { name: 'Ver la de Api' }));
    expect(onPreview.mock.calls).toEqual([
      [CONFLICT_PREVIEW_KEY, 'Api/destino/config.json'],
      [CONFLICT_PREVIEW_KEY, 'Api/rama/config.json'],
    ]);
    await userEvent.click(screen.getByRole('button', { name: 'Que lo junte un agente' }));
    expect(onAnswer).toHaveBeenCalledWith('q1', 'Que lo junte un agente');
  });

  it('[R73.2] «Aislar las ramas en paralelo» está en Ajustes › Ejecución, activo por defecto, y se guarda', async () => {
    expect(isolatesBranches(defaultSettings())).toBe(true);
    expect(validateSettings({ ...defaultSettings(), isolateBranches: 'sí' as never }).map((p) => p.field)).toContain('isolateBranches');
    expect(normalizeSettings({ ...defaultSettings(), isolateBranches: false }).isolateBranches).toBe(false);
    const api = createMemoryApi();
    render(<SettingsDialog api={api} onSaved={() => undefined} />);
    const page = within(screen.getByRole('region', { name: 'Ajustes' }));
    await page.findByRole('heading', { name: 'Claude' });
    await userEvent.click(within(page.getByRole('navigation', { name: 'Ajustes' })).getByRole('button', { name: /^Ejecución y presupuesto/ }));
    const toggle = page.getByLabelText('Aislar las ramas en paralelo') as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    await userEvent.click(toggle);
    for (let i = 0; i < 50; i++) {
      const s = await api.getSettings();
      if (s.ok && s.value.isolateBranches === false) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    const saved = await api.getSettings();
    expect(saved.ok && saved.value.isolateBranches).toBe(false);
  });
});
