import { safePreviewPath, type AgentEngine, type PathPolicy } from '@orquestador/core';
import { ClaudeAdapter, type ClaudeEnvironment } from './adapter';
import { isSensitivePath } from './assistant-read';
import { ClaudeDecider } from './decider';
import type { QueryFn } from './sdk-types';

/** Motor real: agentes y decisiones con Claude [R56.5]. */
export function createClaudeEngine(env: ClaudeEnvironment, query: QueryFn): AgentEngine {
  return {
    id: 'claude',
    adapter: new ClaudeAdapter(env, query),
    decider: new ClaudeDecider({ query, projectRoot: env.projectRoot, settings: env.settings, apiKey: env.apiKey }),
  };
}

/** Las rutas que no se enseñan son las mismas que el asistente no puede leer [R56.5]. */
export const claudePathPolicy: PathPolicy = {
  isSensitive: (rel) => isSensitivePath(rel),
  isPreviewable: (rel) => safePreviewPath(rel) && !isSensitivePath(rel),
};
