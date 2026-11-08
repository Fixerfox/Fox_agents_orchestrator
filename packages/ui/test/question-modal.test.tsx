// @vitest-environment jsdom
import './setup';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RunEvent } from '@orquestador/core';
import { questionNeedsModal, questionPreview, stepFacts } from '@orquestador/editor';
import { QuestionCard } from '../src/runs/QuestionCard';

const summary = ['## Resumen para confirmar', '', ...Array.from({ length: 30 }, (_, i) => `- **Punto ${i}:** creé \`specs/00${i}.md\``)].join('\n');

describe('SPEC-078 · aprobaciones largas en un modal', () => {
  it('[R78.1] van en modal las confirmaciones, las revisiones y las preguntas largas', () => {
    expect(questionNeedsModal({ text: 'corta', confirm: { round: 1 } })).toBe(true);
    expect(questionNeedsModal({ text: 'corta', review: { phase: 'feedback' } })).toBe(true);
    expect(questionNeedsModal({ text: 'x'.repeat(601) })).toBe(true);
    expect(questionNeedsModal({ text: Array.from({ length: 9 }, () => 'l').join('\n') })).toBe(true);
    expect(questionNeedsModal({ text: '¿Pixel art o vectorial?' })).toBe(false);
  });

  it('[R78.2] una así es una línea: qué se pide, el agente, el principio sin Markdown y «Revisar y responder»', () => {
    expect(questionPreview('## Hola\n- **uno** `a.md`', 160)).toBe('Hola uno a.md');
    expect(questionPreview('x'.repeat(300), 20)).toHaveLength(20);
    render(<QuestionCard item={{ text: summary, options: ['Aprobar'], confirm: { round: 1 } }} from="Especificador" agent="Spec Writer" onAnswer={vi.fn()} />);
    const card = within(screen.getByRole('article', { name: 'Confirmar lo que ha hecho Especificador' }));
    expect(card.getByText('agente Spec Writer')).toBeTruthy();
    expect(card.getByText(/^Resumen para confirmar Punto 0/)).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(card.getByRole('button', { name: 'Revisar y responder' })).toBeTruthy();
  });

  it('[R78.3][R78.5][R78.8] el modal: qué se revisa y quién arriba, el texto entero, «Aprobar» destacado y «Pedir cambios»; al responder se cierra', async () => {
    const onAnswer = vi.fn();
    render(<QuestionCard item={{ text: summary, options: ['Aprobar'], confirm: { round: 2 } }} from="Especificador" agent="Spec Writer" context="en Basico" onAnswer={onAnswer} />);
    await userEvent.click(screen.getByRole('button', { name: 'Revisar y responder' }));
    const modal = within(screen.getByRole('dialog', { name: 'Confirmar lo que ha hecho Especificador' }));
    expect(modal.getByText('Confirmación · ronda 2')).toBeTruthy();
    expect(modal.getByText('La ejecución espera tu respuesta')).toBeTruthy();
    expect(modal.getByText('agente Spec Writer · en Basico')).toBeTruthy();
    expect(modal.getByText('Punto 29:')).toBeTruthy();
    // Pedir cambios despliega el cuadro con lo que pasará.
    expect(modal.queryByRole('textbox')).toBeNull();
    await userEvent.click(modal.getByRole('button', { name: 'Pedir cambios' }));
    expect(modal.getByText(/El paso se repite con lo que escribas/)).toBeTruthy();
    expect(modal.getByRole('button', { name: 'Enviar cambios' }).hasAttribute('disabled')).toBe(true);
    await userEvent.type(modal.getByRole('textbox', { name: 'Qué hay que cambiar' }), 'Quita el punto 3');
    fireEvent.keyDown(modal.getByRole('textbox'), { key: 'Enter', ctrlKey: true });
    expect(onAnswer).toHaveBeenCalledWith('Quita el punto 3');
    expect(screen.queryByRole('dialog')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Revisar y responder' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Aprobar' }));
    expect(onAnswer).toHaveBeenLastCalledWith('Aprobar');
  });

  it('[R78.7] al lado, lo que hizo el paso según los eventos: archivos que se abren, gasto y avisos', async () => {
    let seq = 0;
    const at = (s: number) => new Date(Date.parse('2026-11-08T10:00:00.000Z') + s * 1000).toISOString();
    const ev = (s: number, b: object) => ({ runId: 'r', seq: ++seq, ts: at(s), ...b }) as RunEvent;
    const events = [
      ev(0, { type: 'node.started', nodeId: 'a' }),
      ev(1, { type: 'file.produced', nodeId: 'a', path: 'specs/003/spec.md', change: 'created' }),
      ev(2, { type: 'file.produced', nodeId: 'a', path: '.specify/feature.json', change: 'modified' }),
      ev(3, { type: 'file.produced', nodeId: 'a', path: 'build/out.txt', via: 'command' }),
      ev(4, { type: 'file.produced', nodeId: 'b', path: 'otro.md', change: 'created' }),
      ev(5, { type: 'agent.usage', nodeId: 'a', inputTokens: 100, outputTokens: 20, costUsd: 0.25 }),
      ev(6, { type: 'agent.usage', nodeId: 'a', inputTokens: 5, outputTokens: 5, costUsd: 0.01, source: 'supervisor' }),
      ev(7, { type: 'supervisor.alert', nodeId: 'a', rule: 'undeclared-file', severity: 'warning', detail: 'Tocó .specify/feature.json' }),
      ev(80, { type: 'agent.question', nodeId: 'a', questionId: 'q', text: 'x', confirm: { round: 1 } }),
    ];
    const facts = stepFacts(events, 'a', []);
    expect(facts).toEqual({
      files: [
        { path: '.specify/feature.json', change: 'modified' },
        { path: 'build/out.txt', change: 'command' },
        { path: 'specs/003/spec.md', change: 'created' },
      ],
      tokens: 120,
      costUsd: 0.25,
      durationMs: 80_000,
      alerts: ['Tocó .specify/feature.json'],
    });
    const onOpenFile = vi.fn();
    render(<QuestionCard item={{ text: summary, options: ['Aprobar'], confirm: { round: 1 } }} from="Especificador" facts={facts} onOpenFile={onOpenFile} autoOpen onAnswer={vi.fn()} />);
    const side = within(screen.getByRole('complementary', { name: 'Lo que hizo el paso' }));
    expect(side.getByText('Archivos que tocó (3)')).toBeTruthy();
    expect(side.getByText('nuevo')).toBeTruthy();
    expect(side.getByText('por un comando')).toBeTruthy();
    expect(side.getByText(/7472|120 tokens/)).toBeTruthy();
    expect(side.getByText('Tocó .specify/feature.json')).toBeTruthy();
    await userEvent.click(side.getByRole('button', { name: /spec\.md/ }));
    expect(onOpenFile).toHaveBeenCalledWith('specs/003/spec.md');
  });

  it('[R78.4] en la ejecución se abre solo; cerrarlo no responde', async () => {
    const onAnswer = vi.fn();
    render(<QuestionCard item={{ text: summary, options: ['Aprobar'], confirm: { round: 1 } }} from="Especificador" autoOpen onAnswer={onAnswer} />);
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onAnswer).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Revisar y responder' })).toBeTruthy();
  });

  it('[R78.6] las cortas siguen en su tarjeta', async () => {
    const onAnswer = vi.fn();
    render(<QuestionCard item={{ text: '¿Pixel art o vectorial?', options: ['Pixel art', 'Vectorial'] }} from="Pintor" autoOpen onAnswer={onAnswer} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Vectorial' }));
    expect(onAnswer).toHaveBeenCalledWith('Vectorial');
  });
});
