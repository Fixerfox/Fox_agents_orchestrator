// @vitest-environment jsdom
import './setup';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReactFlowProvider } from '@xyflow/react';
import { MockAgent, MockDecider, Orchestrator, type Diagram, type DiagramNode, type Edge, type RunEvent } from '@orquestador/core';
import { EditorSession, deriveLive, edgeTraversals } from '@orquestador/editor';
import { Canvas } from '../src/diagrams/Canvas';
import { EdgeInspector } from '../src/diagrams/EdgeInspector';

const agent = (id: string, extra: Partial<DiagramNode> = {}): DiagramNode => ({ id, kind: 'agent', agentId: id, label: id, position: { x: 0, y: 0 }, ...extra });
const edge = (from: string, to: string, port?: Edge['port']): Edge => ({ id: `${from}->${to}`, from, to, ...(port ? { port } : {}) });
const diagram = (nodes: DiagramNode[], edges: Edge[]): Diagram => ({ id: 'd', name: 'd', schemaVersion: 1, nodes, edges });
const ENTRY: DiagramNode = { id: 'entry', kind: 'entry', position: { x: 0, y: 0 } };
const OUTPUT: DiagramNode = { id: 'output', kind: 'output', position: { x: 600, y: 0 } };

const chain = diagram(
  [ENTRY, agent('esp', { position: { x: 200, y: 0 } }), agent('dis', { position: { x: 400, y: 0 }, task: 'Diseña la página de inicio', extra: { skillIds: ['marca'] } }), OUTPUT],
  [edge('entry', 'esp'), edge('esp', 'dis'), edge('dis', 'output')],
);

async function run(d: Diagram, scripts: ConstructorParameters<typeof MockAgent>[0]): Promise<readonly RunEvent[]> {
  const agents = new MockAgent(scripts);
  const orch = new Orchestrator({
    getAdapter: () => agents,
    decider: new MockDecider(),
    describeAgent: (id) => ({ name: id, model: 'claude-sonnet-5-5', version: 3, instructions: `Eres **${id}**.`, skillIds: ['frontend-design'], contextIds: ['publico'], mcpServers: ['figma'], allowedTools: ['Read', 'Write'] }),
  });
  return (await orch.start(d, 'Haz la landing').result).events;
}
const NAMES = { 'frontend-design': 'Diseño web', marca: 'Guía de marca', publico: 'Público objetivo', figma: 'Figma' };
const scripts = { esp: { output: '## Especificación\n\n- Reservar en 3 pasos', files: ['specs/landing.md'] }, dis: { output: 'hecho' } };

function card(events: readonly RunEvent[], d = chain, edgeIdx = 1, over: Partial<Parameters<typeof EdgeInspector>[0]> = {}) {
  const e = d.edges[edgeIdx]!;
  const onClose = vi.fn();
  const onOpenTarget = vi.fn();
  render(<EdgeInspector traversals={edgeTraversals(events, e)} fromName={e.from} toName={e.to} toIsAgent={d.nodes.find((n) => n.id === e.to)?.kind === 'agent'} at={{ x: 300, y: 200 }} names={NAMES} onClose={onClose} onOpenTarget={onOpenTarget} {...over} />);
  return { dialog: within(screen.getByRole('dialog', { name: `Conexión de «${e.from}» a «${e.to}»` })), onClose, onOpenTarget };
}

describe('SPEC-042 · tarjeta sobre el hilo', () => {
  it('[R42.6] resume lo enviado en Markdown, sus archivos y tamaño, y lo que el destino ya tenía', async () => {
    const { dialog } = card(await run(chain, scripts));
    expect(dialog.getByRole('heading', { name: 'Especificación' })).toBeTruthy();
    expect(dialog.getByText('Reservar en 3 pasos')).toBeTruthy();
    expect(within(dialog.getByRole('list', { name: 'Archivos' })).getByText(/specs\/landing\.md/)).toBeTruthy();
    expect(dialog.getAllByText(/≈ \d+ tokens/).length).toBeGreaterThan(0);
    expect(dialog.getByText(/Recorrida a las/)).toBeTruthy();
    const had = within(dialog.getByRole('region', { name: '«dis» ya tenía' }));
    expect(had.getByText('Sonnet 5.5')).toBeTruthy();
    expect(had.getByText(/^v3 · ≈/)).toBeTruthy();
    expect(had.getByText('2 skills · 1 contextos · 1 MCP')).toBeTruthy();
    expect(had.getByText('Diseño web, Guía de marca, Público objetivo, Figma')).toBeTruthy();
    expect(had.getByText('«Diseña la página de inicio»')).toBeTruthy();
    expect(had.getByText('ninguna')).toBeTruthy();
    // Sin varias veces no hay selector.
    expect(dialog.queryByRole('group', { name: 'Qué vez' })).toBeNull();
  });

  it('[R42.8] se amplía con tres pestañas: lo enviado completo, el contexto con su origen y el registro', async () => {
    const { dialog } = card(await run(chain, scripts));
    await userEvent.click(dialog.getAllByRole('button', { name: 'Ampliar' })[0]!);
    expect(screen.getByRole('dialog').className).toContain('is-big');
    expect(dialog.getByRole('tab', { name: 'Lo que envió', selected: true })).toBeTruthy();
    expect(dialog.getByText('Reservar en 3 pasos')).toBeTruthy();
    await userEvent.click(dialog.getByRole('tab', { name: 'Contexto de «dis»' }));
    expect(dialog.getByText('dis', { selector: 'strong' })).toBeTruthy(); // instrucciones en Markdown: «Eres **dis**.»
    const skill = dialog.getByText('Guía de marca').closest('li')!;
    expect(within(skill as HTMLElement).getByText('Este paso')).toBeTruthy();
    expect(within(dialog.getByText('Diseño web').closest('li') as HTMLElement).getByText('Agente')).toBeTruthy();
    expect(dialog.getByText('Read, Write')).toBeTruthy();
    await userEvent.click(dialog.getByRole('tab', { name: 'Registro' }));
    expect(dialog.getByText(/"type": "agent.request"/)).toBeTruthy();
    // Se reduce con el mismo icono.
    await userEvent.click(dialog.getByRole('button', { name: 'Reducir' }));
    expect(screen.getByRole('dialog').className).not.toContain('is-big');
  });

  it('[R42.9] Esc y «Cerrar» cierran; «Copiar» copia lo enviado; «Ir a» abre el destino', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { dialog, onClose, onOpenTarget } = card(await run(chain, scripts));
    await userEvent.click(dialog.getByRole('button', { name: /Copiar/ }));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('## Especificación'));
    await waitFor(() => expect(dialog.getByRole('button', { name: /Copiado/ })).toBeTruthy());
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    await userEvent.click(dialog.getByRole('button', { name: 'Cerrar' }));
    expect(onClose).toHaveBeenCalledTimes(2);
    await userEvent.click(dialog.getAllByRole('button', { name: 'Ampliar' })[0]!);
    await userEvent.click(dialog.getByRole('button', { name: 'Ir a «dis»' }));
    expect(onOpenTarget).toHaveBeenCalled();
  });

  it('[R42.7] sin nada recorrido lo dice; si el destino espera a otras entradas, también', async () => {
    card([]);
    expect(screen.getByText('Aún no ha pasado nada por esta conexión.')).toBeTruthy();
    const base = { runId: 'r', ts: '2026-11-05T16:00:00Z' };
    const events = [
      { ...base, seq: 1, type: 'node.finished', nodeId: 'esp', status: 'succeeded', output: { text: 'spec', files: [] } },
      { ...base, seq: 2, type: 'edge.traversed', edgeId: 'esp->dis', fromNodeId: 'esp', toNodeId: 'dis' },
    ] as RunEvent[];
    document.body.innerHTML = '';
    card(events);
    expect(screen.getByText('«dis» aún no ha empezado: espera a sus demás entradas.')).toBeTruthy();
  });

  it('[R42.10] hacia un paso que no es agente solo hay lo enviado', async () => {
    const { dialog } = card(await run(chain, scripts), chain, 2);
    expect(dialog.getByText('«output» no es un agente: solo trabaja con lo que le llega por sus conexiones.')).toBeTruthy();
    await userEvent.click(dialog.getAllByRole('button', { name: 'Ampliar' })[0]!);
    await userEvent.click(dialog.getByRole('tab', { name: 'Contexto de «output»' }));
    expect(dialog.getByText(/no es un agente/)).toBeTruthy();
  });

  it('[R42.6][R42.8] con varias veces (retorno de revisión) se elige la vez; por defecto la última', async () => {
    const rev: DiagramNode = { id: 'rev', kind: 'review', label: 'rev', position: { x: 0, y: 0 }, review: { maxRounds: 3, mode: 'verdict' } };
    const d = diagram(
      [ENTRY, agent('dis'), agent('qa'), rev, OUTPUT],
      [edge('entry', 'dis'), edge('dis', 'qa'), edge('qa', 'rev'), edge('rev', 'output', 'approved'), edge('rev', 'dis', 'rejected'), { ...edge('rev', 'output', 'exhausted'), id: 'rev->output:x' }],
    );
    let n = 0;
    const events = await run(d, { dis: { output: 'diseño' }, qa: { output: () => (++n < 3 ? `Fallo ${n}.\nVEREDICTO: RECHAZADO` : 'VEREDICTO: APROBADO') } });
    const { dialog } = card(events, d, 4);
    const seg = within(dialog.getByRole('group', { name: 'Qué vez' }));
    expect(seg.getByRole('button', { name: 'Vez 2', pressed: true })).toBeTruthy();
    expect(dialog.getByText('Correcciones que envió')).toBeTruthy();
    expect(dialog.getByText(/pasada 3/)).toBeTruthy();
    await userEvent.click(seg.getByRole('button', { name: 'Vez 1' }));
    expect(dialog.getByText(/pasada 2/)).toBeTruthy();
    expect(dialog.getAllByText(/Fallo 1\./).length).toBeGreaterThan(0);
  });
});

describe('SPEC-042 · en el lienzo', () => {
  const mount = (events?: readonly RunEvent[]) => {
    const session = new EditorSession(chain);
    const onSelection = vi.fn();
    const onOpenNode = vi.fn();
    render(
      <ReactFlowProvider>
        <div style={{ width: 800, height: 600 }}>
          <Canvas session={session} onSelection={onSelection} onReject={() => {}} live={events ? deriveLive(events) : undefined} {...(events ? { events } : {})} readOnly onOpenNode={onOpenNode} extras={{ knowledgeNames: NAMES }} />
        </div>
      </ReactFlowProvider>,
    );
    return { onOpenNode };
  };
  const edgeEl = async (id: string) => {
    await waitFor(() => expect(document.querySelector(`[data-testid="rf__edge-${id}"]`)).not.toBeNull());
    return document.querySelector(`[data-testid="rf__edge-${id}"]`)!;
  };

  it('[R42.6][R42.9] con una ejecución, pulsar un hilo abre su tarjeta; pulsar el lienzo la cierra', async () => {
    const { onOpenNode } = mount(await run(chain, scripts));
    fireEvent.click(await edgeEl('esp->dis'));
    const dialog = within(await screen.findByRole('dialog', { name: 'Conexión de «esp» a «dis»' }));
    expect(dialog.getByText('Reservar en 3 pasos')).toBeTruthy();
    await waitFor(() => expect(document.querySelector('[data-testid="rf__edge-esp->dis"]')!.getAttribute('class')).toContain('is-inspected'));
    await userEvent.click(dialog.getAllByRole('button', { name: 'Ampliar' })[0]!);
    await userEvent.click(dialog.getByRole('button', { name: 'Ir a «dis»' }));
    expect(onOpenNode).toHaveBeenCalledWith('dis');
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(await edgeEl('entry->esp'));
    expect(await screen.findByRole('dialog', { name: 'Conexión de «entry» a «esp»' })).toBeTruthy();
    fireEvent.click(document.querySelector('.react-flow__pane')!);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('[R42.6] sin ejecución en pantalla, pulsar un hilo no abre nada', async () => {
    mount();
    fireEvent.click(await edgeEl('esp->dis'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
