import { describe, expect, it } from 'vitest';
import { AGENT_ICONS, AGENT_TONES, newAgent, validateAgent } from '../src';

const ctx = { contextIds: new Set<string>(), skillIds: new Set<string>(), mcpIds: new Set<string>() };

describe('SPEC-039 · agente supervisado e icono en el núcleo', () => {
  it('[R39.1] askFirst es opcional y booleano', () => {
    expect(validateAgent({ ...newAgent('a', 'A'), askFirst: true }, ctx)).toEqual([]);
    expect(validateAgent({ ...newAgent('a', 'A'), askFirst: 'sí' as never }, ctx)).toEqual([expect.objectContaining({ field: 'askFirst' })]);
  });

  it('[R39.7] icono y tono salen de catálogos fijos', () => {
    expect(AGENT_ICONS).toHaveLength(24);
    expect(new Set(AGENT_ICONS).size).toBe(24);
    expect(AGENT_TONES).toEqual(['neutral', 'amber', 'blue', 'green', 'rose', 'violet', 'teal']);
    expect(validateAgent({ ...newAgent('a', 'A'), icon: 'palette', tone: 'violet' }, ctx)).toEqual([]);
    expect(validateAgent({ ...newAgent('a', 'A'), icon: 'unicornio' as never }, ctx).map((p) => p.field)).toEqual(['icon']);
    expect(validateAgent({ ...newAgent('a', 'A'), tone: 'fucsia' as never }, ctx).map((p) => p.field)).toEqual(['tone']);
  });
});

describe('SPEC-039 · lo obligatorio del agente', () => {
  it('[R39.12] required tiene que ser parte de lo asignado', () => {
    const base = { ...newAgent('a', 'A'), skillIds: ['s1'] };
    const ok = { ...ctx, skillIds: new Set(['s1']) };
    expect(validateAgent({ ...base, required: { skillIds: ['s1'] } }, ok)).toEqual([]);
    expect(validateAgent({ ...base, required: { skillIds: ['s2'] } }, ok).map((p) => p.field)).toEqual(['required']);
    expect(validateAgent({ ...base, required: { otros: [] } as never }, ok).map((p) => p.field)).toEqual(['required']);
  });
});
