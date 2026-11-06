// @vitest-environment jsdom
import './setup';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Diagram, RunEvent } from '@orquestador/core';
import { CHANNELS, ContractError, EMPTY_LIVE, deriveLive, filesByStep, filesSinceReview, parseRequest, type RunSummary } from '@orquestador/editor';
import { NodePanel } from '../src/runs/NodePanel';
import { shortNames } from '../src/diagrams/OrqNode';
import { PreviewDialog } from '../src/runs/Preview';
import { RunsScreen } from '../src/runs/RunsScreen';
import { createMemoryApi } from '../src/memoryApi';
import type { RunsIndex } from '../src/runs/useRunsIndex';

/** Entrada → Planificador → Implementador → Salida. */
const D: Diagram = {
  id: 'web',
  name: 'Web',
  schemaVersion: 1,
  nodes: [
    { id: 'entry', kind: 'entry', label: 'Entrada', position: { x: 0, y: 0 } },
    { id: 'plan', kind: 'agent', agentId: 'plan', label: 'Planificador técnico', position: { x: 200, y: 0 } },
    { id: 'imp', kind: 'agent', agentId: 'imp', label: 'Implementador', position: { x: 400, y: 0 } },
    { id: 'output', kind: 'output', label: 'Salida', position: { x: 600, y: 0 } },
  ],
  edges: [
    { id: 'e1', from: 'entry', to: 'plan' },
    { id: 'e2', from: 'plan', to: 'imp' },
    { id: 'e3', from: 'imp', to: 'output' },
  ],
};
let seq = 0;
const ev = (body: Record<string, unknown>, runId = 'r1') => ({ runId, seq: ++seq, ts: '2026-11-05T21:00:00.000Z', ...body }) as unknown as RunEvent;
const EVENTS: RunEvent[] = [
  ev({ type: 'run.started', diagramId: 'web' }),
  ev({ type: 'node.started', nodeId: 'entry', input: { text: 'Haz la web', files: [] } }),
  ev({ type: 'node.finished', nodeId: 'entry', status: 'succeeded', output: { text: 'Haz la web', files: [] } }),
  ev({ type: 'node.started', nodeId: 'plan' }),
  ev({ type: 'file.produced', nodeId: 'plan', path: 'specs/003/plan.md', change: 'created' }),
  ev({ type: 'node.finished', nodeId: 'plan', status: 'succeeded', output: { text: 'plan', files: ['specs/003/plan.md'] } }),
  ev({ type: 'node.started', nodeId: 'imp' }),
  ev({ type: 'file.produced', nodeId: 'imp', path: 'web/herramientas.html', change: 'modified' }),
  ev({ type: 'file.produced', nodeId: 'imp', path: 'web/img/hero.png', change: 'created' }),
  ev({ type: 'file.produced', nodeId: 'imp', path: 'web/styles.css', change: 'modified' }),
  ev({ type: 'file.produced', nodeId: 'imp', path: 'web/herramientas.html', change: 'created' }),
  ev({ type: 'node.finished', nodeId: 'imp', status: 'succeeded', output: { text: 'hecho', files: [] } }),
  ev({ type: 'node.started', nodeId: 'output' }),
  ev({ type: 'node.finished', nodeId: 'output', status: 'succeeded', output: { text: 'hecho', files: [] } }),
  ev({ type: 'run.finished', status: 'succeeded' }),
];
const SUMMARY: RunSummary = { runId: 'r1', diagramId: 'web', status: 'succeeded', startedAt: '2026-11-05T21:00:00.000Z', finishedAt: '2026-11-05T21:01:00.000Z', usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 }, eventCount: EVENTS.length, order: 'Haz la web' };
const PNG = 'data:image/png;base64,iVBORw==';
const apiWith = () =>
  createMemoryApi([D], {
    pastRuns: [{ summary: SUMMARY, events: EVENTS, diagram: D }],
    outputs: { 'specs/003/plan.md': '# Plan técnico', 'web/herramientas.html': '<h1>Herramientas</h1>' },
    previews: { 'r1|imp|web/img/hero.png': { path: 'web/img/hero.png', kind: 'image', source: 'run', dataUrl: PNG } },
  });

function screenRun(api = apiWith()) {
  const index: RunsIndex = { runs: [SUMMARY], diagramNames: { web: 'Web' }, pending: [], queue: [], loaded: true, refresh: vi.fn() };
  render(<RunsScreen api={api} main={{ version: 0, events: [], live: EMPTY_LIVE }} index={index} nav={{ section: 'history', runId: 'r1' }} onNav={vi.fn()} subOpen onToggleSub={vi.fn()} onControlMain={vi.fn()} onAnswerMain={vi.fn()} agentNames={{}} onExport={vi.fn()} />);
  return api;
}

describe('SPEC-054 · fichas de archivos debajo de cada paso', () => {
  it('[R54.1] filesByStep agrupa por paso, sin repetir y con el cambio acumulado', () => {
    expect(filesByStep(EVENTS)).toEqual({
      plan: [{ path: 'specs/003/plan.md', change: 'created' }],
      imp: [
        { path: 'web/herramientas.html', change: 'created' },
        { path: 'web/img/hero.png', change: 'created' },
        { path: 'web/styles.css', change: 'modified' },
      ],
    });
  });

  it('[R54.1][R54.2] las fichas cuelgan del paso; «+N» despliega; una ficha abre su vista previa junto al nodo y «Ampliar» la abre en grande', async () => {
    screenRun();
    const plan = within(await screen.findByRole('list', { name: 'Archivos de «Planificador técnico»' }, { timeout: 4000 }));
    expect(plan.getAllByRole('listitem').map((b) => b.textContent)).toEqual(['plan.md']);
    const imp = within(screen.getByRole('list', { name: 'Archivos de «Implementador»' }));
    expect(imp.getAllByRole('listitem').map((b) => b.textContent)).toEqual(['herramientas.html', 'hero.png']);
    expect(imp.getByRole('listitem', { name: 'Abrir web/img/hero.png' }).className).toContain('is-image');
    expect(imp.getByRole('listitem', { name: 'Abrir web/herramientas.html' }).className).toContain('is-web');
    await userEvent.click(imp.getByRole('button', { name: 'Ver 1 archivos más' }));
    expect(imp.getAllByRole('listitem').map((b) => b.textContent)).toEqual(['herramientas.html', 'hero.png', 'styles.css']);
    // Desplegado, «Ocultar» vuelve a plegar.
    await userEvent.click(imp.getByRole('button', { name: 'Ocultar archivos' }));
    expect(imp.getAllByRole('listitem')).toHaveLength(2);
    expect(imp.getByRole('button', { name: 'Ver 1 archivos más' })).toBeTruthy();
    expect(shortNames(['web/index.html', 'web/es/index.html', 'docs/plan.md'])).toEqual(new Map([['web/index.html', 'web/index.html'], ['web/es/index.html', 'es/index.html'], ['docs/plan.md', 'plan.md']]));
    expect(screen.queryByRole('list', { name: 'Archivos de «Entrada»' })).toBeNull();
    // Tarjeta junto al nodo con la imagen ya mostrada.
    await userEvent.click(imp.getByRole('listitem', { name: 'Abrir web/img/hero.png' }));
    const card = within(screen.getByRole('region', { name: 'Vista previa de web/img/hero.png' }));
    expect(((await card.findByRole('img', { name: 'Vista previa de hero.png' })) as HTMLImageElement).src).toBe(PNG);
    // Otra pulsación la cierra; la de la web enseña la página en un marco aislado.
    await userEvent.click(imp.getByRole('listitem', { name: 'Abrir web/img/hero.png' }));
    expect(screen.queryByRole('region', { name: 'Vista previa de web/img/hero.png' })).toBeNull();
    await userEvent.click(imp.getByRole('listitem', { name: 'Abrir web/herramientas.html' }));
    const web = within(screen.getByRole('region', { name: 'Vista previa de web/herramientas.html' }));
    await waitFor(() => expect(web.getByTitle('Vista previa de herramientas.html').getAttribute('sandbox')).toBe('allow-scripts'));
    await userEvent.click(web.getByRole('button', { name: 'Ampliar' }));
    expect(await screen.findByRole('dialog', { name: 'Implementador · vista previa' })).toBeTruthy();
  });
});

describe('SPEC-054 · vista previa en grande', () => {
  it('[R54.5] una pestaña por archivo, escritorio o móvil en las webs, comparar con la anterior, ver cambios, abrir fuera y pedir corrección', async () => {
    const api = apiWith();
    const opened = vi.spyOn(api, 'openPreview');
    const onChanges = vi.fn();
    const onCorrect = vi.fn();
    render(
      <PreviewDialog
        api={api}
        runId="r1"
        stepKey="imp"
        label="Implementador"
        files={filesByStep(EVENTS)['imp']!}
        initial="web/herramientas.html"
        compareRunId="r1"
        onClose={vi.fn()}
        onChanges={onChanges}
        onCorrect={onCorrect}
      />,
    );
    const dlg = within(screen.getByRole('dialog', { name: 'Implementador · vista previa' }));
    expect(dlg.getAllByRole('tab').map((x) => x.textContent)).toEqual(['herramientas.html', 'hero.png', 'styles.css']);
    expect(dlg.getByRole('tab', { name: 'herramientas.html' }).getAttribute('aria-selected')).toBe('true');
    const frame = await dlg.findByTitle('Vista previa de herramientas.html');
    expect(frame.closest('.orq-prev__frame')!.className).toContain('is-desktop');
    await userEvent.click(dlg.getByRole('button', { name: 'Móvil' }));
    expect(dlg.getByTitle('Vista previa de herramientas.html').closest('.orq-prev__frame')!.className).toContain('is-mobile');
    await userEvent.click(dlg.getByRole('button', { name: 'Comparar con la anterior' }));
    expect(dlg.getByText('Esta ejecución')).toBeTruthy();
    expect(dlg.getByText('Ejecución anterior')).toBeTruthy();
    await userEvent.click(dlg.getByRole('tab', { name: 'hero.png' }));
    expect(dlg.queryByRole('button', { name: 'Móvil' })).toBeNull();
    expect((await dlg.findAllByRole('img', { name: 'Vista previa de hero.png' })).length).toBe(2);
    await userEvent.click(dlg.getByRole('button', { name: 'Abrir fuera' }));
    expect(opened).toHaveBeenCalledWith({ runId: 'r1', key: 'imp', path: 'web/img/hero.png' });
    await userEvent.click(dlg.getByRole('button', { name: 'Ver cambios' }));
    expect(onChanges).toHaveBeenCalledWith('web/img/hero.png');
    await userEvent.click(dlg.getByRole('button', { name: 'Pedir corrección' }));
    expect(onCorrect).toHaveBeenCalled();
    // Sin copia en ningún sitio, lo dice.
    await userEvent.click(dlg.getByRole('tab', { name: 'styles.css' }));
    expect((await dlg.findAllByText(/ya no está y no hay copia/)).length).toBeGreaterThan(0);
  });

  it('[R54.4] el contrato valida la ejecución, la clave del paso y la ruta', () => {
    expect(parseRequest(CHANNELS.previewFile, { runId: 'r1', key: 'bucle/imp', path: 'web/index.html' })).toBeTruthy();
    expect(() => parseRequest(CHANNELS.previewFile, { runId: 'r1', key: 'imp', path: '../fuera.html' })).toThrow(ContractError);
    expect(() => parseRequest(CHANNELS.previewFile, { runId: 'r1', key: 'imp', path: '/etc/passwd' })).toThrow(ContractError);
    expect(() => parseRequest(CHANNELS.openPreview, { runId: 'r1', key: '../x', path: 'a.md' })).toThrow(ContractError);
    expect(() => parseRequest(CHANNELS.openPreview, { runId: 'r1', key: 'imp', path: 'a.md', otro: 1 })).toThrow(ContractError);
  });
});

describe('SPEC-054 · miniaturas en la revisión humana', () => {
  it('[R54.6] la tarjeta «Revisa antes de seguir» enseña lo que hicieron los pasos desde la revisión anterior', async () => {
    seq = 100;
    const events: RunEvent[] = [
      ev({ type: 'file.produced', nodeId: 'imp', path: 'web/viejo.html', change: 'created' }),
      ev({ type: 'review.decided', nodeId: 'rev', round: 1, max: 3, verdict: 'rejected', source: 'human', returnTo: 'imp' }),
      ev({ type: 'file.produced', nodeId: 'imp', path: 'web/herramientas.html', change: 'modified' }),
      ev({ type: 'file.produced', nodeId: 'imp', path: 'web/img/hero.png', change: 'created' }),
      ev({ type: 'file.produced', nodeId: 'imp', path: 'web/herramientas.html', change: 'modified' }),
      ev({ type: 'node.started', nodeId: 'rev', input: { text: '## Hecho', files: [] } }),
      ev({ type: 'agent.question', nodeId: 'rev', questionId: 'q-2', text: '## Hecho', options: ['Aprobar'], review: { round: 2, max: 3, phase: 'feedback' } }),
    ];
    expect(filesSinceReview(events, 'rev', [], 'q-2')).toEqual([
      { key: 'imp', path: 'web/herramientas.html' },
      { key: 'imp', path: 'web/img/hero.png' },
    ]);
    const onPreview = vi.fn();
    render(<NodePanel events={events} live={deriveLive(events)} nodeId="rev" nodePath={[]} label="Revisión humana" onAnswer={vi.fn()} onPreview={onPreview} renderThumb={(key, path) => <i data-testid="thumb">{`${key}:${path}`}</i>} />);
    const list = within(screen.getByRole('list', { name: 'Lo que han hecho desde la última revisión' }));
    expect(list.getAllByTestId('thumb').map((x) => x.textContent)).toEqual(['imp:web/herramientas.html', 'imp:web/img/hero.png']);
    await userEvent.click(list.getByRole('listitem', { name: 'Abrir web/img/hero.png' }));
    expect(onPreview).toHaveBeenCalledWith('imp', 'web/img/hero.png');
  });
});
