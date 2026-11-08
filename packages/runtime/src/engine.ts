import { AgentError, DEFAULT_REVIEW_CRITERIA, Orchestrator, supervisorHumanChecks, supervisorModel, supervisorReviews, type AgentEngine, type AgentProfile, type AppSettings, type Decider, type Id, type KnowledgeExtra, type LibraryReader, type RunOptions } from '@orquestador/core';
import { createDemoParts } from './demo';

/** Lo que el orquestador necesita saber del proyecto abierto y de Ajustes, siempre al día [R27.1]. */
export interface EngineContext {
  /** Biblioteca del proyecto, con las copias de las ejecuciones en marcha si las hay [R52.1]. */
  library: LibraryReader;
  settings(): AppSettings;
  /** Devuelve al punto de partida lo que tocó un intento fallido [R71.10]. */
  restoreFiles?(runId: Id, files: { path: string; change?: 'created' | 'modified' }[]): Promise<{ restored: string[]; removed: string[]; failed: { path: string; reason: string }[] }>;
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
  /** Decisiones de un motor, con las opcionales que falten resueltas como siempre. */
  const deciderOf = (current: () => Pick<AgentEngine, 'adapter' | 'decider'>): Decider => {
    const conditions: Decider['conditions'] = (r, s) => {
      const chosen = current().decider;
      if (!chosen.conditions) throw new AgentError('El motor activo no sabe evaluar varias condiciones a la vez');
      return chosen.conditions(r, s);
    };
    return {
      route: (r, s) => current().decider.route(r, s),
      judge: (r, s) => current().decider.judge(r, s),
      condition: (r, s) => current().decider.condition(r, s),
      // Solo se ofrece si el motor la tiene: si no, el router pregunta una por una [R63.16].
      ...(current().decider.conditions ? { conditions } : {}),
      judgeReview: async (r, s) => {
        const chosen = current().decider;
        if (chosen.judgeReview) return chosen.judgeReview(r, s);
        const res = await chosen.judge({ prompt: r.criteria ?? DEFAULT_REVIEW_CRITERIA, output: r.output, iteration: r.round }, s);
        return { approved: res.done, reason: res.reason, ...(res.usage ? { usage: res.usage } : {}) };
      },
      // Sin `blame` falla a propósito: `blameStep` lo trata como no saber y propone el último paso [R53.5].
      blame: (r, s) => {
        const chosen = current().decider;
        if (!chosen.blame) throw new AgentError('El motor activo no sabe proponer a qué paso volver');
        return chosen.blame(r, s);
      },
      supervise: (r, s) => {
        const chosen = current().decider;
        if (!chosen.supervise) throw new AgentError('El motor activo no sabe revisar');
        return chosen.supervise(r, s);
      },
      verifyRun: (r, s) => {
        const chosen = current().decider;
        if (!chosen.verifyRun) throw new AgentError('El motor activo no sabe comprobar el resultado');
        return chosen.verifyRun(r, s);
      },
      transform: (r, s) => {
        const chosen = current().decider;
        if (!chosen.transform) throw new AgentError('El motor activo no sabe transformar con Claude');
        return chosen.transform(r, s);
      },
    };
  };
  // Un subdiagrama es otro diagrama del proyecto en su última versión guardada [R33.7], o la de la copia de la
  // ejecución [R52.1].
  // El Supervisor va siempre; revisa con IA si está activa y el motor sabe hacerlo [R60.12][R60.14].
  const supervisor = { review: () => supervisorReviews(ctx.settings()), model: () => supervisorModel(ctx.settings()), humanChecks: () => supervisorHumanChecks(ctx.settings()) };
  return new Orchestrator({
    getAdapter: () => pick().adapter,
    // Fuera de una ejecución (proponer una corrección) vale el motor de Ajustes en cada momento.
    decider: deciderOf(pick),
    // Cada ejecución fija el suyo al arrancar: cambiar Ajustes vale para las siguientes [R63.13].
    forRun: () => {
      const chosen = pick();
      return { getAdapter: () => chosen.adapter, decider: deciderOf(() => chosen), review: () => chosen.decider.supervise !== undefined };
    },
    supervisor,
    agentProfile: (id, extra, runId) => profileOf(ctx.library, id, extra, runId),
    ...(ctx.restoreFiles ? { restoreFiles: (runId: Id, files: { path: string; change?: 'created' | 'modified' }[]) => ctx.restoreFiles!(runId, files) } : {}),
    // Los límites de la ficha del agente [R70.7].
    agentLimits: async (id, runId) => (await ctx.library.agents(runId)).find((a) => a.id === id)?.limits,
    resolveTemplate: (id, _version, runId) => ctx.library.diagram(id, runId),
  });
}

/** Opciones de cada ejecución que salen de Ajustes: paralelo, jitter, límites de tiempo y preguntas [R23.6][R70.7][R70.21][R71.3]. */
export function runDefaultsFrom(settings: AppSettings): RunOptions {
  return {
    maxConcurrency: settings.maxParallel,
    retry: { maxAttempts: 3, baseDelayMs: 1000, jitter: true },
    ...(settings.limits ? { limits: { ...settings.limits } } : {}),
    ...(settings.unanswered ? { unanswered: { ...settings.unanswered } } : {}),
  };
}
