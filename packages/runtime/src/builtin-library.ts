import { COORDINATOR_ID, coordinatorAgent, type LibraryReader } from '@orquestador/core';

/** Biblioteca con los agentes fijos de la app, que ganan a uno del proyecto con el mismo id [R59.19]. */
export function withBuiltinAgents(library: LibraryReader): LibraryReader {
  return {
    agents: async (runId) => [...(await library.agents(runId)).filter((a) => a.id !== COORDINATOR_ID), coordinatorAgent()],
    contexts: (runId) => library.contexts(runId),
    skills: (runId) => library.skills(runId),
    mcp: (runId) => library.mcp(runId),
    diagram: (id, runId) => library.diagram(id, runId),
    diagramIds: () => library.diagramIds(),
  };
}
