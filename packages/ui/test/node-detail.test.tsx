// @vitest-environment jsdom
import './setup';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RunEvent } from '@orquestador/core';
import { deriveLive } from '@orquestador/editor';
import { NodeDialog } from '../src/runs/NodeDialog';
import { NodePanel } from '../src/runs/NodePanel';
import { showConversation } from './nav';
import { ResizeHandle } from '../src/common/ResizeHandle';

const ev = (seq: number, body: object): RunEvent => ({ runId: 'r', seq, ts: 't', ...body }) as RunEvent;
const LONG = Array.from({ length: 40 }, (_, i) => `línea ${i + 1}`).join('\n');
const events: RunEvent[] = [
  ev(1, { type: 'agent.request', nodeId: 'a', agentId: 'dis', attempt: 1, input: { text: 'Quiero una página de videojuegos', files: [] } }),
  ev(2, { type: 'token.stream', nodeId: 'a', text: 'Voy a leer la skill.' }),
  ev(3, { type: 'tool.called', nodeId: 'a', tool: 'Read', input: {} }),
  ev(4, { type: 'tool.result', nodeId: 'a', tool: 'Read', ok: true, output: LONG }),
  ev(5, { type: 'agent.usage', nodeId: 'a', inputTokens: 1000, outputTokens: 234, costUsd: 0.0123 }),
  ev(6, { type: 'node.finished', nodeId: 'a', status: 'succeeded', output: { text: 'Documento de diseño terminado', files: [] } }),
];
const dialog = (o: Partial<React.ComponentProps<typeof NodeDialog>> = {}) => {
  const props = { events, live: deriveLive(events), nodeId: 'a', nodePath: [], label: 'Diseñador', onAnswer: vi.fn(), onClose: vi.fn(), ...o };
  render(<NodeDialog {...props} />);
  return props;
};

describe('SPEC-015 · ventana grande de un nodo', () => {
  beforeEach(() => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  });

  it('[R15.12] muestra entrada, resultado y paso a paso con el estado y el consumo', () => {
    dialog();
    const d = within(screen.getByRole('dialog', { name: 'Ejecución de «Diseñador»' }));
    expect(d.getByText('Quiero una página de videojuegos')).toBeTruthy();
    expect(d.getByText('Documento de diseño terminado')).toBeTruthy();
    expect(d.getByText('Voy a leer la skill.')).toBeTruthy();
    expect(d.getByText(/correcto · 1(\.|\s)?234 tokens, 0,012 \$/)).toBeTruthy();
    expect(d.getByText('Entrada')).toBeTruthy();
    expect(d.getByText('Resultado')).toBeTruthy();
    expect(d.getByText('Paso a paso')).toBeTruthy();
  });

  it('[R15.13] la salida de una herramienta va plegada y dice cuántas líneas tiene', () => {
    dialog();
    const summary = screen.getByText(/Herramienta Read/).closest('summary')!;
    expect(summary.textContent).toContain('Ver salida (40 líneas)');
    expect((summary.closest('details') as HTMLDetailsElement).open).toBe(false);
  });

  it('[R15.12] se cierra con Escape, con el botón y pulsando fuera', async () => {
    const p = dialog();
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(p.onClose).toHaveBeenCalledTimes(2);
    fireEvent.pointerDown(document.querySelector('.orq-modal')!);
    expect(p.onClose).toHaveBeenCalledTimes(3);
  });

  it('[R15.12] «Copiar resultado» copia el texto de salida', async () => {
    dialog();
    await userEvent.click(screen.getByRole('button', { name: 'Copiar resultado' }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Documento de diseño terminado');
    expect(await screen.findByRole('button', { name: 'Copiado' })).toBeTruthy();
  });

  it('[R15.12] un nodo todavía sin resultado lo dice y las preguntas se contestan desde la ventana', async () => {
    const pending = events.slice(0, 3).concat(ev(9, { type: 'agent.question', nodeId: 'a', questionId: 'q1', text: '¿Qué estilo?', options: ['Pixel'] }));
    const p = dialog({ events: pending, live: deriveLive(pending) });
    expect(screen.getByText('Todavía no hay resultado.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Pixel' }));
    expect(p.onAnswer).toHaveBeenCalledWith('q1', 'Pixel');
  });

  it('[R15.12] el panel lateral ofrece «Ver en grande» solo si el nodo tiene actividad', async () => {
    const onExpand = vi.fn();
    const { rerender } = render(<NodePanel events={events} live={deriveLive(events)} nodeId="a" nodePath={[]} label="D" onAnswer={() => {}} onExpand={onExpand} />);
    await userEvent.click(screen.getByRole('button', { name: 'Ver en grande' }));
    expect(onExpand).toHaveBeenCalledTimes(1);
    rerender(<NodePanel events={events} live={deriveLive(events)} nodeId="z" nodePath={[]} label="Z" onAnswer={() => {}} onExpand={onExpand} />);
    expect(screen.queryByRole('button', { name: 'Ver en grande' })).toBeNull();
  });

  it('[R15.13] en el panel lateral las salidas largas también van plegadas', async () => {
    render(<NodePanel events={events} live={deriveLive(events)} nodeId="a" nodePath={[]} label="D" onAnswer={() => {}} />);
    await showConversation();
    expect(screen.getByText('Ver salida (40 líneas)').closest('details')?.hasAttribute('open')).toBe(false);
  });
});

describe('SPEC-021 · panel derecho redimensionable', () => {
  const mount = (width = 300) => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    render(<ResizeHandle width={width} min={288} max={700} reset={288} onChange={onChange} onCommit={onCommit} />);
    return { onChange, onCommit, bar: screen.getByRole('separator', { name: 'Cambiar el ancho del panel' }) };
  };

  it('[R21.22] expone su valor y límites como separador accesible', () => {
    const { bar } = mount();
    expect(bar.getAttribute('aria-valuenow')).toBe('300');
    expect(bar.getAttribute('aria-valuemin')).toBe('288');
    expect(bar.getAttribute('aria-valuemax')).toBe('700');
  });

  it('[R21.22] arrastrar a la izquierda ensancha, a la derecha estrecha, y se respetan los límites', () => {
    const { bar, onChange, onCommit } = mount(300);
    fireEvent.pointerDown(bar, { clientX: 500, pointerId: 1 });
    fireEvent.pointerMove(bar, { clientX: 400, pointerId: 1 });
    expect(onChange).toHaveBeenLastCalledWith(400);
    fireEvent.pointerMove(bar, { clientX: 5000, pointerId: 1 });
    expect(onChange).toHaveBeenLastCalledWith(288);
    fireEvent.pointerMove(bar, { clientX: -5000, pointerId: 1 });
    expect(onChange).toHaveBeenLastCalledWith(700);
    fireEvent.pointerUp(bar, { clientX: 450, pointerId: 1 });
    expect(onCommit).toHaveBeenCalledWith(350);
  });

  it('[R21.22] se maneja con el teclado y el doble clic lo restablece', async () => {
    const { bar, onChange, onCommit } = mount(300);
    bar.focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(onChange).toHaveBeenLastCalledWith(324);
    await userEvent.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith(288);
    await userEvent.keyboard('{End}');
    expect(onChange).toHaveBeenLastCalledWith(700);
    await userEvent.keyboard('{Home}');
    expect(onChange).toHaveBeenLastCalledWith(288);
    fireEvent.doubleClick(bar);
    expect(onChange).toHaveBeenLastCalledWith(288);
    expect(onCommit).toHaveBeenCalled();
  });
});

describe('SPEC-015 · pasadas en la ventana grande [R15.14]', () => {
  const twice: RunEvent[] = [
    ev(1, { type: 'node.started', nodeId: 'a' }),
    ev(2, { type: 'agent.request', nodeId: 'a', agentId: 'dis', attempt: 1, input: { text: 'Diseña el mundo' } }),
    ev(3, { type: 'node.finished', nodeId: 'a', status: 'succeeded', output: { text: 'Hay dos puntos por decidir' } }),
    ev(4, { type: 'review.decided', nodeId: 'rev', round: 1, max: 3, verdict: 'rejected', source: 'ai', reason: 'No hay nada construido', returnTo: 'a' }),
    ev(5, { type: 'node.started', nodeId: 'a' }),
    ev(6, { type: 'agent.request', nodeId: 'a', agentId: 'dis', attempt: 1, input: { text: 'Correcciones de la revisión' } }),
  ];

  it('[R15.14] la ventana grande separa la segunda pasada con quién la devolvió y por qué, y su entrada es la última', () => {
    dialog({ events: twice, live: deriveLive(twice), labelOf: (id) => (id === 'rev' ? 'Revisión' : id) });
    const d = within(screen.getByRole('dialog', { name: 'Ejecución de «Diseñador»' }));
    const sep = d.getByRole('separator', { name: 'Pasada 2' });
    expect(sep.textContent).toContain('Pasada 2 · devuelto por Revisión');
    expect(sep.textContent).toContain('Motivo: No hay nada construido');
    expect(d.getByText('Correcciones de la revisión')).toBeTruthy();
  });

  it('[R15.17] «Recibió» se pliega y despliega, y sigue plegada aunque lleguen más eventos', async () => {
    const panel = (events: typeof twice) => <NodePanel events={events} live={deriveLive(events)} nodeId="a" nodePath={[]} label="Diseñador" onAnswer={vi.fn()} />;
    const { rerender } = render(panel(twice.slice(0, 2)));
    const title = screen.getByText(/^Recibió/);
    const fold = title.closest('details')!;
    expect(fold.open).toBe(true);
    await userEvent.click(title);
    expect(fold.open).toBe(false);
    rerender(panel(twice));
    expect(screen.getAllByText(/^Recibió/)[0]!.closest('details')).toBe(fold);
    expect(fold.open).toBe(false);
    await userEvent.click(title);
    expect(fold.open).toBe(true);
  });

  it('[R15.14] el panel lateral rotula cada entrada con su pasada', async () => {
    render(<NodePanel events={twice} live={deriveLive(twice)} nodeId="a" nodePath={[]} label="Diseñador" onAnswer={vi.fn()} />);
    await showConversation();
    expect(screen.getByText('Recibió (pasada 1, intento 1)')).toBeTruthy();
    expect(screen.getByText('Recibió (pasada 2, intento 1)')).toBeTruthy();
    // Sin nombre para la revisión, se usa su id.
    expect(screen.getByRole('separator', { name: 'Pasada 2' }).textContent).toContain('devuelto por rev');
  });
});
