import { COORDINATOR_ID, VERIFIER_AGENT_ID, VERIFY_SKILL_ID, coordinatorAgent, verifierAgent, verifySkill, type LibraryReader } from '@orquestador/core';

/**
 * Biblioteca con los agentes fijos de la app: el Coordinador gana a uno del proyecto con el mismo id [R59.19]; el
 * Verificador y su skill, en cambio, se pueden copiar al proyecto y editar, y entonces manda la copia [R75.16].
 */
export function withBuiltinAgents(library: LibraryReader): LibraryReader {
  return {
    agents: async (runId) => {
      const own = (await library.agents(runId)).filter((a) => a.id !== COORDINATOR_ID);
      return [...own, coordinatorAgent(), ...(own.some((a) => a.id === VERIFIER_AGENT_ID) ? [] : [verifierAgent()])];
    },
    contexts: (runId) => library.contexts(runId),
    skills: async (runId) => {
      const own = await library.skills(runId);
      return own.some((s) => s.id === VERIFY_SKILL_ID) ? own : [...own, verifySkill()];
    },
    mcp: (runId) => library.mcp(runId),
    diagram: (id, runId) => library.diagram(id, runId),
    diagramIds: () => library.diagramIds(),
  };
}
