// @vitest-environment jsdom
import './setup';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import type { Diagram, RunEvent } from '@orquestador/core';
import { deriveLive, runTimeline, summarizeRun, supervisorView, transcriptItems } from '@orquestador/editor';
import { buildFlowNodes } from '../src/diagrams/Canvas';
import { OrqNode } from '../src/diagrams/OrqNode';
import { SummaryBody } from '../src/runs/RunSummary';
import { SupervisorCard, SupervisorMemory, lineTo, supervisorAnchor, targetNode } from '../src/runs/SupervisorOverlay';
import { createMemoryApi } from '../src/memoryApi';

const D: Diagram = {
  id: 'd',
  name: 'd',
  schemaVersion: 1,
  nodes: [
    { id: 'entry', kind: 'entry', position: { x: 0, y: 0 } },
    { id: 'a', kind: 'agent', agentId: 'a', label: 'Pintor', position: { x: 200, y: 0 } },
    { id: 'output', kind: 'output', position: { x: 400, y: 0 } },
  ],
  edges: [
    { id: 'e1', from: 'entry', to: 'a' },
    { id: 'e2', from: 'a', to: 'output' },
  ],
};
let seq = 0;
const ev = (b: Record<string, unknown>) => ({ runId: 'r', seq: ++seq, ts: '2026-11-06T10:00:00.000Z', ...b }) as unknown as RunEvent;
const started = [ev({ type: 'run.started', diagramId: 'd' }), ev({ type: 'node.started', nodeId: 'a' })];
const alert = ev({ type: 'supervisor.alert', nodeId: 'a', rule: 'blocked', severity: 'warning', detail: 'src/api/x.ts: fuera de sus archivos' });
const note = ev({ type: 'supervisor.note', nodeId: 'a', text: 'Pintó el cielo', files: ['cielo.png'] });
const labels = (id: string) => (id === 'a' ? 'Pintor' : id);
const section = () => within(screen.getByRole('region', { name: 'Supervisor' }));

describe('SPEC-060 · avisos', () => {
  it('[R60.9] el nodo enseña cuántos avisos tiene y cuáles', () => {
    const nodes = buildFlowNodes(D, [], {}, deriveLive([...started, alert]));
    expect(nodes.find((n) => n.id === 'a')!.data['alerts']).toEqual(['src/api/x.ts: fuera de sus archivos']);
    const props = { id: 'a', type: 'orq', data: { kind: 'agent', label: 'Paso', problems: [], alerts: ['uno', 'dos'] } } as unknown as Parameters<typeof OrqNode>[0];
    render(
      <ReactFlowProvider>
        <OrqNode {...props} />
      </ReactFlowProvider>,
    );
    const mark = screen.getByText('2 avisos');
    expect(mark.getAttribute('title')).toBe('uno\ndos');
  });

  it('[R60.9] y sale en el cronograma', () => {
    const marks = runTimeline([...started, alert], Date.now(), { settled: true }).steps.find((s) => s.nodeId === 'a')!.marks;
    expect(marks.map((m) => m.text)).toContain('Supervisor: src/api/x.ts: fuera de sus archivos');
  });
});

describe('SPEC-060 · el Resumen', () => {
  it('[R60.10] tiene su sección con cada aviso, su paso y la memoria', () => {
    render(<SummaryBody summary={summarizeRun([...started, alert, note], labels)} onPick={vi.fn()} />);
    const s = section();
    expect(s.getByRole('button', { name: /src\/api\/x\.ts: fuera de sus archivos/ }).textContent).toContain('Pintor');
    // Cada entrada es una tarjeta con su texto y sus ficheros [R69.5].
    expect(s.getByText(/Pintó el cielo/).closest('.orq-memcard')!.textContent).toContain('cielo.png');
    expect(s.getByRole('heading', { name: 'Memoria de la ejecución' })).toBeTruthy();
  });

  it('[R60.10] sin avisos dice que no encontró problemas', () => {
    render(<SummaryBody summary={summarizeRun([...started, note], labels)} onPick={vi.fn()} />);
    expect(section().getByText('No encontró problemas.')).toBeTruthy();
  });

  it('[R60.10] dice lo que no pudo revisar', () => {
    render(<SummaryBody summary={summarizeRun([...started, note, ev({ type: 'supervisor.skipped', count: 2, reason: 'timeout' })], labels)} onPick={vi.fn()} />);
    expect(section().getByText('2 revisiones no llegaron a tiempo.')).toBeTruthy();
  });

  it('[R60.10] sin Supervisor no ocupa sitio', () => {
    render(<SummaryBody summary={summarizeRun(started, labels)} onPick={vi.fn()} />);
    expect(screen.queryByRole('region', { name: 'Supervisor' })).toBeNull();
  });
});

const start = ev({ type: 'supervisor.started', review: true, model: 'claude-haiku-5-5' });
const reviewing = ev({ type: 'supervisor.reviewing', nodeId: 'a' });
const reviewed = ev({ type: 'supervisor.note', nodeId: 'a', text: 'Pintó el cielo', files: [], reviewed: true });
const spent = ev({ type: 'agent.usage', nodeId: 'a', inputTokens: 10, outputTokens: 1, costUsd: 0.002, source: 'supervisor' });
const branch = ev({ type: 'git.branch', nodeId: 'a', branch: 'feature/login', via: 'command', created: true });
const view = (events: RunEvent[], running = true) => supervisorView(events, running, labels)!;

describe('SPEC-060 · lo que se ve de la ejecución', () => {
  it('[R60.31] sin Supervisor no hay nada que enseñar', () => {
    expect(supervisorView(started, true, labels)).toBeUndefined();
  });

  it('[R60.31] da el estado de cada momento', () => {
    expect(view([start]).status).toBe('watching');
    expect(view([start, reviewing])).toMatchObject({ status: 'reviewing', reviewing: ['Pintor'], targets: [{ key: 'a', warn: false }] });
    expect(view([start, reviewing, reviewed, spent])).toMatchObject({ status: 'watching', reviewed: 1, costUsd: 0.002, targets: [] });
    expect(view([ev({ type: 'supervisor.started', review: false })]).status).toBe('rules');
    expect(view([start, ev({ type: 'supervisor.skipped', count: 1, reason: 'failed' })]).status).toBe('rules');
    expect(view([start, reviewing], false)).toMatchObject({ status: 'done', targets: [] });
  });

  it('[R60.31] solo su gasto cuenta como suyo, y lleva la rama y la memoria', () => {
    const v = view([start, ev({ type: 'agent.usage', nodeId: 'a', inputTokens: 1, outputTokens: 1, costUsd: 5 }), spent, branch, reviewed]);
    expect(v).toMatchObject({ costUsd: 0.002, branch: 'feature/login (creada por Pintor)', memory: [{ label: 'Pintor', text: 'Pintó el cielo' }] });
  });

  it('[R69.3] con varios agentes a la vez señala a todos y los nombra', () => {
    const on = (nodeId: string) => ev({ type: 'supervisor.reviewing', nodeId });
    const two = view([start, on('a'), on('b')]);
    expect(two.targets.map((x) => x.key)).toEqual(['a', 'b']);
    render(<SupervisorCard view={two} />);
    expect(screen.getByRole('button', { name: /Supervisor/ }).textContent).toContain('Revisando «Pintor» y «b»');
  });

  it('[R69.3] si son más de dos, los cuenta', () => {
    const on = (nodeId: string) => ev({ type: 'supervisor.reviewing', nodeId });
    render(<SupervisorCard view={view([start, on('a'), on('b'), on('c')])} />);
    expect(screen.getByRole('button', { name: /Supervisor/ }).textContent).toContain('Revisando 3 pasos a la vez');
  });

  it('[R69.3] uno que termina no apaga a los demás, y un paso sigue hasta que acaben las suyas', () => {
    const on = (nodeId: string) => ev({ type: 'supervisor.reviewing', nodeId });
    const off = (nodeId: string) => ev({ type: 'supervisor.note', nodeId, text: '', files: [], reviewed: true });
    expect(view([start, on('a'), on('b'), off('a')]).reviewing).toEqual(['b']);
    expect(view([start, on('a'), on('a'), off('a')]).reviewing).toEqual(['Pintor']);
    expect(view([start, on('a'), on('a'), off('a'), off('a')]).status).toBe('watching');
  });

  it('[R69.3] sin revisiones en marcha no señala a nadie, y mientras revisa un paso con aviso va en amarillo', () => {
    expect(view([start, alert])).toMatchObject({ status: 'alert', lastAlert: 'src/api/x.ts: fuera de sus archivos', targets: [] });
    expect(view([start, alert, reviewing]).targets).toEqual([{ key: 'a', warn: true }]);
  });

  it('[R69.3] un paso de un subdiagrama se señala en su nodo visible', () => {
    expect(targetNode('sub/a', [])).toBe('sub');
    expect(targetNode('sub/a', ['sub'])).toBe('a');
    expect(targetNode('otro/a', ['sub'])).toBeUndefined();
    expect(targetNode('a', ['sub'])).toBeUndefined();
  });

  it('[R69.3] la tarjeta va centrada sobre los pasos, por encima del más alto, y sus líneas llegan a lo alto del paso', () => {
    const rects = [
      { x: 0, y: 300, width: 200, height: 80 },
      { x: 600, y: 200, width: 200, height: 80 },
    ];
    expect(supervisorAnchor(rects)).toEqual({ x: 400, y: 80 });
    expect(supervisorAnchor([])).toEqual({ x: 0, y: 0 });
    const d = lineTo({ x: 400, y: 80 }, rects[0]!);
    expect(d.startsWith('M400 80')).toBe(true);
    expect(d.endsWith('100 294')).toBe(true);
  });

  it('[R69.3] la tarjeta dice qué hace, cuánto lleva y en qué rama, y al pulsarla abre su pestaña', () => {
    const open = vi.fn();
    render(<SupervisorCard view={view([start, spent, branch, reviewing])} onOpen={open} />);
    const card = screen.getByRole('button', { name: /Supervisor/ });
    expect(card.textContent).toContain('Revisando «Pintor»');
    expect(card.textContent).toContain('Haiku 5.5');
    expect(card.textContent).toContain('feature/login');
    fireEvent.click(card);
    expect(open).toHaveBeenCalled();
  });

  it('[R69.4] la tarjeta enseña la rama y las dos últimas entradas de la memoria, se pliega y «Ver las N entradas» pide la pestaña', () => {
    // Un paso sale una sola vez en la memoria [R72.17]: cada nota es de un paso distinto.
    const second = ev({ type: 'supervisor.note', nodeId: 'b', text: 'Luego el mar', files: [] });
    const third = ev({ type: 'supervisor.note', nodeId: 'c', text: 'Y las nubes', files: ['cielo.png', 'mar.png', 'nubes.png'] });
    const onAll = vi.fn();
    render(<SupervisorMemory view={view([start, branch, reviewed, second, third])} onAll={onAll} />);
    const panel = within(screen.getByRole('region', { name: 'Memoria de la ejecución' }));
    expect(panel.getByText(/feature\/login/)).toBeTruthy();
    expect(panel.getAllByRole('listitem').map((li) => li.querySelector('.orq-memcard__text')!.textContent)).toEqual(['Y las nubes', 'Luego el mar']);
    expect(panel.getByText('+1')).toBeTruthy();
    fireEvent.click(panel.getByRole('button', { name: 'Ver las 3 entradas' }));
    expect(onAll).toHaveBeenCalled();
    fireEvent.click(panel.getByRole('button', { name: 'Plegar la memoria' }));
    expect(panel.queryByRole('listitem')).toBeNull();
  });

  it('[R60.39] el Resumen da el balance y la rama', () => {
    render(<SummaryBody summary={summarizeRun([...started, start, spent, branch, reviewed], labels)} onPick={vi.fn()} />);
    expect(section().getByText(/1 paso revisado/).textContent).toContain('Haiku 5.5');
    expect(section().getByText('feature/login (creada por Pintor)')).toBeTruthy();
  });

  it('[R60.37] cada paso guarda la memoria que recibió', () => {
    const request = ev({ type: 'agent.request', nodeId: 'a', agentId: 'a', attempt: 1, input: { text: 'x', files: [] }, memory: 'Rama de git: main' });
    expect(transcriptItems([request], 'a', [])[0]).toMatchObject({ kind: 'input', memory: 'Rama de git: main' });
  });

  it('[R60.30] su gasto no se suma al del paso', () => {
    const items = transcriptItems([ev({ type: 'node.started', nodeId: 'a' }), spent], 'a', []);
    expect(items.some((i) => i.kind === 'usage')).toBe(false);
  });
});

describe('SPEC-060 · es interno', () => {
  it('[R60.11] no aparece en Agentes', async () => {
    const r = await createMemoryApi().listAgents();
    expect(r.ok && r.value.some((a) => /supervisor/i.test(`${a.id} ${a.name}`))).toBe(false);
  });
});
