import { describe, expect, it } from 'vitest';
import { defaultSettings } from '@orquestador/core';
import { claudePathPolicy, createClaudeEngine, isSensitivePath, type ClaudeEnvironment, type QueryFn } from '../src';

const env: ClaudeEnvironment = {
  projectRoot: '/p',
  settings: defaultSettings,
  apiKey: async () => undefined,
  workFolder: async () => undefined,
  backup: async () => undefined,
  loadAgent: async () => undefined,
  loadContexts: async () => [],
  loadSkills: async () => [],
  loadMcp: async () => [],
} as unknown as ClaudeEnvironment;

describe('SPEC-056 · adaptador de Claude como motor', () => {
  it('[R56.5] createClaudeEngine da el motor `claude` con su adaptador y quien decide', () => {
    const query: QueryFn = async function* () {};
    const engine = createClaudeEngine(env, query);
    expect(engine.id).toBe('claude');
    expect(engine.adapter.run).toBeTypeOf('function');
    expect(engine.decider.route).toBeTypeOf('function');
    expect(engine.decider.transform).toBeTypeOf('function');
  });

  it('[R56.5] la política de rutas es la misma que protege al asistente', () => {
    for (const rel of ['.env', 'credentials.json', 'id_rsa']) {
      expect(claudePathPolicy.isSensitive(rel), rel).toBe(isSensitivePath(rel));
      expect(claudePathPolicy.isPreviewable(rel), rel).toBe(false);
    }
    expect(claudePathPolicy.isPreviewable('web/index.html')).toBe(true);
    expect(claudePathPolicy.isPreviewable('../fuera.txt')).toBe(false);
    expect(claudePathPolicy.isPreviewable('.git/config')).toBe(false);
  });
});
