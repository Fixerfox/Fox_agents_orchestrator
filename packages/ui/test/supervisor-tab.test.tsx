// @vitest-environment jsdom
import './setup';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RunEvent } from '@orquestador/core';
import { summarizeRun, supervisorAlerts, supervisorView } from '@orquestador/editor';
import { RunModalView } from '../src/runs/RunModal';
import { SummaryBody } from '../src/runs/RunSummary';
import { SupervisorOverlay } from '../src/runs/SupervisorOverlay';
import { SupervisorPanel } from '../src/runs/SupervisorTab';
import { OrqNode, type OrqFlowNode } from '../src/diagrams/OrqNode';
import type { RunData } from '../src/runs/useRunData';

vi.mock('@xyflow/react', async (original) => ({
  ...(await original<typeof import('@xyflow/react')>()),
  Handle: () => null,
  Panel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ViewportPortal: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  useStore: (pick: (s: { transform: number[]; width: number; height: number; nodeLookup: Map<string, unknown> }) => unknown) => pick({ transform: [0, 0, 1], width: 1000, height: 800, nodeLookup: new Map() }),
  useReactFlow: () => ({
    getNodes: () => [{ id: 'a', type: 'orq' }],
    getInternalNode: () => ({ measured: { width: 200, height: 80 }, internals: { positionAbsolute: { x: 300, y: 300 } } }),
    fitView: vi.fn(),
  }),
}));

let seq = 0;
const ev = (b: Record<string, unknown>) => ({ runId: 'r', seq: ++seq, ts: '2026-11-06T23:07:38.000Z', ...b }) as unknown as RunEvent;
const labels = (id: string) => ({ a: 'Especificador', b: 'Planificador' })[id] ?? id;
const started = ev({ type: 'supervisor.started', review: true, model: 'claude-haiku-5-5' });
const branch = ev({ type: 'supervisor.alert', nodeId: 'a', rule: 'unexpected-branch', severity: 'warning', detail: 'Actuó en la rama feature/008' });
const empty = ev({ type: 'supervisor.alert', nodeId: 'b', rule: 'empty-output', severity: 'warning', detail: 'Sin salida' });
const strange = ev({ type: 'supervisor.alert', rule: 'nueva', severity: 'info', detail: 'Otra cosa' });

const panel = (events: RunEvent[], focus?: string, onPick = vi.fn()) => {
  const watch = summarizeRun(events, labels).supervisor!;
  render(<SupervisorPanel watch={watch} alerts={supervisorAlerts(events, labels)} focus={focus} onPick={onPick} />);
  return onPick;
};

const modal = (events: RunEvent[], extra: Partial<Parameters<typeof RunModalView>[0]> = {}) => {
  const data = { ready: true, live: {}, events, label: labels, title: 'Generador', status: 'running', running: true, duration: 1, usageText: '', tokens: 0, timeline: { steps: [] } } as unknown as RunData;
  render(<RunModalView data={data} api={{} as never} runId="r" onClose={vi.fn()} onPick={vi.fn()} onExport={vi.fn()} {...extra} />);
};

describe('pestaña Supervisor [R60.38]', () => {
  it('[R60.38] es la última, destacada y con el número de avisos', () => {
    modal([started, branch, empty]);
    const tabs = screen.getAllByRole('tab');
    const last = tabs[tabs.length - 1]!;
    expect(last.textContent).toBe('Supervisor2');
    expect(last.className).toContain('orq-run__tab-sup');
    expect(last.className).toContain('has-alerts');
  });

  it('[R60.38] sin avisos se destaca pero no cuenta, y sin Supervisor no existe', () => {
    modal([started]);
    expect(screen.getByRole('tab', { name: 'Supervisor' }).className).not.toContain('has-alerts');
  });

  it('[R60.38] una ejecución sin Supervisor no tiene pestaña', () => {
    modal([ev({ type: 'run.started', diagramId: 'd' })]);
    expect(screen.queryByRole('tab', { name: /Supervisor/ })).toBeNull();
  });

  it('[R60.39] cada aviso dice qué pasó, y al pulsarlo se despliega con qué significa y el paso', async () => {
    const onPick = panel([started, branch, empty]);
    const title = screen.getByText('Trabajó en otra rama de git');
    const card = title.closest('details')!;
    expect(card.open).toBe(false);
    expect(within(card).getByText(/Especificador · \d\d:\d\d/)).toBeTruthy();
    await userEvent.click(title);
    expect(card.open).toBe(true);
    expect(within(card).getByText('Actuó en la rama feature/008')).toBeTruthy();
    expect(within(card).getByText(/comprueba que sus cambios están en la rama correcta/)).toBeTruthy();
    fireEvent.click(within(card).getByRole('button', { name: 'Ver el paso' }));
    expect(onPick).toHaveBeenCalledWith('a');
  });

  it('[R60.39] un solo aviso sale desplegado; sin paso no ofrece ir a él y una regla nueva se explica igual', () => {
    panel([started, strange]);
    const card = screen.getByText('Algo no encaja').closest('details')!;
    expect(card.open).toBe(true);
    expect(within(card).queryByRole('button')).toBeNull();
  });

  it('[R60.39] lo que encuentra la revisión con IA avisa de que puede equivocarse', () => {
    panel([started, ev({ type: 'supervisor.alert', nodeId: 'a', rule: 'out-of-scope', severity: 'warning', detail: 'Tocó lo que no debía' })]);
    expect(screen.getByText('Se salió de lo pedido')).toBeTruthy();
    expect(screen.getByText(/que puede equivocarse/)).toBeTruthy();
  });

  it('[R62.13] dice si el resultado final cumple lo pedido y, si no, qué falta', () => {
    const bad = [started, ev({ type: 'supervisor.verified', met: false, detail: 'No hay diagramas' }), ev({ type: 'supervisor.alert', rule: 'requirements-unmet', severity: 'warning', detail: 'No hay diagramas' })];
    panel(bad);
    expect(screen.getByText('Resultado final: no cumple lo pedido.').className).toContain('is-bad');
    const card = screen.getByText('El resultado no cumple lo pedido').closest('details')!;
    expect(within(card).getByText('No hay diagramas')).toBeTruthy();
    expect(within(card).queryByRole('button')).toBeNull();
  });

  it('[R62.13] también en el Resumen, y cuando se cumple', () => {
    render(<SummaryBody summary={summarizeRun([started, ev({ type: 'supervisor.verified', met: true, detail: '' })], labels)} onPick={vi.fn()} />);
    expect(screen.getByText('Resultado final: cumple lo pedido.')).toBeTruthy();
  });

  it('[R62.13] los avisos de los controles tienen título propio', () => {
    panel([started, ev({ type: 'supervisor.alert', nodeId: 'a', rule: 'ai-review', severity: 'warning', detail: 'x' }), ev({ type: 'supervisor.alert', nodeId: 'b', rule: 'unchecked', severity: 'warning', detail: 'y' })]);
    expect(screen.getByText('No hizo lo pedido')).toBeTruthy();
    expect(screen.getByText('No se pudo comprobar')).toBeTruthy();
  });

  it('[R60.39] sin avisos lo dice, y enseña la memoria', () => {
    panel([started, ev({ type: 'supervisor.note', nodeId: 'a', text: 'Creó la spec', files: [] })]);
    expect(screen.getByText('No encontró problemas.')).toBeTruthy();
    expect(screen.getByText('Memoria de la ejecución')).toBeTruthy();
  });

  it('[R60.40] al llegar desde un paso se despliegan solo sus avisos y se va a ellos', () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    panel([started, branch, empty], 'b');
    expect(screen.getByText('Terminó sin dejar nada').closest('details')!.open).toBe(true);
    expect(screen.getByText('Trabajó en otra rama de git').closest('details')!.open).toBe(false);
    expect(scroll).toHaveBeenCalled();
  });

  it('[R60.40] pulsar «1 aviso» en el nodo pide los avisos sin seleccionar el nodo', () => {
    const onAlerts = vi.fn();
    const outer = vi.fn();
    const props = { id: 'a', data: { kind: 'agent', label: 'Especificador', problems: [], alerts: ['x'], onAlerts }, selected: false } as unknown as Parameters<typeof OrqNode>[0] & OrqFlowNode;
    render(<div onClick={outer}><OrqNode {...props} /></div>);
    fireEvent.click(screen.getByRole('button', { name: '1 aviso' }));
    expect(onAlerts).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });

  it('[R60.40] sin dónde ir, «1 aviso» es solo texto', () => {
    const props = { id: 'a', data: { kind: 'agent', label: 'Especificador', problems: [], alerts: ['x'] }, selected: false } as unknown as Parameters<typeof OrqNode>[0] & OrqFlowNode;
    render(<OrqNode {...props} />);
    expect(screen.getByText('1 aviso')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '1 aviso' })).toBeNull();
  });

  it('[R60.40] pulsar «Con aviso» en la mira abre los avisos de ese paso', () => {
    const events = [started, ev({ type: 'node.started', nodeId: 'a' }), branch, ev({ type: 'supervisor.reviewing', nodeId: 'a' })];
    const onOpen = vi.fn();
    render(<SupervisorOverlay view={supervisorView(events, true, labels)!} path={[]} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: 'Con aviso' }));
    expect(onOpen).toHaveBeenCalledWith('a');
    fireEvent.click(screen.getByRole('button', { name: /abrir su pestaña/ }));
    expect(onOpen).toHaveBeenLastCalledWith();
  });

  it('[R60.36] pulsar la tarjeta pide la pestaña sin un paso concreto', () => {
    const onOpen = vi.fn();
    render(<SupervisorOverlay view={supervisorView([started], true, labels)!} path={[]} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: /abrir su pestaña/ }));
    expect(onOpen).toHaveBeenCalledWith();
  });

  it('[R60.41] el Resumen destaca el aviso y pulsarlo lleva a él', () => {
    const onAlert = vi.fn();
    render(<SummaryBody summary={summarizeRun([started, branch], labels)} onPick={vi.fn()} onAlert={onAlert} />);
    const row = screen.getByRole('button', { name: /Trabajó en otra rama de git/ });
    expect(row.textContent).toContain('Especificador');
    expect(row.textContent).toContain('Actuó en la rama feature/008');
    fireEvent.click(row);
    expect(onAlert).toHaveBeenCalledWith('a');
  });

  it('[R60.41] desde el Resumen del modal se pasa a la pestaña con el aviso abierto', async () => {
    modal([started, branch, empty]);
    await userEvent.click(screen.getByRole('button', { name: /Terminó sin dejar nada/ }));
    expect(screen.getByRole('tab', { name: /Supervisor/ }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('Terminó sin dejar nada').closest('details')!.open).toBe(true);
  });
});

describe('SPEC-069 · memoria en tarjetas y su pestaña', () => {
  const note = (nodeId: string, text: string, files: string[] = []) => ev({ type: 'supervisor.note', nodeId, text, files });

  it('[R69.6] el modal tiene «Memoria» junto a «Supervisor» cuando hay memoria, y no sin ella', async () => {
    modal([started, note('a', 'Creó la spec')]);
    const tabs = screen.getAllByRole('tab').map((x) => x.textContent);
    expect(tabs.slice(-2)).toEqual(['Memoria', 'Supervisor']);
    await userEvent.click(screen.getByRole('tab', { name: 'Memoria' }));
    expect(screen.getByRole('tabpanel', { name: 'Memoria' }).textContent).toContain('Creó la spec');
    document.body.innerHTML = '';
    modal([started]);
    expect(screen.queryByRole('tab', { name: 'Memoria' })).toBeNull();
  });

  it('[R69.5] tarjetas, la última primero, con marca de avisos, ficheros «+N» y filtro «Con avisos»', async () => {
    modal([started, note('b', 'Planificó', ['a.md', 'b.md', 'c.md']), branch, note('a', 'Especificó')], { initialTab: 'memory' });
    // El aviso abierto va en su bloque; los pasos, en el suyo, el último primero [R72.22].
    expect(screen.getByRole('region', { name: 'Avisos abiertos' })).toBeTruthy();
    const cards = [...screen.getByRole('region', { name: 'Lo que hizo cada paso' }).querySelectorAll('.orq-memcard')];
    expect(cards.map((c) => c.querySelector('strong')!.textContent)).toEqual(['Especificador', 'Planificador']);
    expect(cards[0]!.classList.contains('is-warn')).toBe(true);
    expect(cards[1]!.classList.contains('is-warn')).toBe(false);
    expect(cards[1]!.textContent).toContain('+1');
    await userEvent.click(screen.getByRole('button', { name: 'Con avisos · 2' }));
    expect([...document.querySelectorAll('.orq-memcard strong')].map((x) => x.textContent)).toEqual(['Especificador', 'Especificador']);
    await userEvent.click(screen.getByRole('button', { name: 'Todas · 3' }));
    expect(document.querySelectorAll('.orq-memcard')).toHaveLength(3);
  });

  it('[R69.3] en el diagrama: líneas a los pasos en revisión y «Con aviso» en los que tienen aviso', () => {
    const events = [started, ev({ type: 'node.started', nodeId: 'a' }), branch, ev({ type: 'supervisor.reviewing', nodeId: 'a' })];
    const { container } = render(<SupervisorOverlay view={supervisorView(events, true, labels)!} path={[]} />);
    const paths = container.querySelectorAll('.orq-sup__lines path');
    expect(paths).toHaveLength(1);
    expect(paths[0]!.getAttribute('class')).toBe('is-warn');
    expect(container.querySelector('.orq-sup__anchor')!.classList.contains('nodrag')).toBe(true);
    expect(screen.getByRole('button', { name: 'Con aviso' })).toBeTruthy();
  });
});
