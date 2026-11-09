// @vitest-environment jsdom
import './setup';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EventBody, RunEvent } from '@orquestador/core';
import { deriveLive, runTimeline, settleLive } from '@orquestador/editor';
import { NodePanel } from '../src/runs/NodePanel';
import { AuditPanel } from '../src/runs/AuditPanel';
import { FileViewer, ProjectChanges } from '../src/runs/RunFiles';
import { Gantt, RunStory, axisTicks } from '../src/runs/Timeline';
import { showConversation } from './nav';
import { createMemoryApi } from '../src/memoryApi';

const T0 = Date.parse('2026-11-05T16:52:00.000Z');
let seq = 0;
const ev = (s: number, body: EventBody): RunEvent => ({ ...body, runId: 'r1', seq: ++seq, ts: new Date(T0 + s * 1000).toISOString() }) as RunEvent;
const LABELS: Record<string, string> = { spec: 'Especificador', plan: 'Planificador técnico', entry: 'Entrada', output: 'Salida' };
const label = (id: string) => LABELS[id] ?? id;

/** El Especificador escribe la spec y termina; el Planificador modifica y pide permiso para otro fichero. */
function run(): RunEvent[] {
  seq = 0;
  return [
    ev(0, { type: 'run.started', diagramId: 'sk' }),
    ev(0, { type: 'node.started', nodeId: 'entry', input: { text: 'Landing', files: [] } }),
    ev(1, { type: 'node.finished', nodeId: 'entry', status: 'succeeded', output: { text: 'Landing', files: [] } }),
    ev(2, { type: 'node.started', nodeId: 'spec' }),
    ev(3, { type: 'agent.request', nodeId: 'spec', agentId: 'esp', attempt: 1, input: { text: 'Landing', files: [] } }),
    ev(10, { type: 'tool.called', nodeId: 'spec', tool: 'Write', input: {} }),
    ev(12, { type: 'file.produced', nodeId: 'spec', path: 'specs/001/spec.md', change: 'created' }),
    ev(20, { type: 'node.finished', nodeId: 'spec', status: 'succeeded', output: { text: 'Spec lista', files: ['specs/001/spec.md'] } }),
    ev(21, { type: 'node.started', nodeId: 'plan' }),
    ev(22, { type: 'agent.request', nodeId: 'plan', agentId: 'plan', attempt: 1, input: { text: 'Spec lista', files: ['specs/001/spec.md'] } }),
    ev(30, { type: 'file.produced', nodeId: 'plan', path: 'specs/001/plan.md', change: 'created' }),
    ev(40, { type: 'agent.question', nodeId: 'plan', questionId: 'q-1', text: '¿Puedo modificar README.md?', options: ['Permitir', 'Permitir en esta ejecución', 'Denegar'], kind: 'permission' }),
  ];
}

describe('SPEC-045 · ficheros en el panel del paso', () => {
  it('[R45.9] un paso terminado tiene «Ficheros de este paso» tras la salida y la pestaña «Ficheros (N)»', async () => {
    const events = run();
    const open = vi.fn();
    render(<NodePanel events={events} live={deriveLive(events)} nodeId="spec" nodePath={[]} label="Especificador" onAnswer={() => undefined} onOpenFile={open} />);
    await showConversation();
    const block = within(screen.getByRole('region', { name: 'Ficheros de este paso' }));
    expect(block.getByText('specs/001/spec.md')).toBeTruthy();
    expect(block.getByText('Nuevo')).toBeTruthy();
    expect(block.getByText('1 nuevos · 0 modificados')).toBeTruthy();
    // El bloque va dentro de la salida del paso.
    expect(screen.getByRole('region', { name: 'Ficheros de este paso' }).closest('.orq-t--output')).toBeTruthy();
    await userEvent.click(block.getByRole('button', { name: 'Ver specs/001/spec.md' }));
    expect(open).toHaveBeenCalledWith('specs/001/spec.md');
    await userEvent.click(screen.getByRole('tab', { name: 'Ficheros (1)' }));
    expect(screen.getByText(/Solo lo que tocó este paso/)).toBeTruthy();
    expect(screen.queryByText('Spec lista')).toBeNull();
    await userEvent.click(screen.getByRole('tab', { name: /^Conversación/ }));
    expect(screen.getByText('Spec lista')).toBeTruthy();
  });

  it('[R45.9] parado esperando permiso: «Ficheros tocados hasta ahora», aviso y «Ver … antes de decidir»', async () => {
    const events = run();
    const open = vi.fn();
    render(<NodePanel events={events} live={deriveLive(events)} nodeId="plan" nodePath={[]} label="Planificador" onAnswer={() => undefined} onOpenFile={open} />);
    const block = within(screen.getByRole('region', { name: 'Ficheros tocados hasta ahora' }));
    expect(block.getByText('El paso aún no ha terminado')).toBeTruthy();
    expect(block.getByText('specs/001/plan.md')).toBeTruthy();
    // Los ficheros recibidos del paso anterior no cuentan como suyos.
    expect(block.queryByText('specs/001/spec.md')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Ver README.md antes de decidir' }));
    expect(open).toHaveBeenCalledWith('README.md');
  });

  it('[R45.9] si la ejecución ya no sigue, el bloque dice «Sin terminar» y no ofrece ver antes de decidir', () => {
    const events = run();
    render(<NodePanel events={events} live={settleLive(deriveLive(events))} nodeId="plan" nodePath={[]} label="Planificador" onAnswer={() => undefined} onOpenFile={() => undefined} closed />);
    const block = within(screen.getByRole('region', { name: 'Ficheros tocados hasta ahora' }));
    expect(block.getByText(/^Sin terminar/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /antes de decidir/ })).toBeNull();
  });
});

describe('SPEC-045 · visor de ficheros', () => {
  it('[R45.10] muestra la lista, los cambios con la copia y el contenido; restaura y se cierra con Escape', async () => {
    seq = 0;
    const events = [ev(0, { type: 'file.produced', nodeId: 'plan', path: 'src/a.ts', change: 'modified' }), ev(1, { type: 'file.produced', nodeId: 'spec', path: 'docs/n.md', change: 'created' })];
    const api = createMemoryApi([], { backups: { r1: { 'src/a.ts': 'uno\ndos' } }, runFiles: { r1: { 'src/a.ts': 'uno\ntres', 'docs/n.md': '# Hola' } } });
    const close = vi.fn();
    render(<FileViewer api={api} runId="r1" events={events} path="src/a.ts" labelOf={label} onClose={close} />);
    const dlg = within(screen.getByRole('dialog', { name: 'src/a.ts' }));
    expect(await dlg.findByText('+1 −1 respecto a la copia de antes de la ejecución')).toBeTruthy();
    const diff = dlg.getByRole('list', { name: 'Cambios' });
    expect([...diff.querySelectorAll('li')].map((li) => li.className)).toEqual(['is-same', 'is-del', 'is-add']);
    const nav = within(dlg.getByRole('navigation', { name: 'Ficheros de la ejecución · 2' }));
    expect(nav.getByText(/Modificado · Planificador técnico/)).toBeTruthy();
    const spy = vi.spyOn(api, 'restoreBackup');
    await userEvent.click(dlg.getByRole('button', { name: 'Restaurar la copia' }));
    expect(spy).toHaveBeenCalledWith({ runId: 'r1', path: 'src/a.ts' });
    expect(await dlg.findByRole('button', { name: 'Restaurado' })).toBeTruthy();
    // Otro fichero: nuevo, sin copia, y su contenido en Markdown.
    await userEvent.click(nav.getByRole('button', { name: /docs\/n\.md/ }));
    expect(await screen.findByText('No hay copia de antes: se muestra entero como añadido.')).toBeTruthy();
    await userEvent.click(screen.getByRole('tab', { name: 'Contenido' }));
    expect(await screen.findByRole('heading', { name: 'Hola' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Restaurar la copia' })).toBeNull();
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'docs/n.md' }), { key: 'Escape' });
    expect(close).toHaveBeenCalled();
  });

  it('[R45.10] avisa si el fichero ya no existe o si no se puede abrir', async () => {
    seq = 0;
    const events = [ev(0, { type: 'file.produced', nodeId: 'plan', path: 'viejo.txt', change: 'modified' })];
    const api = createMemoryApi([], { backups: { r1: { 'viejo.txt': 'antes' } } });
    const { unmount } = render(<FileViewer api={api} runId="r1" events={events} path="viejo.txt" labelOf={label} onClose={() => undefined} />);
    expect(await screen.findByText('Este fichero ya no existe en la carpeta.')).toBeTruthy();
    unmount();
    render(<FileViewer api={api} runId="r1" events={events} path="otro.txt" labelOf={label} onClose={() => undefined} />);
    expect(await screen.findByRole('alert')).toBeTruthy();
  });

  it('[R45.12] «Archivos» dice quién tocó cada fichero, con «Ver» y «Restaurar» solo si hay copia', async () => {
    seq = 0;
    const events = [ev(0, { type: 'file.produced', nodeId: 'plan', path: 'src/a.ts' }), ev(1, { type: 'file.produced', nodeId: 'spec', path: 'docs/n.md', change: 'created' })];
    const api = createMemoryApi([], { backups: { r1: { 'src/a.ts': 'antes' } } });
    const open = vi.fn();
    render(<ProjectChanges api={api} runId="r1" finished events={events} labelOf={label} onOpen={open} />);
    const box = within(await screen.findByRole('region', { name: 'Cambios en la carpeta del proyecto' }));
    expect(await box.findByText('por Planificador técnico')).toBeTruthy();
    expect(box.getByText('por Especificador')).toBeTruthy();
    expect(await box.findByRole('button', { name: 'Restaurar src/a.ts' })).toBeTruthy();
    expect(box.queryByRole('button', { name: 'Restaurar docs/n.md' })).toBeNull();
    await userEvent.click(box.getByRole('button', { name: 'Ver docs/n.md' }));
    expect(open).toHaveBeenCalledWith('docs/n.md');
  });
});

describe('SPEC-045 · auditoría', () => {
  it('[R45.13] tabla de decisiones con filtros por grupo y exportación del informe y del JSON', async () => {
    seq = 0;
    const events = [
      ev(0, { type: 'node.started', nodeId: 'entry', input: { text: 'Landing', files: [] } }),
      ev(5, { type: 'agent.question', nodeId: 'spec', questionId: 'q-1', text: '¿Público?', kind: 'question' }),
      ev(6, { type: 'agent.answer', nodeId: 'spec', questionId: 'q-1', text: 'Equipos' }),
      ev(7, { type: 'agent.question', nodeId: 'plan', questionId: 'q-2', text: '¿Puedo ejecutar este comando?\nnpm test', kind: 'permission' }),
      ev(8, { type: 'agent.answer', nodeId: 'plan', questionId: 'q-2', text: 'Denegar' }),
      ev(9, { type: 'run.paused' }),
    ];
    const download = vi.fn();
    render(<AuditPanel runId="r1" events={events} labelOf={label} info={{ diagramName: 'Spec Kit', status: 'succeeded' }} onDownload={download} />);
    const box = within(screen.getByRole('region', { name: 'Auditoría de la ejecución' }));
    expect(box.getAllByRole('row')).toHaveLength(1 + 4);
    expect(box.getByText('Denegado')).toBeTruthy();
    expect(box.getByText('Planificador técnico')).toBeTruthy();
    await userEvent.click(box.getByRole('button', { name: 'Permisos · 1' }));
    expect(box.getAllByRole('row')).toHaveLength(2);
    expect(box.getByRole('button', { name: 'Permisos · 1' }).getAttribute('aria-pressed')).toBe('true');
    await userEvent.click(box.getByRole('button', { name: 'Confirmaciones · 0' }));
    expect(box.getByText('No hay decisiones de este tipo.')).toBeTruthy();
    await userEvent.click(box.getByRole('button', { name: /Exportar informe/ }));
    expect(download).toHaveBeenCalledWith('auditoria-r1.md', expect.stringContaining('# Auditoría · Spec Kit'), 'text/markdown');
    await userEvent.click(box.getByRole('button', { name: 'Exportar JSON' }));
    const json = JSON.parse(download.mock.calls[1]![1] as string) as { runId: string; entries: unknown[] };
    expect(json.runId).toBe('r1');
    expect(json.entries).toHaveLength(4);
  });

  it('[R45.13] sin decisiones, lo dice', () => {
    render(<AuditPanel runId="r1" events={[]} labelOf={label} info={{ diagramName: 'D', status: 'succeeded' }} onDownload={() => undefined} />);
    expect(screen.getByText('En esta ejecución no hubo decisiones tuyas.')).toBeTruthy();
  });
});

describe('SPEC-045 · cronograma y relato', () => {
  it('[R45.14] cabecera con la espera, esperas rayadas, rombos de ficheros, círculos de decisiones, casillas y zoom', async () => {
    const events = [...run(), ev(55, { type: 'agent.answer', nodeId: 'plan', questionId: 'q-1', text: 'Permitir' })];
    const tl = runTimeline(events, T0 + 60_000);
    const pick = vi.fn();
    const { container } = render(<Gantt timeline={tl} selected={undefined} label={label} onPick={pick} />);
    expect(screen.getByText('Duración 1 min · 15 s esperando tu respuesta')).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Leyenda del cronograma' })).toBeTruthy();
    const row = screen.getByRole('button', { name: /^Planificador técnico:/ });
    expect(row.querySelectorAll('.orq-gantt__wait')).toHaveLength(1);
    expect(row.querySelector('.orq-gantt__wait')!.getAttribute('title')).toBe('Esperando tu respuesta: 15 s');
    expect(row.querySelector('.orq-gantt__file')!.getAttribute('title')).toBe('Nuevo: specs/001/plan.md');
    expect(row.querySelector('.orq-gantt__dec')!.getAttribute('title')).toBe('Respondiste «Permitir» a «¿Puedo modificar README.md?»');
    expect(within(row).getByText('1 ficheros', { exact: false })).toBeTruthy();
    await userEvent.click(screen.getByLabelText('Ficheros'));
    expect(row.querySelector('.orq-gantt__file')).toBeNull();
    await userEvent.click(screen.getByLabelText('Tus decisiones'));
    expect(row.querySelector('.orq-gantt__dec')).toBeNull();
    // Zoom: «−» empieza apagado; «+» ensancha la pista y «Ajustar» la devuelve al ancho.
    const grid = container.querySelector('.orq-gantt2__grid') as HTMLElement;
    expect(grid.style.width).toBe('100%');
    expect((screen.getByRole('button', { name: 'Alejar' }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Acercar' }));
    expect(grid.style.width).toContain('1.5');
    expect(screen.getByRole('button', { name: 'Ajustar' }).getAttribute('aria-pressed')).toBe('false');
    await userEvent.click(screen.getByRole('button', { name: 'Ajustar' }));
    expect(grid.style.width).toBe('100%');
    await userEvent.click(row);
    expect(pick).toHaveBeenCalledWith('plan');
  });

  it('[R45.14] el eje tiene marcas regulares que se adaptan a la escala', () => {
    expect(axisTicks(60, 1)).toEqual([0, 10, 20, 30, 40, 50, 60]);
    expect(axisTicks(60, 2)).toEqual([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60]);
    expect(axisTicks(3600, 1)).toEqual([0, 600, 1200, 1800, 2400, 3000, 3600]);
  });

  it('[R45.15] el relato va en orden, filtra por clase (herramientas apagadas al entrar) y una línea abre su paso', async () => {
    const pick = vi.fn();
    render(<RunStory events={run()} label={label} onPick={pick} />);
    const box = within(screen.getByRole('region', { name: 'Relato de la ejecución' }));
    expect(box.getByText('Lanzaste la ejecución con: «Landing»')).toBeTruthy();
    expect(box.getByText('Creó specs/001/spec.md')).toBeTruthy();
    expect(box.queryByText('Usó Write')).toBeNull();
    await userEvent.click(box.getByLabelText('Herramientas'));
    expect(box.getByText('Usó Write')).toBeTruthy();
    await userEvent.click(box.getByLabelText('Ficheros'));
    expect(box.queryByText('Creó specs/001/spec.md')).toBeNull();
    await userEvent.click(box.getByRole('button', { name: 'Abrir el paso · Planificador técnico · Pide permiso: «¿Puedo modificar README.md?»' }));
    expect(pick).toHaveBeenCalledWith('plan');
    for (const c of ['Pasos', 'Decisiones', 'Herramientas']) await userEvent.click(box.getByLabelText(c));
    await waitFor(() => expect(box.getByText('Nada que contar con estos filtros.')).toBeTruthy());
  });
});
