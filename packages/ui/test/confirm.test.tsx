// @vitest-environment jsdom
import './setup';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RunEvent } from '@orquestador/core';
import { deriveLive, type LiveView } from '@orquestador/editor';
import { App } from '../src/App';
import { NodeDialog } from '../src/runs/NodeDialog';
import { NodePanel } from '../src/runs/NodePanel';
import { ResultsPanel } from '../src/runs/ResultsPanel';
import { QuestionCard } from '../src/runs/QuestionCard';
import { createMemoryApi } from '../src/memoryApi';

const AGENTS = [{ id: 'sprites', name: 'Sprites', description: 'Dibuja', model: 'claude-sonnet-5-5' }];
const ev = (seq: number, body: object): RunEvent => ({ runId: 'r', seq, ts: '2026-11-05T16:00:00Z', ...body }) as RunEvent;
const MD = '## Hecho\n\n- **index.html** creado';

const transcript = (extra: RunEvent[] = []): RunEvent[] => [
  ev(1, { type: 'node.started', nodeId: 'a', input: { text: '# Encargo', files: [] } }),
  ev(2, { type: 'agent.request', nodeId: 'a', agentId: 'sprites', attempt: 1, input: { text: '# Encargo', files: [] } }),
  ev(3, { type: 'token.stream', nodeId: 'a', text: 'Voy a **crear** la web' }),
  ev(4, { type: 'tool.called', nodeId: 'a', tool: 'Write', input: {} }),
  ev(5, { type: 'tool.result', nodeId: 'a', tool: 'Write', ok: true, output: '# no es markdown' }),
  ...extra,
];

describe('SPEC-043 · Markdown en los resultados', () => {
  it('[R43.1] el panel del paso dibuja en Markdown la entrada, el texto, las preguntas y la salida; las herramientas, en monoespaciado', () => {
    const events = transcript([
      ev(6, { type: 'agent.question', nodeId: 'a', questionId: 'q1', text: '¿Uso **rojo**?' }),
      ev(7, { type: 'agent.answer', nodeId: 'a', questionId: 'q1', text: 'sí' }),
      ev(8, { type: 'node.finished', nodeId: 'a', status: 'succeeded', output: { text: MD, files: [] } }),
    ]);
    const { container } = render(<NodePanel events={events} live={deriveLive(events)} nodeId="a" nodePath={[]} label="Sprites" onAnswer={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Encargo' })).toBeTruthy();
    expect(screen.getByText('crear', { selector: 'strong' })).toBeTruthy();
    expect(screen.getByText('rojo', { selector: 'strong' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Hecho' })).toBeTruthy();
    expect(screen.getByText('index.html', { selector: 'strong' })).toBeTruthy();
    expect(container.querySelector('pre')!.textContent).toBe('# no es markdown');
  });

  it('[R43.1] la ventana grande del paso y Resultados también; un .md se previsualiza en Markdown', async () => {
    const events = transcript([ev(6, { type: 'node.finished', nodeId: 'a', status: 'succeeded', output: { text: MD, files: [] } })]);
    const { unmount } = render(<NodeDialog events={events} live={deriveLive(events)} nodeId="a" nodePath={[]} label="Sprites" onAnswer={vi.fn()} onClose={vi.fn()} />);
    const dlg = within(screen.getByRole('dialog'));
    expect(dlg.getByRole('heading', { name: 'Encargo' })).toBeTruthy();
    expect(dlg.getByRole('heading', { name: 'Hecho' })).toBeTruthy();
    unmount();
    const live: LiveView = { ...deriveLive(events), status: 'succeeded', finalOutput: '## Final\n\nListo' };
    const api = {
      ...createMemoryApi(),
      listOutput: async () => ({ ok: true as const, value: [{ path: 'docs/plan.md', size: 10 }, { path: 'src/a.ts', size: 10 }] }),
      readOutput: async (req: { path: string }) => ({ ok: true as const, value: { text: req.path.endsWith('.md') ? '# Plan\n\n- uno' : '# no', truncated: false } }),
    };
    render(<ResultsPanel api={api as never} runId="r" live={live} labelOf={(x) => x} />);
    expect(screen.getByRole('heading', { name: 'Final' })).toBeTruthy();
    await userEvent.click(await screen.findByRole('button', { name: 'docs/plan.md' }));
    expect(await screen.findByRole('heading', { name: 'Plan' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'src/a.ts' }));
    await waitFor(() => expect(document.querySelector('[role="region"] pre')?.textContent).toBe('# no'));
  });
});

describe('SPEC-043 · confirmar antes de terminar (interfaz)', () => {
  const ask = (round = 1, answer?: string) =>
    transcript([
      ev(6, { type: 'agent.question', nodeId: 'a', questionId: `c${round}`, text: MD, options: ['Aprobar'], confirm: { round } }),
      ...(answer !== undefined ? [ev(7, { type: 'agent.answer', nodeId: 'a', questionId: `c${round}`, text: answer })] : []),
    ]);

  it('[R43.8] la tarjeta de confirmación muestra el resumen en Markdown, «Aprobar» y «Pedir cambios»', async () => {
    const onAnswer = vi.fn();
    const events = ask(2);
    render(<NodePanel events={events} live={deriveLive(events)} nodeId="a" nodePath={[]} label="Sprites" onAnswer={onAnswer} />);
    const card = within(screen.getByRole('listitem', { name: 'Revisa lo que ha hecho antes de seguir' }));
    expect(card.getByRole('heading', { name: 'Hecho' })).toBeTruthy();
    expect(card.getByText('Vuelta 2')).toBeTruthy();
    await userEvent.click(card.getByRole('button', { name: 'Aprobar' }));
    expect(onAnswer).toHaveBeenLastCalledWith('c2', 'Aprobar');
    expect((card.getByRole('button', { name: 'Enviar cambios' }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.type(card.getByLabelText('Pedir cambios'), 'Más grande');
    await userEvent.click(card.getByRole('button', { name: 'Enviar cambios' }));
    expect(onAnswer).toHaveBeenLastCalledWith('c2', 'Más grande');
  });

  it('[R43.8] ya respondida dice «Aprobado» o «Pediste cambios: …»', () => {
    const a = ask(1, 'Aprobar');
    const { unmount } = render(<NodePanel events={a} live={deriveLive(a)} nodeId="a" nodePath={[]} label="Sprites" onAnswer={vi.fn()} />);
    expect(screen.getByText('Aprobado')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Aprobar' })).toBeNull();
    unmount();
    const c = ask(1, 'Más grande');
    render(<NodePanel events={c} live={deriveLive(c)} nodeId="a" nodePath={[]} label="Sprites" onAnswer={vi.fn()} />);
    expect(screen.getByText('Pediste cambios: Más grande')).toBeTruthy();
  });

  it('[R43.8] en «Necesitan tu respuesta» dice qué se confirma y el resumen va en Markdown', async () => {
    const onAnswer = vi.fn();
    render(<QuestionCard item={{ text: MD, options: ['Aprobar'], confirm: { round: 1 } }} from="Sprites" onAnswer={onAnswer} />);
    const card = within(screen.getByRole('article', { name: 'Confirmar lo que ha hecho Sprites' }));
    expect(card.getByRole('heading', { name: 'Hecho' })).toBeTruthy();
    await userEvent.click(card.getByRole('button', { name: 'Aprobar' }));
    expect(onAnswer).toHaveBeenCalledWith('Aprobar');
  });

  it('[R43.3] el panel del paso tiene «Confirmar antes de terminar» y la tarjeta lo indica', async () => {
    render(<App initialProject="Juego" api={createMemoryApi()} agents={AGENTS} confirm={() => true} />);
    await userEvent.click(screen.getByRole('button', { name: '+ Agente' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Sprites/ }));
    const card = await screen.findByLabelText(/^Agente «sprites»/);
    const box = screen.getByRole('checkbox', { name: 'Confirmar antes de terminar' }) as HTMLInputElement;
    expect(box.checked).toBe(false);
    await userEvent.click(box);
    expect((screen.getByRole('checkbox', { name: 'Confirmar antes de terminar' }) as HTMLInputElement).checked).toBe(true);
    // El paso se llama como su agente: no se repite el nombre [R63.25].
    expect(within(card).getByText('confirma')).toBeTruthy();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Confirmar antes de terminar' }));
    expect(within(card).queryByText('confirma')).toBeNull();
  });
});
