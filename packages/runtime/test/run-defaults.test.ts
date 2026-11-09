import { describe, expect, it } from 'vitest';
import { defaultSettings } from '@orquestador/core';
import { runDefaultsFrom } from '../src';

describe('SPEC-070/071 · opciones de cada ejecución desde Ajustes', () => {
  it('[R70.7] [R71.3] la app activa el jitter y pasa los límites y la política de preguntas de Ajustes', () => {
    expect(runDefaultsFrom(defaultSettings())).toEqual({ maxConcurrency: 4, retry: { maxAttempts: 3, baseDelayMs: 1000, jitter: true } });
    const o = runDefaultsFrom({ ...defaultSettings(), maxParallel: 2, limits: { idleMinutes: 15 }, unanswered: { afterMinutes: 20, action: 'fail' } });
    expect(o).toMatchObject({ maxConcurrency: 2, limits: { idleMinutes: 15 }, unanswered: { afterMinutes: 20, action: 'fail' } });
  });
});
