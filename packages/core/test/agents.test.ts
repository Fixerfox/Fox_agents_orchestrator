import { describe, expect, it } from 'vitest';
import {
  LIMITS,
  MODELS,
  defaultSettings,
  isRelativeInside,
  newAgent,
  newContext,
  normalizeSettings,
  slugify,
  validateAgent,
  validateContext,
  validateSettings,
  withoutContext,
} from '../src';

const ctx = (...ids: string[]) => ({ contextIds: new Set(ids) });
const fields = (p: { field: string }[]) => p.map((x) => x.field);

describe('agentes del proyecto [R22.1]', () => {
  it('[R22.1] un agente nuevo es válido con nombre', () => {
    expect(validateAgent({ ...newAgent('pintor', 'Pintor') }, ctx())).toEqual([]);
  });

  it('[R22.1] señala el campo y da el mensaje en español', () => {
    const a = { ...newAgent('p', 'x'), name: '  ', model: 'gpt', description: 'd'.repeat(LIMITS.description + 1), instructions: 5 };
    const p = validateAgent(a, ctx());
    expect(fields(p).sort()).toEqual(['description', 'instructions', 'model', 'name']);
    expect(p.find((x) => x.field === 'name')!.message).toBe('Escribe un nombre');
  });

  it('[R22.1] límites de nombre, instrucciones y turnos', () => {
    expect(fields(validateAgent({ ...newAgent('p', 'n'.repeat(61)) }, ctx()))).toEqual(['name']);
    expect(fields(validateAgent({ ...newAgent('p', 'n'), instructions: 'i'.repeat(LIMITS.instructions + 1) }, ctx()))).toEqual(['instructions']);
    for (const bad of [0, 201, 1.5, '3']) expect(fields(validateAgent({ ...newAgent('p', 'n'), maxTurns: bad }, ctx()))).toEqual(['maxTurns']);
    expect(validateAgent({ ...newAgent('p', 'n'), maxTurns: 10 }, ctx())).toEqual([]);
  });

  it('[R22.1] el id debe servir como nombre de archivo y todos los modelos de la lista valen', () => {
    for (const id of ['../x', 'a/b', '', 'a..b']) expect(fields(validateAgent({ ...newAgent(id, 'n') }, ctx()))).toContain('id');
    for (const m of MODELS) expect(validateAgent({ ...newAgent('p', 'n'), model: m.id }, ctx())).toEqual([]);
    expect(fields(validateAgent(null, ctx()))).toEqual(['agent']);
  });

  it('[R22.4] no admite contextos que no existen ni repetidos', () => {
    expect(validateAgent({ ...newAgent('p', 'n'), contextIds: ['a'] }, ctx('a'))).toEqual([]);
    const missing = validateAgent({ ...newAgent('p', 'n'), contextIds: ['a', 'zz'] }, ctx('a'));
    expect(missing).toEqual([{ field: 'contextIds', message: 'No existe el contexto: zz' }]);
    expect(validateAgent({ ...newAgent('p', 'n'), contextIds: ['a', 'a'] }, ctx('a'))[0]!.message).toBe('Hay contextos repetidos');
  });

  it('[R22.4] borrar un contexto lo quita solo de los agentes que lo usaban', () => {
    const a = { ...newAgent('a', 'A'), contextIds: ['x', 'y'] };
    const b = { ...newAgent('b', 'B'), contextIds: ['y'] };
    const c = { ...newAgent('c', 'C'), contextIds: ['z'] };
    expect(withoutContext([a, b, c], 'y')).toEqual([{ ...a, contextIds: ['x'] }, { ...b, contextIds: [] }]);
  });
});

describe('contextos del proyecto [R22.2]', () => {
  const c = (kind: string, value: unknown, name = 'Guía') => ({ ...newContext('guia', name), kind, value });

  it('[R22.2] texto: obligatorio y con límite', () => {
    expect(validateContext(c('text', 'Usa paleta de 4 colores'))).toEqual([]);
    expect(fields(validateContext(c('text', '   ')))).toEqual(['value']);
    expect(fields(validateContext(c('text', 'x'.repeat(LIMITS.contextText + 1))))).toEqual(['value']);
  });

  it('[R22.2] URL: solo http y https', () => {
    expect(validateContext(c('url', 'https://ejemplo.com/guia'))).toEqual([]);
    expect(validateContext(c('url', 'http://localhost:3000'))).toEqual([]);
    for (const bad of ['ftp://x.com', 'javascript:alert(1)', 'file:///etc/passwd', 'no es una url', '']) {
      expect(fields(validateContext(c('url', bad))), bad).toEqual(['value']);
    }
  });

  it('[R22.2] archivo: ruta relativa dentro del proyecto', () => {
    expect(validateContext(c('file', 'docs/guia.md'))).toEqual([]);
    for (const bad of ['', '/etc/passwd', 'C:\\Windows\\x', '\\\\srv\\x', '../fuera.txt', 'a/../../b', 'a\\..\\b']) {
      expect(fields(validateContext(c('file', bad))), bad).toEqual(['value']);
    }
    expect(isRelativeInside('a/b.txt')).toBe(true);
    expect(isRelativeInside('a/..b/c')).toBe(true);
  });

  it('[R22.2] nombre, tipo e id', () => {
    expect(fields(validateContext(c('text', 'x', '')))).toEqual(['name']);
    expect(fields(validateContext(c('otro', 'x')))).toEqual(['kind']);
    expect(fields(validateContext({ ...c('text', 'x'), id: '../x' }))).toEqual(['id']);
    expect(fields(validateContext(undefined))).toEqual(['context']);
  });
});

describe('ajustes [R23.1]', () => {
  it('[R23.1] los de por defecto son válidos: Claude Code, Sonnet y 4 en paralelo', () => {
    const s = defaultSettings();
    expect(validateSettings(s)).toEqual([]);
    expect(s).toMatchObject({ authMode: 'claude-code', defaultModel: 'claude-sonnet-5-5', maxParallel: 4 });
  });

  it('[R23.1] valida conexión, modelo, paralelismo y límite', () => {
    const bad = { ...defaultSettings(), authMode: 'otro', defaultModel: 'x', maxParallel: 17, defaultMaxTokens: 0 };
    expect(fields(validateSettings(bad)).sort()).toEqual(['authMode', 'defaultMaxTokens', 'defaultModel', 'maxParallel']);
    expect(validateSettings({ ...defaultSettings(), maxParallel: 1 })).toEqual([]);
    expect(validateSettings({ ...defaultSettings(), maxParallel: 16, defaultMaxTokens: 50000, authMode: 'api-key' })).toEqual([]);
    expect(fields(validateSettings({ ...defaultSettings(), maxParallel: 0 }))).toEqual(['maxParallel']);
    expect(fields(validateSettings(7))).toEqual(['settings']);
  });

  it('[R23.1] si falta algún valor o está dañado se usan los de por defecto', () => {
    expect(normalizeSettings(undefined)).toEqual(defaultSettings());
    expect(normalizeSettings({ authMode: 'api-key', maxParallel: 99, defaultModel: 'nope', defaultMaxTokens: -3 })).toEqual({ ...defaultSettings(), authMode: 'api-key' });
    expect(normalizeSettings({ maxParallel: 8, defaultMaxTokens: 1000, defaultModel: 'claude-opus-5-5' })).toEqual({
      ...defaultSettings(),
      maxParallel: 8,
      defaultMaxTokens: 1000,
      defaultModel: 'claude-opus-5-5',
    });
  });
});

describe('ids a partir del nombre [R22.6]', () => {
  it('[R22.6] minúsculas, sin acentos y con guiones', () => {
    expect(slugify('Pintor de Héroes', new Set())).toBe('pintor-de-heroes');
    expect(slugify('  ¡Diseño & Arte!  ', new Set())).toBe('diseno-arte');
  });
  it('[R22.6] es único y tiene un valor por defecto', () => {
    expect(slugify('Pintor', new Set(['pintor']))).toBe('pintor-2');
    expect(slugify('Pintor', new Set(['pintor', 'pintor-2']))).toBe('pintor-3');
    expect(slugify('???', new Set(), 'agente')).toBe('agente');
  });
});

describe('motor de los agentes [R27.1]', () => {
  it('[R27.1] por defecto es simulado; solo se aceptan simulated y claude y lo demás se normaliza', () => {
    expect(defaultSettings().engine).toBe('simulated');
    expect(validateSettings({ ...defaultSettings(), engine: 'claude' })).toEqual([]);
    expect(validateSettings({ ...defaultSettings(), engine: 'otro' }).map((p) => p.field)).toEqual(['engine']);
    expect(normalizeSettings({ engine: 'claude' }).engine).toBe('claude');
    expect(normalizeSettings({ engine: 'otro' }).engine).toBe('simulated');
    expect(normalizeSettings({ authMode: 'api-key' }).engine).toBe('simulated');
  });
});
