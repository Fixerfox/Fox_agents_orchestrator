import { AgentError, DEFAULT_REVIEW_CRITERIA, Orchestrator, supervisorModel, supervisorReviews, type AgentAdapter, type AgentEngine, type AgentProfile, type AppSettings, type Decider, type Id, type KnowledgeExtra, type LibraryReader } from '@orquestador/core';
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
    judgeReview: async (r, s) => {
      const chosen = pick().decider;
      if (chosen.judgeReview) return chosen.judgeReview(r, s);
      const res = await chosen.judge({ prompt: r.criteria ?? DEFAULT_REVIEW_CRITERIA, output: r.output, iteration: r.round }, s);
      return { approved: res.done, reason: res.reason };
    },
    // Sin `blame` falla a propósito: `blameStep` lo trata como no saber y propone el último paso [R53.5].
    blame: (r, s) => {
      const chosen = pick().decider;
      if (!chosen.blame) throw new AgentError('El motor activo no sabe proponer a qué paso volver');
      return chosen.blame(r, s);
    },
    supervise: (r, s) => {
      const chosen = pick().decider;
      if (!chosen.supervise) throw new AgentError('El motor activo no sabe revisar');
      return chosen.supervise(r, s);
    },
    verifyRun: (r, s) => {
      const chosen = pick().decider;
      if (!chosen.verifyRun) throw new AgentError('El motor activo no sabe comprobar el resultado');
      return chosen.verifyRun(r, s);
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
  // El Supervisor va siempre; revisa con IA si está activa y el motor sabe hacerlo [R60.12][R60.14].
  const supervisor = { review: () => supervisorReviews(ctx.settings()) && pick().decider.supervise !== undefined, model: () => supervisorModel(ctx.settings()) };
  return new Orchestrator({ getAdapter, decider, supervisor, agentProfile: (id, extra, runId) => profileOf(ctx.library, id, extra, runId), resolveTemplate: (id, _version, runId) => ctx.library.diagram(id, runId) });
}
