import { describe, expect, it } from 'vitest';
import { CHANNELS, ContractError, parseRequest, questionGroup } from '../src';

describe('SPEC-053 · contrato de corrección', () => {
  it('[R53.12] valida los argumentos de «proposeCorrection» y «correctRun»', () => {
    expect(CHANNELS.proposeCorrection).toBe('run:correct-propose');
    expect(CHANNELS.correctRun).toBe('run:correct');
    expect(parseRequest(CHANNELS.proposeCorrection, { runId: 'r1', text: 'mal', prefer: 'a' })).toBeTruthy();
    expect(() => parseRequest(CHANNELS.proposeCorrection, { runId: '../x', text: 'mal' })).toThrow(ContractError);
    expect(() => parseRequest(CHANNELS.proposeCorrection, { runId: 'r1', text: 'mal', otro: 1 })).toThrow(ContractError);
    expect(parseRequest(CHANNELS.correctRun, { runId: 'r1', text: 'mal', nodeId: 'a', files: ['x.md'] })).toBeTruthy();
    expect(() => parseRequest(CHANNELS.correctRun, { runId: 'r1', text: '', nodeId: 'a' })).toThrow(ContractError);
    expect(() => parseRequest(CHANNELS.correctRun, { runId: 'r1', text: 'mal' })).toThrow(ContractError);
    expect(() => parseRequest(CHANNELS.correctRun, { runId: 'r1', text: 'mal', nodeId: 'a', files: Array.from({ length: 21 }, () => 'x') })).toThrow(ContractError);
  });

  it('[R53.15] la auditoría cuenta las preguntas de una revisión humana como confirmaciones', () => {
    expect(questionGroup({ text: 'x', review: { round: 1, max: 3, phase: 'feedback' } })).toBe('confirm');
    expect(questionGroup({ text: 'x', review: { round: 1, max: 3, phase: 'route' } })).toBe('confirm');
  });
});
