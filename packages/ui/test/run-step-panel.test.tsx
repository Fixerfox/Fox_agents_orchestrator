// @vitest-environment jsdom
import './setup';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RunEvent } from '@orquestador/core';
import { deriveLive } from '@orquestador/editor';
import { FoldedStep, NodePanel } from '../src/runs/NodePanel';

let seq = 0;
const ev = (body: object, ts = '2026-11-08T10:00:00.000Z'): RunEvent => ({ runId: 'r', seq: ++seq, ts, ...body }) as RunEvent;
const finished = () => [
  ev({ type: 'node.started', nodeId: 'rev' }, '2026-11-08T10:00:00.000Z'),
  ev({ type: 'agent.request', nodeId: 'rev', agentId: 'revisor', attempt: 1, input: { text: 'Revisa lo hecho', files: [] } }),
  ev({ type: 'token.stream', nodeId: 'rev', text: 'Ejecuto los tests…' }),
  ev({ type: 'agent.usage', nodeId: 'rev', inputTokens: 4200, outputTokens: 1042, costUsd: 0.041 }),
  ev({ type: 'node.finished', nodeId: 'rev', status: 'succeeded', output: { text: 'El build pasa y los **64 tests** pasan.', files: [] } }, '2026-11-08T10:01:12.000Z'),
];
const panel = () => within(screen.getByRole('region', { name: 'Ejecución de «Revisión»' }));

describe('SPEC-068 · panel del paso en ejecución', () => {
  it('[R68.1] cabecera con el paso, tarjeta de estado con duración, tokens y coste, y «Plegar el panel»', async () => {
    const events = finished();
    const onFold = vi.fn();
    render(<NodePanel events={events} live={deriveLive(events)} nodeId="rev" nodePath={[]} label="Revisión" onAnswer={vi.fn()} closed onFold={onFold} />);
    expect(panel().getByRole('heading', { name: 'Revisión' })).toBeTruthy();
    const card = document.querySelector('.orq-stepstate')!;
    expect(card.classList.contains('is-ok')).toBe(true);
    expect(card.textContent).toContain('correcto');
    expect(card.textContent).toContain('1 min 12 s');
    expect(card.textContent).toContain('5242 tokens'.replace('5242', (5242).toLocaleString('es-ES')));
    expect(card.textContent).toContain('0,041 $');
    await userEvent.click(panel().getByRole('button', { name: 'Plegar el panel' }));
    expect(onFold).toHaveBeenCalled();
  });

  it('[R68.2] con salida se abre en «Resumen»; «Conversación» tiene la transcripción', async () => {
    const events = finished();
    render(<NodePanel events={events} live={deriveLive(events)} nodeId="rev" nodePath={[]} label="Revisión" onAnswer={vi.fn()} closed />);
    expect(panel().getByRole('tab', { name: 'Resumen', selected: true })).toBeTruthy();
    expect(panel().getByText('64 tests')).toBeTruthy();
    expect(panel().queryByText('Ejecuto los tests…')).toBeNull();
    await userEvent.click(panel().getByRole('button', { name: /Ver la conversación completa/ }));
    expect(panel().getByRole('tab', { name: /^Conversación \(\d+\)$/, selected: true })).toBeTruthy();
    expect(panel().getByText('Ejecuto los tests…')).toBeTruthy();
  });

  it('[R68.2] sin salida, o con una pregunta pendiente, se abre en «Conversación»', () => {
    const working = [ev({ type: 'node.started', nodeId: 'rev' }), ev({ type: 'agent.request', nodeId: 'rev', agentId: 'revisor', attempt: 1, input: { text: 'Revisa', files: [] } })];
    const { unmount } = render(<NodePanel events={working} live={deriveLive(working)} nodeId="rev" nodePath={[]} label="Revisión" onAnswer={vi.fn()} />);
    expect(panel().getByRole('tab', { name: /^Conversación/, selected: true })).toBeTruthy();
    expect(document.querySelector('.orq-stepstate')!.classList.contains('is-busy')).toBe(true);
    unmount();
    const asking = [...finished(), ev({ type: 'agent.question', nodeId: 'rev', questionId: 'q1', text: '¿Sigo?' })];
    render(<NodePanel events={asking} live={deriveLive(asking)} nodeId="rev" nodePath={[]} label="Revisión" onAnswer={vi.fn()} />);
    expect(panel().getByRole('tab', { name: /^Conversación/, selected: true })).toBeTruthy();
  });

  it('[R68.3] plegado es una franja «Desplegar el panel» con estado, nombre y coste que lo despliega', async () => {
    const events = finished();
    function Side() {
      const [folded, setFolded] = useState(true);
      return folded ? <FoldedStep events={events} live={deriveLive(events)} nodeId="rev" nodePath={[]} label="Revisión" onUnfold={() => setFolded(false)} /> : <NodePanel events={events} live={deriveLive(events)} nodeId="rev" nodePath={[]} label="Revisión" onAnswer={vi.fn()} closed onFold={() => setFolded(true)} />;
    }
    render(<Side />);
    const strip = screen.getByRole('button', { name: 'Desplegar el panel' });
    expect(strip.classList.contains('is-ok')).toBe(true);
    expect(strip.textContent).toContain('Revisión');
    expect(strip.textContent).toContain('0,041 $');
    await userEvent.click(strip);
    expect(panel().getByRole('button', { name: 'Plegar el panel' })).toBeTruthy();
    await userEvent.click(panel().getByRole('button', { name: 'Plegar el panel' }));
    expect(screen.getByRole('button', { name: 'Desplegar el panel' })).toBeTruthy();
  });

  it('[R68.5] las barras de scroll son finas, redondeadas, con pista transparente y colores del tema', () => {
    const css = readFileSync(join(__dirname, '..', 'src', 'styles.css'), 'utf8');
    expect(css).toMatch(/::-webkit-scrollbar \{ width: 10px; height: 10px; \}/);
    expect(css).toMatch(/::-webkit-scrollbar-track, ::-webkit-scrollbar-corner \{ background: transparent; \}/);
    expect(css).toMatch(/::-webkit-scrollbar-thumb \{ background-color: color-mix\(in srgb, var\(--text2\)[^}]*border-radius: 999px/);
    // sin scrollbar-color/scrollbar-width, que en Chromium anularían ::-webkit-scrollbar
    expect(css).not.toMatch(/scrollbar-(color|width)\s*:/);
  });
});
