import { describe, expect, it } from 'vitest';
import type { RunEvent } from '@orquestador/core';
import { CHANNELS, ContractError, parseRequest, summarizeRun } from '../src';

const ev = (seq: number, body: Record<string, unknown>) => ({ runId: 'r', seq, ts: `2026-11-07T10:00:0${seq}.000Z`, ...body }) as RunEvent;
const failed = [
  ev(1, { type: 'run.started', diagramId: 'd' }),
  ev(2, { type: 'supervisor.verified', met: false, detail: 'Falta medir 30 minutos' }),
  ev(3, { type: 'run.finished', status: 'failed', reason: 'No cumple lo pedido: Falta medir 30 minutos' }),
];

describe('SPEC-065 · contrato y resumen', () => {
  it('[R65.6] run:accept valida runId, quién y el motivo', () => {
    expect(CHANNELS.acceptRun).toBe('run:accept');
    expect(parseRequest(CHANNELS.acceptRun, { runId: 'r1', by: 'user', reason: 'vale' })).toEqual({ runId: 'r1', by: 'user', reason: 'vale' });
    expect(() => parseRequest(CHANNELS.acceptRun, { runId: '../x', by: 'user', reason: 'vale' })).toThrow(ContractError);
    expect(() => parseRequest(CHANNELS.acceptRun, { runId: 'r1', by: 'otro', reason: 'vale' })).toThrow(ContractError);
    expect(() => parseRequest(CHANNELS.acceptRun, { runId: 'r1', by: 'user', reason: '' })).toThrow(ContractError);
    expect(() => parseRequest(CHANNELS.acceptRun, { runId: 'r1', by: 'user', reason: 'x'.repeat(2001) })).toThrow(ContractError);
    expect(() => parseRequest(CHANNELS.acceptRun, { runId: 'r1', by: 'user', reason: 'vale', extra: 1 })).toThrow(ContractError);
  });

  it('[R65.7] una aceptada cuenta como terminada bien, dice quién la aceptó y por qué había fallado', () => {
    const s = summarizeRun([...failed, ev(4, { type: 'run.accepted', by: 'user', reason: 'La medición la hago yo', previousReason: 'No cumple lo pedido: Falta medir 30 minutos' })], (n) => n);
    expect(s.status).toBe('succeeded');
    expect(s.accepted).toEqual({ by: 'user', reason: 'La medición la hago yo', previousReason: 'No cumple lo pedido: Falta medir 30 minutos' });
    expect(s.headline).toBe('Aceptada por ti: La medición la hago yo');
    const byAssistant = summarizeRun([...failed, ev(4, { type: 'run.accepted', by: 'assistant', reason: 'Lo pidió la persona' })], (n) => n);
    expect(byAssistant.headline).toBe('Aceptada por el asistente: Lo pidió la persona');
  });

  it('[R65.4] terminada con algo para una persona: el titular lo dice y el Supervisor lo guarda', () => {
    const s = summarizeRun(
      [ev(1, { type: 'run.started', diagramId: 'd' }), ev(2, { type: 'supervisor.verified', met: true, detail: '', forPerson: 'Medir los 30 minutos' }), ev(3, { type: 'run.finished', status: 'succeeded' })],
      (n) => n,
    );
    expect(s.status).toBe('succeeded');
    expect(s.supervisor?.final).toEqual({ met: true, detail: '', forPerson: 'Medir los 30 minutos' });
    expect(s.headline).toMatch(/^Terminada · te toca comprobar algo/);
  });
});
