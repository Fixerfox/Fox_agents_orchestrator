import { describe, expect, it } from 'vitest';
import { validateDiagram, type Diagram } from '@orquestador/core';
import { CHANNELS, parseRequest, updateNode } from '../src';

const D: Diagram = {
  id: 'd',
  name: 'D',
  schemaVersion: 1,
  nodes: [{ id: 'entry', kind: 'entry' }, { id: 'a', kind: 'agent', agentId: 'a', label: 'A' }, { id: 'output', kind: 'output' }],
  edges: [{ id: 'e1', from: 'entry', to: 'a' }, { id: 'e2', from: 'a', to: 'output' }],
};

describe('SPEC-070 · contrato', () => {
  it('[R70.19] el IPC de lanzar acepta y valida «Si nadie responde»', () => {
    const base = { diagramId: 'd', order: 'x' };
    expect(parseRequest(CHANNELS.startRun, { ...base, unanswered: { afterMinutes: 30, action: 'fallback' } })).toMatchObject({ unanswered: { afterMinutes: 30, action: 'fallback' } });
    expect(() => parseRequest(CHANNELS.startRun, { ...base, unanswered: { afterMinutes: 30, action: 'otra' } })).toThrow(/unanswered/);
    expect(() => parseRequest(CHANNELS.startRun, { ...base, unanswered: { afterMinutes: -1, action: 'fail' } })).toThrow(/unanswered/);
  });

  it('[R70.21] los Ajustes de tiempo viajan por el IPC', () => {
    const s = { schemaVersion: 2, authMode: 'claude-code', engine: 'simulated', defaultModel: 'claude-sonnet-5-5', maxParallel: 4 };
    expect(parseRequest(CHANNELS.saveSettings, { ...s, limits: { idleMinutes: 15 }, unanswered: { afterMinutes: 5, action: 'fail' } })).toMatchObject({ limits: { idleMinutes: 15 } });
    expect(() => parseRequest(CHANNELS.saveSettings, { ...s, limits: 5 })).toThrow(/limits/);
  });

  it('[R70.21] el paso guarda sus límites; vacío los quita y lo inválido se rechaza', () => {
    const withLimits = updateNode(D, [], 'a', { limits: { idleMinutes: 5, maxMinutes: 60 } });
    expect(withLimits.nodes[1]!.limits).toEqual({ idleMinutes: 5, maxMinutes: 60 });
    expect(updateNode(withLimits, [], 'a', { limits: {} }).nodes[1]!.limits).toBeUndefined();
    expect(() => updateNode(D, [], 'a', { limits: { idleMinutes: 1 } })).toThrow();
    expect(() => updateNode(D, [], 'entry', { limits: { idleMinutes: 5 } })).toThrow();
    const bad = { ...D, nodes: [D.nodes[0]!, { ...D.nodes[1]!, limits: { toolMinutes: 1 } }, D.nodes[2]!] };
    expect(validateDiagram(bad).map((i) => i.code)).toContain('node-limits-invalid');
  });
});

describe('SPEC-071 · contrato', () => {
  it('[R71.16] «Al reintentar»: «Volver al punto de partida» se guarda y «Conservar» es lo de por defecto', () => {
    const restore = updateNode(D, [], 'a', { onRetry: 'restore' });
    expect(restore.nodes[1]!.onRetry).toBe('restore');
    expect(updateNode(restore, [], 'a', { onRetry: 'keep' }).nodes[1]!.onRetry).toBeUndefined();
    expect(() => updateNode(D, [], 'a', { onRetry: 'nada' as never })).toThrow();
    const entry = { ...D, nodes: [{ ...D.nodes[0]!, onRetry: 'restore' as const }, D.nodes[1]!, D.nodes[2]!] };
    expect(validateDiagram(entry).map((i) => i.code)).toContain('node-limits-not-agent');
  });
});
