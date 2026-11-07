import {
  analyzeImport,
  emptyLibraryFolders,
  installImport,
  planSkillFiles,
  tidyLibraryFolders,
  validateAgent,
  validateContext,
  validateLibraryFolders,
  validateMcpServer,
  validateSkill,
  withoutContext,
  withoutSkill,
  type Diagram,
} from '@orquestador/core';
import { fail, ok } from '@orquestador/editor';
import { invalid } from './state';
import type { MemoryApi, MemoryApiOptions, MemoryState } from './types';

/** Biblioteca: skills, agentes, contextos, carpetas, servidores MCP e instalación de paquetes. */
export function memoryKnowledge(s: MemoryState, options: MemoryApiOptions) {
  const { saved, agents, contexts, mcp, mcpSecrets, skills } = s;
  let folders = tidyLibraryFolders(options.folders ?? emptyLibraryFolders());
  const enc = new TextEncoder();
  const skillData = new Map<string, Map<string, Uint8Array>>(
    Object.entries(options.skillFiles ?? {}).map(([id, files]) => [id, new Map(Object.entries(files).map(([p, text]) => [p, enc.encode(text)]))]),
  );
  const filesOf = (id: string) => skillData.get(id) ?? skillData.set(id, new Map()).get(id)!;
  const listFiles = (id: string) => [...filesOf(id)].map(([path, d]) => ({ path, size: d.length })).sort((a, b) => a.path.localeCompare(b.path));
  const usesAgent = (d: Diagram, id: string): boolean =>
    d.nodes.some((n) => (n.kind === 'agent' && n.agentId === id) || (n.kind === 'loop' && n.loop !== undefined && usesAgent(n.loop.body, id)));

  return {
    folders: () => structuredClone(folders),
    async listAgents() {
      return ok([...agents.values()].map((a) => structuredClone(a)));
    },
    async saveAgent(agent) {
      const problems = validateAgent(agent, { contextIds: new Set(contexts.keys()), skillIds: new Set(skills.keys()), mcpIds: new Set(mcp.keys()) });
      if (problems.length > 0) return invalid(problems);
      agents.set(agent.id, structuredClone({ ...agent, name: agent.name.trim() }));
      return ok(null);
    },
    async deleteAgent(id) {
      return ok(agents.delete(id));
    },
    async agentUsage(id) {
      return ok([...saved.values()].filter((d) => usesAgent(d, id)).map((d) => ({ diagramId: d.id, name: d.name })));
    },
    async listSkills() {
      return ok([...skills.values()].map((k) => structuredClone(k)));
    },
    async saveSkill(skill) {
      const problems = validateSkill(skill);
      if (problems.length > 0) return invalid(problems);
      skills.set(skill.id, structuredClone({ ...skill, name: skill.name.trim(), description: skill.description.trim() }));
      return ok(null);
    },
    async deleteSkill(id) {
      for (const a of withoutSkill([...agents.values()], id)) agents.set(a.id, a);
      return ok(skills.delete(id));
    },
    async skillUsage(id) {
      return ok([...agents.values()].filter((a) => a.skillIds.includes(id)).map((a) => ({ agentId: a.id, name: a.name })));
    },
    async skillFiles(id) {
      return skills.has(id) ? ok(listFiles(id)) : fail('not-found', `No existe la skill ${id}`);
    },
    async addSkillFiles({ id }) {
      if (!skills.has(id)) return fail('not-found', `No existe la skill ${id}`);
      if (!options.pickedFiles) return ok(null);
      const plan = planSkillFiles(listFiles(id), options.pickedFiles.files);
      if (!plan.ok) return fail('invalid', plan.message);
      for (const f of plan.add) filesOf(id).set(f.path, f.data);
      return ok({ added: plan.add.map((f) => ({ path: f.path, size: f.data.length })), scripts: plan.scripts, renamed: plan.renamed });
    },
    async addContextFiles({ id }) {
      const pick = options.contextPick ?? { value: `.orquestador/context-files/${id}/archivos`, files: 3, bytes: 4200, renamed: 0, scripts: [] };
      return ok(pick === 'cancel' ? null : structuredClone(pick));
    },
    async removeSkillFile({ id, path }) {
      if (path === 'SKILL.md' || path.includes('..')) return fail('outside-root', 'Ruta de archivo no válida en la skill');
      return ok(filesOf(id).delete(path));
    },
    async saveSkillFile({ id, path, text }) {
      if (path === 'SKILL.md' || path.includes('..')) return fail('outside-root', 'Ruta de archivo no válida en la skill');
      if (!skills.has(id)) return fail('not-found', `No existe la skill ${id}`);
      const old = filesOf(id).get(path);
      if (old && old.subarray(0, 8000).includes(0)) return fail('invalid', 'Ese archivo no es de texto y no se puede editar aquí');
      filesOf(id).set(path, new TextEncoder().encode(text));
      return ok(null);
    },
    async readSkillFile({ id, path }) {
      const d = filesOf(id).get(path);
      if (!d) return fail('not-found', 'No existe ese archivo');
      if (d.subarray(0, 8000).includes(0)) return fail('invalid', 'Este archivo no es de texto y no se puede mostrar');
      const text = new TextDecoder().decode(d);
      return ok(text.length > 200_000 ? { text: text.slice(0, 200_000), truncated: true } : { text, truncated: false });
    },
    async inspectImport() {
      s.pending = undefined;
      if (!options.importTree) return ok(null);
      const plan = analyzeImport(options.importTree, { agentIds: new Set(agents.keys()), skillIds: new Set(skills.keys()) });
      s.pending = { id: `import-${++s.importCount}`, plan };
      return ok({ importId: s.pending.id, report: plan.report });
    },
    async confirmImport({ importId, keys }) {
      if (!s.pending || s.pending.id !== importId) return fail('not-found', 'Esa importación ya no está disponible; vuelve a elegir el paquete');
      const { plan } = s.pending;
      s.pending = undefined;
      return ok(
        await installImport(
          {
            listAgents: async () => [...agents.values()],
            listSkillIds: async () => [...skills.keys()],
            saveSkill: async (k) => void skills.set(k.id, structuredClone(k)),
            writeSkillFile: async (id, rel, data) => void filesOf(id).set(rel, data),
            deleteSkill: async (id) => skills.delete(id),
            saveAgent: async (a) => void agents.set(a.id, structuredClone(a)),
          },
          plan,
          keys,
        ),
      );
    },
    async cancelImport(importId) {
      if (s.pending?.id === importId) s.pending = undefined;
      return ok(null);
    },
    async getLibraryFolders() {
      return ok(structuredClone(folders));
    },
    async saveLibraryFolders(next) {
      const problem = validateLibraryFolders(next);
      if (problem) return fail('invalid', problem);
      folders = tidyLibraryFolders(next);
      return ok(structuredClone(folders));
    },
    async listContexts() {
      return ok([...contexts.values()].map((c) => structuredClone(c)));
    },
    async saveContext(context) {
      const problems = validateContext(context);
      if (problems.length > 0) return invalid(problems);
      contexts.set(context.id, structuredClone({ ...context, name: context.name.trim() }));
      return ok(null);
    },
    async deleteContext(id) {
      for (const a of withoutContext([...agents.values()], id)) agents.set(a.id, a);
      return ok(contexts.delete(id));
    },
    async contextUsage(id) {
      return ok([...agents.values()].filter((a) => a.contextIds.includes(id)).map((a) => ({ agentId: a.id, name: a.name })));
    },
    async listMcp() {
      if (!s.open) return fail('no-project', 'No hay proyecto abierto');
      return ok([...mcp.values()].map((m) => ({ ...structuredClone(m), scope: m.scope ?? 'project', secretsSet: Object.keys(mcpSecrets.get(m.id) ?? {}).sort() })));
    },
    async saveMcp(server) {
      const problems = validateMcpServer(server);
      if (problems.length > 0) return invalid(problems);
      mcp.set(server.id, structuredClone({ ...server, name: server.name.trim() }));
      return ok(null);
    },
    async deleteMcp(id) {
      for (const a of agents.values()) if ((a.mcpIds ?? []).includes(id)) a.mcpIds = (a.mcpIds ?? []).filter((x) => x !== id);
      mcpSecrets.delete(id);
      return ok(mcp.delete(id));
    },
    async mcpUsage(id) {
      return ok([...agents.values()].filter((a) => (a.mcpIds ?? []).includes(id)).map((a) => ({ agentId: a.id, name: a.name })));
    },
    async setMcpSecret({ id, name, value }) {
      if (!mcp.has(id)) return fail('not-found', 'No existe ese servidor MCP');
      mcpSecrets.set(id, { ...(mcpSecrets.get(id) ?? {}), [name]: value });
      return ok(null);
    },
    async clearMcpSecret({ id, name }) {
      const cur = { ...(mcpSecrets.get(id) ?? {}) };
      delete cur[name];
      mcpSecrets.set(id, cur);
      return ok(null);
    },
    async testMcp(id) {
      const m = mcp.get(id);
      if (!m) return fail('not-found', 'No existe ese servidor MCP');
      const t = options.mcpTest;
      if (typeof t === 'function') return ok(t(id));
      return ok(t ?? { ok: true, message: `«${m.name}» responde (simulado).`, tools: ['buscar', 'leer'], ms: 40 });
    },
  } satisfies Partial<MemoryApi>;
}
