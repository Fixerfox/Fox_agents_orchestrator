// @vitest-environment jsdom
import './setup';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DeliverableSpec, Diagram, RunEvent } from '@orquestador/core';
import { EditorSession, summarizeRun } from '@orquestador/editor';
import { buildFlowNodes } from '../src/diagrams/Canvas';
import { Inspector } from '../src/diagrams/Inspector';
import { RunDialog } from '../src/runs/RunDialog';
import { RunModal } from '../src/runs/RunModal';
import { deliverableFromArgs, runAssistantTool } from '../src/assistant/assistantTools';
import { createMemoryApi } from '../src/memoryApi';
import { useSession } from '../src/diagrams/useSession';

const AGENTS = [{ id: 'qa', name: 'QA', description: 'Revisa', model: 'claude-sonnet-5-5' }];
const SPEC: DeliverableSpec = { items: [{ kind: 'links' }, { kind: 'summary' }] };
const flow = (deliverable?: DeliverableSpec): Diagram => ({
  id: 'web',
  name: 'Web de reservas',
  schemaVersion: 1,
  nodes: [
    { id: 'entry', kind: 'entry', label: 'Entrada' },
    { id: 'dis', kind: 'agent', agentId: 'qa', label: 'Diseñador' },
    { id: 'qa', kind: 'agent', agentId: 'qa', label: 'QA' },
    { id: 'output', kind: 'output', label: 'Salida' },
  ],
  edges: [
    { id: 'e1', from: 'entry', to: 'dis' },
    { id: 'e2', from: 'dis', to: 'qa' },
    { id: 'e3', from: 'qa', to: 'output' },
  ],
  ...(deliverable ? { deliverable } : {}),
});

function OutputPanel({ session }: { session: EditorSession }) {
  const snap = useSession(session);
  return <Inspector session={session} snap={snap} selection={{ nodes: ['output'], edges: [] }} agents={AGENTS} onError={vi.fn()} />;
}

describe('SPEC-046 · entregable en el diagrama', () => {
  it('[R46.13] el panel de la Salida activa elementos, edita la sección propia y enseña lo que leerán los pasos finales', async () => {
    const session = new EditorSession(flow());
    render(<OutputPanel session={session} />);
    const panel = within(screen.getByRole('group', { name: 'Qué quieres al final' }));
    expect(panel.getByText('Sin entregable: la Salida deja pasar lo que le llega.')).toBeTruthy();
    await userEvent.click(panel.getByRole('checkbox', { name: /Enlaces a lo generado/ }));
    expect(session.diagram.deliverable).toEqual({ items: [{ kind: 'links' }] });
    await userEvent.click(panel.getByRole('checkbox', { name: /Resumen en Markdown/ }));
    expect(session.diagram.deliverable!.items.map((i) => i.kind)).toEqual(['links', 'summary']);
    // Vista previa: quién lo lee y qué.
    expect(panel.getByText('Lo que leerán: QA')).toBeTruthy();
    expect(panel.getByText(/Al terminar esta ejecución se entregará al usuario:/)).toBeTruthy();
    // Sección propia: sin título avisa; con título e instrucciones queda bien.
    await userEvent.click(panel.getByRole('button', { name: 'Añadir sección' }));
    expect(panel.getByText('Elemento 3: la sección propia necesita título e instrucciones')).toBeTruthy();
    await userEvent.type(panel.getByLabelText('Título'), 'Cómo arrancarlo');
    await userEvent.type(panel.getByLabelText('Qué debe contener'), 'Pasos en local');
    fireEvent.blur(panel.getByLabelText('Qué debe contener'));
    await waitFor(() => expect(session.diagram.deliverable!.items[2]).toEqual({ kind: 'custom', title: 'Cómo arrancarlo', instructions: 'Pasos en local' }));
    // Opciones.
    await userEvent.selectOptions(panel.getByLabelText('Avisar a'), 'Todos los agentes');
    await userEvent.selectOptions(panel.getByLabelText('Si no se cumple'), 'Fallar la ejecución');
    expect(session.diagram.deliverable).toMatchObject({ notify: 'all', onMissing: 'fail' });
    expect(panel.getByText('El resto de agentes recibe solo esta línea:')).toBeTruthy();
    // El JSON avisa en el acto de un esquema mal escrito.
    await userEvent.click(panel.getByRole('checkbox', { name: /Datos en JSON/ }));
    fireEvent.change(panel.getByLabelText('Esquema JSON (opcional)'), { target: { value: '{no' } });
    fireEvent.blur(panel.getByLabelText('Esquema JSON (opcional)'));
    expect(await panel.findByRole('alert')).toBeTruthy();
    // Quitarlo todo deja la Salida como antes.
    for (const name of [/Enlaces/, /Resumen/, /Datos en JSON/]) await userEvent.click(panel.getByRole('checkbox', { name }));
    await userEvent.click(panel.getByRole('button', { name: 'Quitar la sección «Cómo arrancarlo»' }));
    expect(session.diagram.deliverable).toBeUndefined();
  });

  it('[R46.13] en el lienzo, la Salida dice qué entrega y los pasos finales llevan «· entrega»', () => {
    const nodes = buildFlowNodes(flow(SPEC), [], {}, undefined, { qa: 'QA' });
    const data = (id: string) => nodes.find((n) => n.id === id)!.data as { sub?: string; note?: string };
    expect(data('output').note).toBe('Entrega: enlaces + resumen .md');
    expect(data('qa').sub).toBe('entrega');
    expect(data('dis').sub).toBe('QA');
    const none = buildFlowNodes(flow({ ...SPEC, notify: 'none' }), [], {}, undefined, { qa: 'QA' });
    expect((none.find((n) => n.id === 'qa')!.data as { sub?: string }).sub).toBeUndefined();
    const plain = buildFlowNodes(flow(), [], {}, undefined, { qa: 'QA' });
    expect((plain.find((n) => n.id === 'output')!.data as { note?: string }).note).not.toMatch(/Entrega/);
  });
});

describe('SPEC-046 · entregable al lanzar', () => {
  const dialog = (props: Partial<Parameters<typeof RunDialog>[0]> = {}) => {
    const onStart = vi.fn();
    const onSave = vi.fn();
    render(<RunDialog diagramName="Web" engine="simulated" runnable lastInput="Haz la web" onEngine={vi.fn()} onStart={onStart} onClose={vi.fn()} deliverable={SPEC} finals={['QA']} onSaveDeliverable={onSave} {...props} />);
    return { onStart, onSave, dlg: within(screen.getByRole('dialog')) };
  };

  it('[R46.14] sin tocarlo, la ejecución usa el del diagrama', async () => {
    const { onStart, dlg } = dialog();
    expect(dlg.getByText('enlaces + resumen .md')).toBeTruthy();
    await userEvent.click(dlg.getByRole('button', { name: /Ejecutar/ }));
    expect(onStart).toHaveBeenCalledWith('Haz la web', undefined);
  });

  it('[R46.14] lo cambiado vale solo para esta ejecución; «Guardar en el diagrama» lo guarda también', async () => {
    const { onStart, onSave, dlg } = dialog();
    await userEvent.click(dlg.getByText('Entregable'));
    await userEvent.click(dlg.getByRole('checkbox', { name: /Resumen en Markdown/ }));
    expect(dlg.getByText('enlaces')).toBeTruthy();
    await userEvent.click(dlg.getByRole('button', { name: 'Guardar en el diagrama' }));
    expect(onSave).toHaveBeenCalledWith({ items: [{ kind: 'links' }] });
    expect(dlg.getByRole('button', { name: 'Guardado en el diagrama' })).toBeTruthy();
    await userEvent.click(dlg.getByRole('button', { name: /Ejecutar/ }));
    expect(onStart).toHaveBeenCalledWith('Haz la web', undefined, { items: [{ kind: 'links' }] });
  });

  it('[R46.14] quitarlo todo ejecuta sin entregable (null); uno no válido no deja ejecutar', async () => {
    const { onStart, dlg } = dialog();
    await userEvent.click(dlg.getByText('Entregable'));
    await userEvent.click(dlg.getByRole('checkbox', { name: /Enlaces/ }));
    await userEvent.click(dlg.getByRole('checkbox', { name: /Resumen en Markdown/ }));
    expect(dlg.getByText('sin entregable')).toBeTruthy();
    await userEvent.click(dlg.getByRole('button', { name: /Ejecutar/ }));
    expect(onStart).toHaveBeenCalledWith('Haz la web', undefined, null);
    await userEvent.click(dlg.getByRole('button', { name: 'Añadir sección' }));
    expect((dlg.getByRole('button', { name: /Ejecutar/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('SPEC-046 · entregable en el resumen de la ejecución', () => {
  const ev = (seq: number, body: object): RunEvent => ({ runId: 'r1', seq, ts: `2026-11-05T17:00:0${seq}Z`, ...body }) as RunEvent;
  const MD = '# Entregable\n\n## Enlaces\n\n- `web/index.html`\n\n## Resumen\n\nSe hizo la **web**.';
  const events = (done = true): RunEvent[] => [
    ev(1, { type: 'run.started', diagramId: 'web', deliverable: SPEC }),
    ev(2, { type: 'node.started', nodeId: 'entry', input: { text: 'Haz la web', files: [] } }),
    ...(done
      ? [
          ev(3, { type: 'deliverable.done', nodeId: 'output', ok: false, fileName: 'entregable', markdown: MD, items: [{ kind: 'links', title: 'Enlaces', ok: true, attempts: 0 }, { kind: 'summary', title: 'Resumen', ok: true, attempts: 1, tokens: 1840 }, { kind: 'json', title: 'Datos (JSON)', ok: false, error: 'no cumple', attempts: 2 }] }),
          ev(4, { type: 'node.finished', nodeId: 'output', status: 'succeeded', output: { text: MD, files: [] } }),
        ]
      : []),
    ev(done ? 5 : 3, { type: 'run.finished', status: done ? 'succeeded' : 'failed' }),
  ];
  const api = (evs: RunEvent[]) => ({
    ...createMemoryApi(),
    subscribeRun: async () => ({ ok: true as const, value: evs }),
    unsubscribeRun: async () => ({ ok: true as const, value: null }),
    runDiagram: async () => ({ ok: true as const, value: flow(SPEC) }),
    listRuns: async () => ({ ok: true as const, value: [] }),
    listOutput: async () => ({ ok: true as const, value: [{ path: 'entregable.md', size: MD.length }] }),
    readOutput: async () => ({ ok: true as const, value: { text: MD, truncated: false } }),
  });
  const main = { runId: undefined, events: [], status: 'idle' } as never;

  it('[R46.15] empieza por el bloque «Entregable» con su estado por elemento; «Abrir entregable» lleva a Resultados', async () => {
    render(<RunModal api={api(events()) as never} runId="r1" main={main} onClose={vi.fn()} onPick={vi.fn()} onExport={vi.fn()} />);
    const block = within(await screen.findByRole('region', { name: 'Entregable' }));
    expect(block.getByText('Enlaces', { selector: 'li span' })).toBeTruthy();
    expect(block.getByText('sin IA')).toBeTruthy();
    expect(block.getByText('1840 tokens'.replace('1840', (1840).toLocaleString('es-ES')))).toBeTruthy();
    expect(block.getByText('Datos (JSON) · No se pudo completar: no cumple')).toBeTruthy();
    expect(block.getByText('web', { selector: 'strong' })).toBeTruthy();
    // El resultado final no se repite.
    expect(screen.queryByRole('region', { name: 'Resultado final' })).toBeNull();
    await userEvent.click(block.getByRole('button', { name: 'Abrir entregable' }));
    expect(await screen.findByRole('region', { name: 'Vista previa de entregable.md' })).toBeTruthy();
  });

  it('[R46.15] si estaba pedido y no llegó a componerse, lo dice', async () => {
    render(<RunModal api={api(events(false)) as never} runId="r1" main={main} onClose={vi.fn()} onPick={vi.fn()} onExport={vi.fn()} />);
    const block = within(await screen.findByRole('region', { name: 'Entregable' }));
    expect(block.getByText('Esta ejecución tenía entregable, pero no llegó a componerse.')).toBeTruthy();
    expect(summarizeRun(events(false)).deliverable).toEqual({});
  });
});

describe('SPEC-046 · entregable con el asistente', () => {
  it('[R46.16] set_deliverable cambia el del diagrama abierto, valida y se quita con clear; get_diagram lo enseña', async () => {
    const session = new EditorSession(flow());
    const host = { api: createMemoryApi(), session, newDiagram: vi.fn(), run: vi.fn(), refresh: vi.fn() };
    const ok = await runAssistantTool(host as never, 'set_deliverable', { links: true, summaryInstructions: 'Breve', sections: ['Cómo arrancarlo: pasos en local'], notify: 'final' });
    expect(ok.ok).toBe(true);
    expect(session.diagram.deliverable).toEqual({ items: [{ kind: 'links' }, { kind: 'summary', instructions: 'Breve' }, { kind: 'custom', title: 'Cómo arrancarlo', instructions: 'pasos en local' }], notify: 'final' });
    expect(ok.summary).toBe('Entregable del diagrama: enlaces + resumen .md + 1 sección (Ctrl+Z lo deshace).');
    const read = await runAssistantTool(host as never, 'get_diagram', {});
    expect((read.result as { deliverable?: unknown }).deliverable).toEqual(session.diagram.deliverable);
    const bad = await runAssistantTool(host as never, 'set_deliverable', { json: true, jsonSchema: '{no' });
    expect(bad.ok).toBe(false);
    expect(session.diagram.deliverable!.items).toHaveLength(3);
    expect(deliverableFromArgs({ sections: ['Sin dos puntos'] }).items).toEqual([{ kind: 'custom', title: 'Sin dos puntos', instructions: '' }]);
    await runAssistantTool(host as never, 'set_deliverable', { clear: true });
    expect(session.diagram.deliverable).toBeUndefined();
  });
});
