import { describe, expect, it } from 'vitest';
import type { RunEvent } from '@orquestador/core';
import { ASSISTANT_TOOLS, CHANNELS, ContractError, deriveLive, memoryProposalsOf, parseRequest } from '../src';

let seq = 0;
const ev = (b: object): RunEvent => ({ runId: 'r1', seq: ++seq, ts: '2026-11-08T10:00:00.000Z', ...b }) as RunEvent;

describe('SPEC-076 · contrato y vistas', () => {
  it('[R76.10][R76.11] las propuestas de una ejecución con lo que se decidió de cada una', () => {
    const events = [
      ev({ type: 'run.finished', status: 'succeeded' }),
      ev({ type: 'memory.proposed', proposals: [{ id: 'p1', action: 'add', kind: 'lesson', scope: 'project', title: 'a', text: 'a', origin: 'retry' }, { id: 'p2', action: 'add', kind: 'lesson', scope: 'project', title: 'b', text: 'b', origin: 'retry' }] }),
      ev({ type: 'memory.decided', proposalId: 'p1', decision: 'save', edited: true, by: 'user' }),
    ];
    expect(memoryProposalsOf(events).map((p) => [p.id, p.decision, p.edited])).toEqual([
      ['p1', 'save', true],
      ['p2', undefined, undefined],
    ]);
  });

  it('[R76.8] memory.proposed llega después de run.finished y no cambia el estado de la ejecución', () => {
    const events = [ev({ type: 'run.started', diagramId: 'd' }), ev({ type: 'run.finished', status: 'failed', reason: 'x' }), ev({ type: 'memory.proposed', proposals: [] })];
    expect(deriveLive(events).status).toBe('failed');
  });

  it('[R76.11] decidir: ids seguros, decisión save o discard y edición con sus límites', () => {
    expect(parseRequest(CHANNELS.decideMemory, { runId: 'r1', proposalId: 'p1', decision: 'save', edited: { text: 'x' } })).toEqual({ runId: 'r1', proposalId: 'p1', decision: 'save', edited: { text: 'x' } });
    expect(() => parseRequest(CHANNELS.decideMemory, { runId: '../r', proposalId: 'p1', decision: 'save' })).toThrow(ContractError);
    expect(() => parseRequest(CHANNELS.decideMemory, { runId: 'r1', proposalId: 'p1', decision: 'guardar' })).toThrow(ContractError);
    expect(() => parseRequest(CHANNELS.decideMemory, { runId: 'r1', proposalId: 'p1', decision: 'save', edited: { text: 'x'.repeat(601) } })).toThrow(ContractError);
    expect(() => parseRequest(CHANNELS.decideMemory, { runId: 'r1', proposalId: 'p1', decision: 'save', extra: 1 })).toThrow(ContractError);
    expect(parseRequest(CHANNELS.projectMemory, undefined)).toBeUndefined();
  });

  it('[R76.3][R76.12][R76.21] guardar una entrada: se valida, archivar no exige texto y by solo es user o assistant', () => {
    const e = { kind: 'convention', scope: 'project', title: 'Usa pnpm', text: 'Siempre' };
    expect(parseRequest(CHANNELS.saveMemoryEntry, { ...e, by: 'assistant' })).toEqual({ ...e, by: 'assistant' });
    expect(() => parseRequest(CHANNELS.saveMemoryEntry, { ...e, by: 'otro' })).toThrow(ContractError);
    expect(() => parseRequest(CHANNELS.saveMemoryEntry, { ...e, text: 'sk-ant-abcdefghijklmnopqrstuvwx' })).toThrow(/secreto/);
    expect(() => parseRequest(CHANNELS.saveMemoryEntry, { ...e, scope: 'equipo' })).toThrow(ContractError);
    expect(parseRequest(CHANNELS.saveMemoryEntry, { id: 'm1', ...e, text: '', status: 'archived' })).toMatchObject({ status: 'archived' });
  });

  it('[R76.12] el asistente lee la memoria sin permiso y guardarla le pide permiso siempre', () => {
    const list = ASSISTANT_TOOLS.find((t) => t.name === 'list_memory')!;
    const save = ASSISTANT_TOOLS.find((t) => t.name === 'save_memory')!;
    expect(list.readOnly).toBe(true);
    expect(save).toMatchObject({ destructive: true, alwaysConfirm: true });
    expect(save.description).toContain('Solo lo que la persona dijo');
  });
});
