import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ProjectApi } from '@orquestador/editor';
import type { KnowledgeCatalog } from './ExtraKnowledge';
import type { AgentOption } from './Palette';

/** Agentes, skills, contextos y MCP del proyecto para la paleta, el lienzo y los pasos [R33.5]. */
export function useProjectCatalog(api: ProjectApi, project: string | undefined, builtIn: AgentOption[]) {
  const [projectAgents, setProjectAgents] = useState<AgentOption[]>([]);
  /** Skills y contextos del proyecto para añadirlos a un paso o al diagrama [R33.5]. */
  const [catalog, setCatalog] = useState<KnowledgeCatalog>({ skills: [], contexts: [] });
  const agents = useMemo(() => {
    const own = new Set(projectAgents.map((a) => a.id));
    return [...projectAgents, ...builtIn.filter((a) => !own.has(a.id))];
  }, [projectAgents, builtIn]);
  const reloadAgents = useCallback(async () => {
    const [r, c, k, m] = await Promise.all([api.listAgents(), api.listContexts(), api.listSkills(), api.listMcp()]);
    const cn = new Map(c.ok ? c.value.map((x) => [x.id, x.name]) : []);
    const kn = new Map(k.ok ? k.value.map((x) => [x.id, x.name]) : []);
    setCatalog({
      skills: k.ok ? k.value.map((x) => ({ id: x.id, name: x.name, description: x.description })) : [],
      contexts: c.ok ? c.value.map((x) => ({ id: x.id, name: x.name })) : [],
      mcp: m.ok ? m.value.filter((x) => x.enabled).map((x) => ({ id: x.id, name: x.name, description: x.description })) : [],
    });
    setProjectAgents(
      r.ok
        ? r.value.map((a) => ({
            id: a.id,
            name: a.name,
            ...(a.description ? { description: a.description } : {}),
            model: a.model,
            skills: (a.skillIds ?? []).map((id) => kn.get(id) ?? id),
            contexts: a.contextIds.map((id) => cn.get(id) ?? id),
            skillRefs: (a.skillIds ?? []).map((id) => ({ id, name: kn.get(id) ?? id })),
            contextRefs: a.contextIds.map((id) => ({ id, name: cn.get(id) ?? id })),
            editable: true,
            ...(a.icon ? { icon: a.icon } : {}),
            ...(a.tone ? { tone: a.tone } : {}),
            ...(a.askFirst ? { askFirst: true } : {}),
            ...(a.permissions ? { permissions: a.permissions } : {}),
          }))
        : [],
    );
  }, [api]);
  useEffect(() => {
    if (project !== undefined) void reloadAgents();
    else setProjectAgents([]);
  }, [project, reloadAgents]);
  return { agents, catalog, reloadAgents };
}

export type ProjectCatalog = ReturnType<typeof useProjectCatalog>;
