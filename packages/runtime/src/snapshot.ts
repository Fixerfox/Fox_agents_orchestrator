import type { AgentDefinition, ContextDefinition, Diagram, Id, LibraryReader, McpServerDefinition, SkillDefinition } from '@orquestador/core';

/** Copia de lo que usa una ejecución, tomada al lanzarla [R52.1]. */
export interface LibrarySnapshot {
  agents: AgentDefinition[];
  contexts: ContextDefinition[];
  skills: SkillDefinition[];
  mcp: McpServerDefinition[];
  /** Subdiagramas a los que llega el diagrama, también los anidados. */
  templates: Map<Id, Diagram>;
}

/** Ids de los subdiagramas de un diagrama, también dentro de bucles. */
function templateIds(d: Diagram, out: Set<Id> = new Set()): Set<Id> {
  for (const n of d.nodes) {
    if (n.kind === 'subdiagram' && n.subdiagram) out.add(n.subdiagram.templateId);
    if (n.kind === 'loop' && n.loop) templateIds(n.loop.body, out);
  }
  return out;
}

/** Toma la copia de R52.1: definiciones de la biblioteca y subdiagramas alcanzables. */
export async function takeSnapshot(library: LibraryReader, diagram: Diagram): Promise<LibrarySnapshot> {
  const [agents, contexts, skills, mcp] = await Promise.all([library.agents(), library.contexts(), library.skills(), library.mcp()]);
  const templates = new Map<Id, Diagram>();
  const pending = [...templateIds(diagram)];
  while (pending.length > 0) {
    const id = pending.pop()!;
    if (templates.has(id) || id === diagram.id) continue;
    try {
      const t = await library.diagram(id);
      templates.set(id, t);
      for (const next of templateIds(t)) if (!templates.has(next)) pending.push(next);
    } catch {
      /* no existe: el orquestador lo dirá al llegar al paso */
    }
  }
  return { agents: structuredClone(agents), contexts: structuredClone(contexts), skills: structuredClone(skills), mcp: structuredClone(mcp), templates };
}

/** Copias de las ejecuciones en marcha, por `runId` [R52.1]. */
export class RunSnapshots {
  private readonly byRun = new Map<Id, LibrarySnapshot>();
  set(runId: Id, snap: LibrarySnapshot): void {
    this.byRun.set(runId, snap);
  }
  get(runId: Id | undefined): LibrarySnapshot | undefined {
    return runId === undefined ? undefined : this.byRun.get(runId);
  }
  delete(runId: Id): void {
    this.byRun.delete(runId);
  }
  get size(): number {
    return this.byRun.size;
  }
}

/** Biblioteca que lee de la copia de la ejecución si la tiene y, si no, de `base` [R52.1][R56.3]. */
export function snapshotLibrary(base: LibraryReader, snapshots: RunSnapshots | undefined): LibraryReader {
  const snap = (runId?: Id) => snapshots?.get(runId);
  return {
    agents: async (runId) => snap(runId)?.agents ?? base.agents(),
    contexts: async (runId) => snap(runId)?.contexts ?? base.contexts(),
    skills: async (runId) => snap(runId)?.skills ?? base.skills(),
    mcp: async (runId) => snap(runId)?.mcp ?? base.mcp(),
    diagram: async (id, runId) => snap(runId)?.templates.get(id) ?? base.diagram(id),
    diagramIds: () => base.diagramIds(),
  };
}
