// @vitest-environment jsdom
import './setup';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { COORDINATOR_ID, MockAgent, MockDecider, Orchestrator, validateDiagram, type Diagram, type DiagramNode, type Edge, type RunEvent } from '@orquestador/core';
import { EditorSession, computeProblems, createDiagram, edgeTraversals, runTimeline, summarizeRun } from '@orquestador/editor';
import { buildFlowEdges, buildFlowNodes } from '../src/diagrams/Canvas';
import { EdgeInspector } from '../src/diagrams/EdgeInspector';
import { Inspector } from '../src/diagrams/Inspector';
import { runAssistantTool } from '../src/assistant/assistantTools';
import { SummaryBody } from '../src/runs/RunSummary';
import { App } from '../src/App';
import { createMemoryApi } from '../src/memoryApi';

const agent = (id: string, extra: Partial<DiagramNode> = {}): DiagramNode => ({ id, kind: 'agent', agentId: id, label: id, position: { x: 0, y: 0 }, ...extra });
const edge = (from: string, to: string): Edge => ({ id: `${from}->${to}`, from, to });
const ENTRY: DiagramNode = { id: 'entry', kind: 'entry', position: { x: 0, y: 0 } };
const OUTPUT: DiagramNode = { id: 'output', kind: 'output', position: { x: 600, y: 0 } };
const AGENTS = [{ id: 'o', name: 'o' }];
const COORDINATOR = { agentId: COORDINATOR_ID, label: 'Coordinador' };

const fan = (origin: Partial<DiagramNode> = {}, branches = ['a', 'b']): Diagram => ({
  id: 'd',
  name: 'd',
  schemaVersion: 1,
  nodes: [ENTRY, agent('o', origin), ...branches.map((b) => agent(b)), OUTPUT],
  edges: [edge('entry', 'o'), edge('o', 'output'), ...branches.flatMap((b) => [edge('o', b), edge(b, 'output')])],
});

function panel(d: Diagram) {
  const session = new EditorSession(d);
  render(<Inspector session={session} snap={session.getSnapshot()} selection={{ nodes: ['o'], edges: [] }} agents={AGENTS} onError={vi.fn()} />);
  return session;
}

describe('SPEC-059 · panel del paso', () => {
  it('[R59.12][R59.17] un paso normal no ofrece repartir, aunque tenga varias salidas', async () => {
    panel(fan());
    await userEvent.click(screen.getByRole('tab', { name: 'Agente' }));
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(screen.queryByText(/Repartir/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Cambiar el agente' })).toBeTruthy();
  });

  it('[R59.3] el error se lee en español', () => {
    expect(computeProblems(fan(COORDINATOR, ['a']), []).all.map((p) => p.message)).toEqual(['«Coordinador»: para repartir hacen falta al menos 2 ramas']);
  });
});

describe('SPEC-059 · el Coordinador', () => {
  it('[R59.19][R59.17] sale de la paleta como un paso que ya reparte', async () => {
    const api = createMemoryApi([createDiagram('principal', 'Principal')]);
    render(<App initialProject="Juego" api={api} agents={[]} confirm={() => true} />);
    await userEvent.click(await screen.findByRole('button', { name: '+ Coordinador' }));
    const card = await screen.findByLabelText(/^Agente «Coordinador»/);
    expect(within(card).getByText('reparte entre 0')).toBeTruthy();
  });

  it('[R59.19] en el panel no se cambia de agente y dice lo que hace', async () => {
    panel(fan(COORDINATOR));
    await userEvent.click(screen.getByRole('tab', { name: 'Agente' }));
    expect(screen.queryByRole('button', { name: 'Cambiar el agente' })).toBeNull();
    expect(screen.getByText('Divide el trabajo entre los pasos siguientes')).toBeTruthy();
  });

  it('[R59.19] no se cambia por otro agente, ni otro se convierte en él, pero se le enchufan skills', () => {
    const session = new EditorSession(fan(COORDINATOR));
    expect(() => session.updateNode('o', { agentId: 'otro' })).toThrow();
    expect(() => session.updateNode('a', { agentId: COORDINATOR_ID })).toThrow();
    session.updateNode('o', { extra: { skillIds: ['marca'] } });
    expect(session.getSnapshot().diagram.nodes.find((n) => n.id === 'o')!.extra).toEqual({ skillIds: ['marca'] });
  });
});

describe('SPEC-059 · lienzo', () => {
  const split = fan(COORDINATOR);

  it('[R59.13][R59.17] las conexiones de reparto van discontinuas; la de la salida y las demás, no', () => {
    const cls = (id: string) => buildFlowEdges(split, []).find((e) => e.id === id)!.className ?? '';
    expect(cls('o->a')).toContain('orq-edge--split');
    expect(cls('o->b')).toContain('orq-edge--split');
    expect(cls('o->output')).not.toContain('orq-edge--split');
    expect(cls('a->output')).not.toContain('orq-edge--split');
    expect(buildFlowEdges(fan(), []).some((e) => (e.className ?? '').includes('orq-edge--split'))).toBe(false);
  });

  it('[R59.13] la tarjeta dice entre cuántos reparte', () => {
    const sub = (d: Diagram) => buildFlowNodes(d, [], {}, undefined, { o: 'Origen', [COORDINATOR_ID]: 'Coordinador' }).find((n) => n.id === 'o')!.data['sub'];
    expect(sub(split)).toBe('reparte entre 2');
    expect(sub(fan())).toBe('Origen');
  });

  it('[R59.13] el asistente añade un Coordinador detrás de un paso y lo deja listo para conectar', async () => {
    const session = new EditorSession(fan({}, ['a']));
    const host = { session, api: {} } as unknown as Parameters<typeof runAssistantTool>[0];
    const r = await runAssistantTool(host, 'add_coordinator', { after: 'o', task: 'Divide por capas' });
    expect(r.ok).toBe(true);
    const id = (r.result as { nodeId: string }).nodeId;
    const added = session.getSnapshot().diagram.nodes.find((n) => n.id === id)!;
    expect(added).toMatchObject({ agentId: COORDINATOR_ID, label: 'Coordinador', task: 'Divide por capas' });
  });
});

describe('SPEC-059 · vista de una ejecución', () => {
  const OK = '## Común\n\nContrato\n\n## Para a\n\nArchivos: a.ts\nparte A\n\n## Para b\n\nArchivos: b.ts\nparte B';
  const run = async (output: string | (() => string)): Promise<readonly RunEvent[]> => {
    const agents = new MockAgent({ [COORDINATOR_ID]: { output } });
    const orch = new Orchestrator({ getAdapter: () => agents, decider: new MockDecider(), describeAgent: (id) => ({ name: id, model: 'x', version: 1, instructions: 'i', skillIds: [], contextIds: [], mcpServers: [] }) });
    const d: Diagram = { ...fan(COORDINATOR), edges: [edge('entry', 'o'), edge('o', 'a'), edge('o', 'b'), edge('a', 'output'), edge('b', 'output')] };
    return (await orch.start(d, 'Pedido').result).events;
  };
  const inspector = (events: readonly RunEvent[], from: string, to: string) =>
    render(<EdgeInspector traversals={edgeTraversals(events, edge(from, to))} fromName={from} toName={to} toIsAgent at={{ x: 0, y: 0 }} names={{}} onClose={vi.fn()} onOpenTarget={vi.fn()} />);

  it('[R59.7] la conexión enseña solo la parte que envió', async () => {
    const e = edgeTraversals(await run(OK), edge('o', 'b'))[0]!;
    expect(e.sent!.text).toContain('parte B');
    expect(e.sent!.text).not.toContain('parte A');
    expect(e.combined).toBe(false);
  });

  it('[R59.5] la regla se ve en la pestaña «Contexto» de la conexión que entra al origen', async () => {
    inspector(await run(OK), 'entry', 'o');
    const dialog = within(screen.getByRole('dialog'));
    await userEvent.click(dialog.getAllByRole('button', { name: 'Ampliar' })[0]!);
    await userEvent.click(dialog.getByRole('tab', { name: 'Contexto de «o»' }));
    expect(dialog.getByText('Regla de reparto')).toBeTruthy();
    expect(dialog.getByText(/se repartirá entre 2 pasos/)).toBeTruthy();
  });

  it('[R59.14] un reparto rechazado se ve en el cronograma y en el Resumen', async () => {
    let n = 0;
    const events = await run(() => (++n === 1 ? '## Para a\nArchivos: a.ts\nuno' : OK));
    const marks = runTimeline(events, Date.now(), { settled: true }).steps.find((s) => s.nodeId === 'o')!.marks;
    expect(marks.map((m) => m.text)).toContain('Reparto rechazado: Falta la sección «## Para b» o está vacía.');
    render(<SummaryBody summary={summarizeRun(events)} onPick={vi.fn()} />);
    expect(within(screen.getByRole('region', { name: 'Repartos rechazados' })).getByText(/Reparto rechazado: Falta la sección/)).toBeTruthy();
  });

  it('[R59.14] sin rechazos no ocupa sitio', async () => {
    render(<SummaryBody summary={summarizeRun(await run(OK))} onPick={vi.fn()} />);
    expect(screen.queryByRole('region', { name: 'Repartos rechazados' })).toBeNull();
  });

  it('[R59.3] sin ramas suficientes no se lanza', () => {
    expect(validateDiagram(fan(COORDINATOR, ['a'])).map((i) => i.code)).toEqual(['node-split-needs-two']);
  });
});
