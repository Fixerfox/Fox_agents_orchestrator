// @vitest-environment jsdom
import './setup';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Diagram, RunEvent } from '@orquestador/core';
import { addNode, connect, createDiagram, deriveLive, disconnect, updateNode } from '@orquestador/editor';
import { App } from '../src/App';
import { buildFlowEdges, buildFlowNodes } from '../src/Canvas';
import { InsertPicker } from '../src/InsertPicker';
import { ResultsPanel } from '../src/ResultsPanel';
import { createMemoryApi } from '../src/memoryApi';

const AGENTS = [
  { id: 'disenador', name: 'disenador', description: 'Diseña' },
  { id: 'qa', name: 'qa-disenador', description: 'Revisa' },
];

/** Entrada → disenador → qa → Revisión; ✓ y ⏱ a Salida, ✗ vuelve a disenador. */
function qaDiagram(): Diagram {
  let d = disconnect(createDiagram('principal', 'Principal'), [], 'entry->output');
  const a = addNode(d, [], { kind: 'agent', agentId: 'disenador', label: 'disenador', position: { x: 200, y: 120 } });
  const q = addNode(a.diagram, [], { kind: 'agent', agentId: 'qa', label: 'qa-disenador', position: { x: 480, y: 120 } });
  const r = addNode(q.diagram, [], { kind: 'review', position: { x: 760, y: 120 } });
  d = r.diagram;
  d = connect(d, [], 'entry', a.id).diagram;
  d = connect(d, [], a.id, q.id).diagram;
  d = connect(d, [], q.id, r.id).diagram;
  d = connect(d, [], r.id, 'output', 'approved').diagram;
  d = connect(d, [], r.id, a.id, 'rejected').diagram;
  d = connect(d, [], r.id, 'output', 'exhausted').diagram;
  d = updateNode(d, [], 'output', {});
  return { ...d, nodes: d.nodes.map((n) => (n.id === 'output' ? { ...n, position: { x: 1040, y: 120 } } : n)) };
}

async function mount(d?: Diagram) {
  const api = createMemoryApi([d ?? createDiagram('principal', 'Principal')]);
  render(<App initialProject="Juego" api={api} agents={AGENTS} confirm={() => true} />);
  if (d) {
    // Abre el proyecto para cargar el diagrama guardado.
    await userEvent.click(screen.getByRole('button', { name: /^Proyecto «/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Abrir proyecto' }));
    await screen.findByRole('button', { name: 'Diagrama «Principal»' });
  }
  return api;
}

describe('SPEC-034 · revisión en el lienzo', () => {
  it('[R34.22][R34.20] la paleta añade una Revisión con sus tres salidas, cada una con símbolo, texto y nombre accesible', async () => {
    await mount();
    await userEvent.click(await screen.findByRole('button', { name: '+ Revisión' }));
    const card = await screen.findByLabelText(/^Revisión «Revisión»/);
    for (const [mark, label] of [['✓', 'Aprobado'], ['✗', 'Rechazado'], ['⏱', 'Agotado']]) {
      expect(within(card).getByText(`${mark} ${label}`)).toBeTruthy();
      expect(card.querySelector(`[data-handleid="${label === 'Aprobado' ? 'approved' : label === 'Rechazado' ? 'rejected' : 'exhausted'}"]`)?.getAttribute('aria-label')).toBe(`Salida «${label}» de «Revisión»`);
    }
    expect(within(card).getByText('lee el veredicto')).toBeTruthy();
    expect(within(card).getByText('máx. 3 vueltas')).toBeTruthy();
  });

  it('[R34.22] el «+» de una conexión y el menú del lienzo ofrecen la Revisión', async () => {
    const picks: unknown[] = [];
    render(<InsertPicker agents={[]} at={{ x: 10, y: 10 }} onPick={(c) => picks.push(c)} onClose={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: /Revisión · aprueba o vuelve atrás/ }));
    expect(picks).toEqual([{ kind: 'review' }]);
  });

  it('[R34.21] el retorno va discontinuo, con «↺ máx. N», sin «+»; las salidas llevan su clase y su puerto', async () => {
    const d = qaDiagram();
    const edges = buildFlowEdges(d, [], undefined, () => {});
    const back = edges.find((e) => e.id === 'review-1.rejected->agent-1')!;
    expect(back).toMatchObject({ type: 'orqReturn', sourceHandle: 'rejected', label: '↺ máx. 3', className: 'orq-edge--rejected orq-edge--return' });
    expect(edges.find((e) => e.id === 'review-1.approved->output')).toMatchObject({ type: 'orq', sourceHandle: 'approved', className: 'orq-edge--approved' });
    expect(edges.find((e) => e.id === 'review-1.exhausted->output')!.className).toBe('orq-edge--exhausted');
    expect(edges.find((e) => e.id === 'entry->agent-1')!.className).toBeUndefined();
    await mount(d);
    await screen.findByLabelText(/^Revisión «Revisión»/);
    await waitFor(() => expect(document.querySelector('.orq-edge--return')).not.toBeNull());
    expect(screen.getByText('↺ máx. 3')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Insertar un paso entre «Revisión.*» y «disenador»/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Insertar un paso entre «Revisión · Aprobado» y «Salida»' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Insertar un paso entre «Revisión · Agotado» y «Salida»' })).toBeTruthy();
    // Ni el destino del retorno ni Salida (✓ y ⏱ se excluyen) «esperan a 2».
    expect(screen.queryByText(/^Espera a/)).toBeNull();
    // El diagrama es ejecutable: sin problemas.
    expect(screen.queryByRole('button', { name: /aviso|error/ })).toBeNull();
  });

  it('[R34.23] el inspector cambia vueltas, modo y criterio, y explica qué escribir y qué verá Claude', async () => {
    await mount(qaDiagram());
    fireEvent.click(await screen.findByLabelText(/^Revisión «Revisión»/));
    const max = (await screen.findByLabelText('Vueltas como máximo')) as HTMLInputElement;
    expect(max.value).toBe('3');
    expect(screen.getByText(/termine con «VEREDICTO: APROBADO» o «VEREDICTO: RECHAZADO»/)).toBeTruthy();
    expect(screen.getByText(/Claude verá: lo que dijo el revisor/)).toBeTruthy();
    fireEvent.change(max, { target: { value: '5' } });
    fireEvent.blur(max);
    await waitFor(() => expect(within(screen.getByLabelText(/^Revisión «Revisión»/)).getByText('máx. 5 vueltas')).toBeTruthy());
    expect(screen.getByText('↺ máx. 5')).toBeTruthy();
    await userEvent.selectOptions(screen.getByLabelText('Cómo decide'), 'ai');
    await waitFor(() => expect(within(screen.getByLabelText(/^Revisión «Revisión»/)).getByText('decide Claude')).toBeTruthy());
    expect(screen.queryByText(/termine con «VEREDICTO/)).toBeNull();
    const crit = screen.getByLabelText('Criterio para aprobar');
    await userEvent.type(crit, 'Respeta la paleta');
    fireEvent.blur(crit);
    await waitFor(() => expect((screen.getByLabelText('Criterio para aprobar') as HTMLTextAreaElement).value).toBe('Respeta la paleta'));
  });

  it('[R34.24] en directo la tarjeta dice la vuelta y el veredicto; Resultados avisa si se agotó', async () => {
    const ev = (seq: number, body: object): RunEvent => ({ runId: 'r', seq, ts: 't', ...body }) as RunEvent;
    const live = deriveLive([
      ev(1, { type: 'run.started', diagramId: 'principal' }),
      ev(2, { type: 'review.decided', nodeId: 'review-1', round: 1, max: 3, verdict: 'rejected', source: 'verdict', returnTo: 'agent-1' }),
      ev(3, { type: 'edge.traversed', edgeId: 'review-1.rejected->agent-1', fromNodeId: 'review-1', toNodeId: 'agent-1' }),
    ]);
    const nodes = buildFlowNodes(qaDiagram(), [], {}, live);
    expect(nodes.find((n) => n.id === 'review-1')!.data.review).toEqual({ n: 1, max: 3, verdict: 'rejected' });
    expect(buildFlowEdges(qaDiagram(), [], live).find((e) => e.id === 'review-1.rejected->agent-1')!.className).toContain('is-traversed');

    const done = deriveLive([
      ev(1, { type: 'run.started', diagramId: 'principal' }),
      ev(2, { type: 'review.decided', nodeId: 'review-1', round: 3, max: 3, verdict: 'exhausted', source: 'verdict' }),
      ev(3, { type: 'run.finished', status: 'succeeded' }),
    ]);
    const api = createMemoryApi();
    render(<ResultsPanel api={api} runId="r" live={done} labelOf={() => 'Revisión'} />);
    expect(screen.getByRole('status').textContent).toBe('Salió por el límite de vueltas en «Revisión»');
  });
});
