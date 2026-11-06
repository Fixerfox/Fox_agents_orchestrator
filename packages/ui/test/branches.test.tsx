// @vitest-environment jsdom
import './setup';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import type { Diagram, RunEvent } from '@orquestador/core';
import { deriveLive, summarizeRun } from '@orquestador/editor';
import { BranchNode, branchFlowNodes, withoutBranchBoxes, type BranchFlowNode } from '../src/diagrams/BranchNode';
import { buildFlowNodes } from '../src/diagrams/Canvas';
import { OrqNode } from '../src/diagrams/OrqNode';
import { RunDoneBanner } from '../src/runs/RunDoneBanner';
import { SummaryBody } from '../src/runs/RunSummary';

const D: Diagram = {
  id: 'd',
  name: 'D',
  schemaVersion: 1,
  nodes: [
    { id: 'entry', kind: 'entry', position: { x: 0, y: 0 } },
    { id: 'a', kind: 'agent', agentId: 'a', label: 'Especificador', position: { x: 300, y: 0 }, extra: { mcpIds: ['github'] } },
    { id: 'b', kind: 'agent', agentId: 'b', label: 'Planificador', position: { x: 600, y: 0 } },
    { id: 'c', kind: 'agent', agentId: 'c', label: 'Implementador', position: { x: 900, y: 0 } },
    { id: 'output', kind: 'output', position: { x: 1200, y: 0 } },
  ],
  edges: [
    { id: 'e1', from: 'entry', to: 'a' },
    { id: 'e2', from: 'a', to: 'b' },
    { id: 'e3', from: 'b', to: 'c' },
    { id: 'e4', from: 'c', to: 'output' },
  ],
};
let seq = 0;
const ev = (body: Record<string, unknown>) => ({ runId: 'r', seq: ++seq, ts: '2026-11-06T10:00:00.000Z', ...body }) as unknown as RunEvent;
const EVENTS = [
  ev({ type: 'run.started', diagramId: 'd' }),
  ev({ type: 'git.branch', nodeId: 'a', branch: 'feature/x', via: 'head', created: true }),
  ev({ type: 'git.branch', nodeId: 'b', branch: 'feature/x', via: 'ran' }),
  ev({ type: 'git.branch', nodeId: 'c', branch: 'otra', via: 'command' }),
  ev({ type: 'git.branch', nodeId: 'c', branch: 'feature/y', via: 'command' }),
];

describe('SPEC-058 · la rama en el nodo', () => {
  it('[R58.7] el nodo no lleva la rama: la dice el recuadro', () => {
    const nodes = buildFlowNodes(D, [], {}, deriveLive(EVENTS));
    expect(nodes.every((n) => !('branches' in n.data))).toBe(true);
    expect(branchFlowNodes(D, [], nodes, deriveLive(EVENTS).branches).map((b) => b.data.branch)).toEqual(['feature/x', 'feature/y']);
  });
});

describe('SPEC-058 · lo que hizo el paso', () => {
  const events = [...EVENTS, ev({ type: 'git.action', nodeId: 'a', branch: 'feature/x', action: 'commit' }), ev({ type: 'git.action', nodeId: 'a', branch: 'feature/x', action: 'push' }), ev({ type: 'git.action', nodeId: 'c', branch: 'otra', action: 'delete' })];

  it('[R58.12] el nodo enseña commit, push y rama borrada', () => {
    const nodes = buildFlowNodes(D, [], {}, deriveLive(events));
    expect(nodes.find((n) => n.id === 'a')!.data['gitActions']).toEqual(['commit', 'push']);
    expect(nodes.find((n) => n.id === 'b')!.data['gitActions']).toBeUndefined();
    const props = { id: 'a', type: 'orq', data: { kind: 'agent', label: 'Paso', problems: [], gitActions: ['commit', 'delete', 'switch'] } } as unknown as Parameters<typeof OrqNode>[0];
    const { container } = render(
      <ReactFlowProvider>
        <OrqNode {...props} />
      </ReactFlowProvider>,
    );
    expect(container.querySelector('.orq-node__git')!.textContent).toBe('commitrama borradacambio de rama');
  });

  it('[R58.15] el enlace de la PR sale en el nodo, el aviso y el resumen, y se abre fuera', () => {
    const url = 'https://github.com/o/r/pull/12';
    const withPr = [...events, ev({ type: 'git.action', nodeId: 'a', branch: 'feature/x', action: 'pr', url })];
    expect(buildFlowNodes(D, [], {}, deriveLive(withPr)).find((n) => n.id === 'a')!.data['prUrl']).toBe(url);
    const props = { id: 'a', type: 'orq', data: { kind: 'agent', label: 'Paso', problems: [], gitActions: ['pr'], prUrl: url } } as unknown as Parameters<typeof OrqNode>[0];
    render(
      <ReactFlowProvider>
        <OrqNode {...props} />
      </ReactFlowProvider>,
    );
    render(<SummaryBody summary={summarizeRun(withPr, (id) => id)} onPick={vi.fn()} />);
    render(<RunDoneBanner events={withPr} labelOf={(id: string) => id} onSummary={vi.fn()} />);
    const links = screen.getAllByRole('link', { name: 'Abrir PR #12' });
    expect(links).toHaveLength(3);
    for (const a of links) {
      expect(a.getAttribute('href')).toBe(url);
      expect(a.getAttribute('target')).toBe('_blank');
    }
  });

  it('[R58.13] el resumen lo pone junto a cada paso y marca la rama borrada', () => {
    render(<SummaryBody summary={summarizeRun(events, (id) => id.toUpperCase())} onPick={vi.fn()} />);
    const rows = within(screen.getByRole('region', { name: 'Ramas' })).getAllByRole('listitem');
    expect(rows[0]!.textContent).toContain('A (commit, push) · B');
    expect(rows[1]!.textContent).toContain('borrada');
    expect(rows[1]!.textContent).toContain('C (rama borrada)');
  });
});

describe('SPEC-058 · el recuadro', () => {
  const live = deriveLive(EVENTS);
  const nodes = buildFlowNodes(D, [], {}, live);

  it('[R58.8] rodea los pasos de la rama, con sus enchufes, y va detrás sin ratón', () => {
    const [x, y] = branchFlowNodes(D, [], nodes, live.branches);
    expect(x).toMatchObject({ type: 'branch', data: { branch: 'feature/x' }, zIndex: -1, selectable: false, draggable: false, focusable: false, style: { pointerEvents: 'none' } });
    expect(y!.data.branch).toBe('feature/y');
    expect(x!.position.x).toBeLessThan(300);
    // El enchufe github cuelga 168 px bajo el paso.
    expect(x!.position.y + (x!.height ?? 0)).toBeGreaterThan(168 + 28);
    expect(x!.position.x + (x!.width ?? 0)).toBeGreaterThan(600 + 224);
    expect(x!.position.x + (x!.width ?? 0)).toBeLessThan(900);
  });

  it('[R58.8] deja sitio a las fichas de archivos y usa la altura medida', () => {
    const level = { nodes: [{ id: 'b' }], edges: [] };
    const placed = (extra: object) => [{ id: 'b', position: { x: 0, y: 0 }, data: {}, ...extra }];
    const height = (extra: object) => branchFlowNodes(level, [], placed(extra), { b: ['x'] })[0]!.height!;
    expect(height({ data: { files: [{}] } })).toBeGreaterThan(height({}));
    expect(height({ measured: { width: 224, height: 200 } })).toBeGreaterThan(height({}));
  });

  it('[R58.8] enseña el nombre de la rama', () => {
    render(<BranchNode {...({ data: { branch: 'feature/x' } } as unknown as Parameters<typeof BranchNode>[0])} />);
    expect(screen.getByRole('group', { name: 'Rama feature/x' }).textContent).toBe('feature/x');
  });

  it('[R58.8] las medidas del recuadro no vuelven al lienzo, que entraría en bucle', () => {
    const changes = [
      { id: 'branch:feature/x:0', type: 'dimensions' },
      { id: 'a', type: 'dimensions' },
      { type: 'add' },
    ];
    expect(withoutBranchBoxes(changes)).toEqual([changes[1], changes[2]]);
  });

  it('[R58.8] sin ramas no hay recuadros', () => {
    expect(branchFlowNodes(D, [], buildFlowNodes(D, [], {}), {})).toEqual([] as BranchFlowNode[]);
  });
});

describe('SPEC-058 · el resumen', () => {
  const labels: Record<string, string> = { a: 'Especificador', b: 'Planificador', c: 'Implementador' };

  it('[R58.10] destaca las ramas, si son nuevas y qué pasos actuaron', () => {
    render(<SummaryBody summary={summarizeRun(EVENTS, (id) => labels[id] ?? id)} onPick={vi.fn()} />);
    const box = screen.getByRole('region', { name: 'Ramas' });
    const rows = within(box).getAllByRole('listitem');
    expect(rows[0]!.textContent).toContain('feature/x');
    expect(rows[0]!.textContent).toContain('nueva');
    expect(rows[0]!.textContent).toContain('Especificador · Planificador');
    expect(rows[1]!.textContent).toContain('otra');
    expect(rows[1]!.textContent).not.toContain('nueva');
  });

  it('[R58.10] sin ramas no ocupa sitio', () => {
    render(<SummaryBody summary={summarizeRun([], (id) => id)} onPick={vi.fn()} />);
    expect(screen.queryByRole('region', { name: 'Ramas' })).toBeNull();
  });
});
