import { AgentError, Orchestrator, type AgentAdapter, type AgentEngine, type AgentProfile, type AppSettings, type Decider, type Id, type KnowledgeExtra, type LibraryReader } from '@orquestador/core';
import { createDemoParts } from './demo';

/** Lo que el orquestador necesita saber del proyecto abierto y de Ajustes, siempre al día [R27.1]. */
export interface EngineContext {
  /** Biblioteca del proyecto, con las copias de las ejecuciones en marcha si las hay [R52.1]. */
  library: LibraryReader;
  settings(): AppSettings;
}

/** Ficha de un agente con lo enchufado a su paso, para quien reparte [R59.18]. */
async function profileOf(library: LibraryReader, id: Id, extra: KnowledgeExtra | undefined, runId: Id): Promise<AgentProfile | undefined> {
  const [agents, skills, mcp] = await Promise.all([library.agents(runId), library.skills(runId), library.mcp(runId)]);
  const agent = agents.find((a) => a.id === id);
  if (!agent) return undefined;
  const names = (list: readonly { id: Id; name: string }[], ids: readonly Id[]) => [...new Set(ids)].map((i) => list.find((x) => x.id === i)?.name ?? i);
  return {
    name: agent.name,
    ...(agent.description ? { purpose: agent.description } : {}),
    skills: names(skills, [...agent.skillIds, ...(extra?.skillIds ?? [])]),
    mcp: names(mcp, [...(agent.mcpIds ?? []), ...(extra?.mcpIds ?? [])]),
  };
}

/**
 * Orquestador que elige el motor en cada paso según Ajustes: el de `engines` cuyo id coincide con `settings().engine`
 * y, si no hay ninguno, los agentes de demostración [R27.1][R56.4]. Cambiar el motor en Ajustes se nota en la
 * siguiente ejecución.
 */
export function createEngineOrchestrator(ctx: EngineContext, engines: readonly AgentEngine[]): Orchestrator {
  const demo = createDemoParts();
  const pick = (): Pick<AgentEngine, 'adapter' | 'decider'> => engines.find((e) => e.id === ctx.settings().engine) ?? demo;
  const decider: Decider = {
    route: (r, s) => pick().decider.route(r, s),
    judge: (r, s) => pick().decider.judge(r, s),
    condition: (r, s) => pick().decider.condition(r, s),
    // Sin `blame` falla a propósito: `blameStep` lo trata como no saber y propone el último paso [R53.5].
    blame: (r, s) => {
      const chosen = pick().decider;
      if (!chosen.blame) throw new AgentError('El motor activo no sabe proponer a qué paso volver');
      return chosen.blame(r, s);
    },
    transform: (r, s) => {
      const chosen = pick().decider;
      if (!chosen.transform) throw new AgentError('El motor activo no sabe transformar con Claude');
      return chosen.transform(r, s);
    },
  };
  const getAdapter = (): AgentAdapter => pick().adapter;
  // Un subdiagrama es otro diagrama del proyecto en su última versión guardada [R33.7], o la de la copia de la
  // ejecución [R52.1].
  return new Orchestrator({ getAdapter, decider, agentProfile: (id, extra, runId) => profileOf(ctx.library, id, extra, runId), resolveTemplate: (id, _version, runId) => ctx.library.diagram(id, runId) });
}
