// @vitest-environment jsdom
import './setup';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { questionNeedsModal, questionPreview } from '@orquestador/editor';
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

  it('[R78.3][R78.5] el modal: quién pregunta arriba, el texto entero, «Aprobar» y pedir cambios abajo; al responder se cierra', async () => {
    const onAnswer = vi.fn();
    render(<QuestionCard item={{ text: summary, options: ['Aprobar'], confirm: { round: 1 } }} from="Especificador" agent="Spec Writer" context="en Basico" onAnswer={onAnswer} />);
    await userEvent.click(screen.getByRole('button', { name: 'Revisar y responder' }));
    const modal = within(screen.getByRole('dialog', { name: 'Confirmar lo que ha hecho Especificador' }));
    expect(modal.getByText('agente Spec Writer · en Basico')).toBeTruthy();
    expect(modal.getByText('Punto 29:')).toBeTruthy();
    await userEvent.type(modal.getByRole('textbox'), 'Quita el punto 3');
    fireEvent.keyDown(modal.getByRole('textbox'), { key: 'Enter', ctrlKey: true });
    expect(onAnswer).toHaveBeenCalledWith('Quita el punto 3');
    expect(screen.queryByRole('dialog')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Revisar y responder' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Aprobar' }));
    expect(onAnswer).toHaveBeenLastCalledWith('Aprobar');
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
