import { Orchestrator, type AgentAdapter, type AppSettings, type Decider } from '@orquestador/core';
import { ClaudeAdapter, ClaudeDecider, type ClaudeEnvironment, type QueryFn } from '@orquestador/claude';
import type { ProjectStore } from '@orquestador/store';
import { createDemoParts } from './demo';
import type { RunSnapshots } from './snapshot';

/** Lo que el orquestador necesita saber del proyecto abierto y de Ajustes, siempre al día [R27.1]. */
export interface EngineContext {
  store: ProjectStore;
  projectRoot: string;
  settings(): AppSettings;
  apiKey(): Promise<string | undefined>;
  /** Secretos de un servidor MCP del proyecto; solo en el proceso principal [R30.4]. */
  mcpSecrets?(id: string, scope?: 'project' | 'app'): Promise<Record<string, string>>;
  /** Copias de las ejecuciones en marcha: sus pasos leen de ahí y no del disco [R52.1]. */
  snapshots?: RunSnapshots;
}

/**
 * Entorno del adaptador de Claude: lee agentes, contextos y skills del proyecto [R27.10], o de la copia de la
 * ejecución si la tiene [R52.1].
 */
export function claudeEnvironment(ctx: EngineContext): ClaudeEnvironment {
  const snap = (runId?: string) => ctx.snapshots?.get(runId);
  return {
    projectRoot: ctx.projectRoot,
    settings: ctx.settings,
    apiKey: ctx.apiKey,
    workFolder: () => ctx.store.getWorkFolder(),
    backup: (runId, abs, rel) => ctx.store.backupFile(runId, abs, rel),
    async loadAgent(id, runId) {
      return (snap(runId)?.agents ?? (await ctx.store.listAgents())).find((a) => a.id === id);
    },
    async loadContexts(ids, runId) {
      const all = snap(runId)?.contexts ?? (await ctx.store.listContexts());
      return ids.flatMap((id) => all.filter((c) => c.id === id));
    },
    async loadSkills(ids, runId) {
      const all = snap(runId)?.skills ?? (await ctx.store.listSkills());
      return ids.flatMap((id) => all.filter((s) => s.id === id));
    },
    async loadMcp(ids, runId) {
      const all = snap(runId)?.mcp ?? (await ctx.store.listMcp());
      const picked = ids.flatMap((id) => all.filter((m) => m.id === id && m.enabled));
      return Promise.all(picked.map(async (def) => ({ def, secrets: (await ctx.mcpSecrets?.(def.id, def.scope)) ?? {} })));
    },
  };
}

/**
 * Orquestador que elige el motor en cada nodo según Ajustes: `simulated` usa los agentes de demostración
 * y `claude` el adaptador real [R27.1]. Cambiar el motor en Ajustes se nota en la siguiente ejecución.
 */
export function createEngineOrchestrator(ctx: EngineContext, query: QueryFn): Orchestrator {
  const demo = createDemoParts();
  const claude = new ClaudeAdapter(claudeEnvironment(ctx), query);
  const claudeDecider = new ClaudeDecider({ query, projectRoot: ctx.projectRoot, settings: ctx.settings, apiKey: ctx.apiKey });
  const useClaude = () => ctx.settings().engine === 'claude';
  const decider: Decider = {
    route: (r, s) => (useClaude() ? claudeDecider : demo.decider).route(r, s),
    judge: (r, s) => (useClaude() ? claudeDecider : demo.decider).judge(r, s),
    condition: (r, s) => (useClaude() ? claudeDecider : demo.decider).condition(r, s),
    transform: (r, s) => (useClaude() ? claudeDecider : demo.decider).transform(r, s),
  };
  const getAdapter = (): AgentAdapter => (useClaude() ? claude : demo.adapter);
  // Un subdiagrama es otro diagrama del proyecto en su última versión guardada [R33.7], o la de la copia de la
  // ejecución [R52.1].
  return new Orchestrator({ getAdapter, decider, resolveTemplate: (id, _version, runId) => ctx.snapshots?.get(runId)?.templates.get(id) ?? ctx.store.diagrams.load(id) });
}
