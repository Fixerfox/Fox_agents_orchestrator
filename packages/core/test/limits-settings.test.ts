import { describe, expect, it } from 'vitest';
import { defaultSettings, limitProblems, normalizeSettings, readUnanswered, validateAgent, validateSettings, newAgent } from '../src';

describe('SPEC-070 · límites en Ajustes y en la ficha', () => {
  it('[R70.7] Ajustes valida la inactividad (2–120) y la herramienta en curso (5–480)', () => {
    const base = defaultSettings();
    expect(validateSettings({ ...base, limits: { idleMinutes: 10, toolMinutes: 30 } })).toEqual([]);
    expect(validateSettings({ ...base, limits: { idleMinutes: 1 } }).map((p) => p.field)).toEqual(['limits.idleMinutes']);
    expect(validateSettings({ ...base, limits: { toolMinutes: 500 } }).map((p) => p.field)).toEqual(['limits.toolMinutes']);
    expect(limitProblems({ maxMinutes: 1.5 }).map((p) => p.field)).toEqual(['limits.maxMinutes']);
    expect(limitProblems({ maxCostUsd: 0 }).map((p) => p.field)).toEqual(['limits.maxCostUsd']);
  });

  it('[R70.7] la ficha del agente admite sus propios límites, validados igual', () => {
    const a = { ...newAgent('a', 'A'), limits: { idleMinutes: 5 } };
    expect(validateAgent(a, { contextIds: new Set() })).toEqual([]);
    expect(validateAgent({ ...a, limits: { idleMinutes: 0 } }, { contextIds: new Set() }).map((p) => p.field)).toEqual(['limits.idleMinutes']);
  });

  it('[R70.21] los límites y la política de preguntas se guardan en Ajustes y lo inválido se descarta', () => {
    const s = normalizeSettings({ ...defaultSettings(), limits: { idleMinutes: 15, toolMinutes: 60 }, unanswered: { afterMinutes: 30, action: 'fallback' } });
    expect(s.limits).toEqual({ idleMinutes: 15, toolMinutes: 60 });
    expect(s.unanswered).toEqual({ afterMinutes: 30, action: 'fallback' });
    const bad = normalizeSettings({ ...defaultSettings(), limits: { idleMinutes: 999 }, unanswered: { afterMinutes: 0, action: 'fallback' } });
    expect(bad.limits).toBeUndefined();
    expect(bad.unanswered).toBeUndefined();
    expect(readUnanswered({ afterMinutes: 5, action: 'otra' })).toBeUndefined();
    expect(validateSettings({ ...defaultSettings(), unanswered: { afterMinutes: 5, action: 'nada' } }).map((p) => p.field)).toEqual(['unanswered']);
  });
});
