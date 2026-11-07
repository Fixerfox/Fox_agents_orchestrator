import { randomUUID } from 'node:crypto';
import { testMcpServer } from '@orquestador/claude';
import { analyzeImport, installImport, type AgentDefinition, type ContextDefinition, type LibraryFolders, type McpServerDefinition, type SkillDefinition } from '@orquestador/core';
import { CHANNELS, type ImportKind } from '@orquestador/editor';
import { StoreError, readFiles, readFolder, readFolderNamed, readZipFile } from '@orquestador/store';
import { UNHANDLED, mcpVaultKey, requireStore, scrubPaths, type HandlerState } from './state';

export async function handleKnowledge(h: HandlerState, channel: string, arg: unknown): Promise<unknown> {
  switch (channel) {
    case CHANNELS.listSkills:
      return requireStore(h).listSkills();
    case CHANNELS.saveSkill:
      await requireStore(h).saveSkill(arg as SkillDefinition);
      return null;
    case CHANNELS.deleteSkill:
      return requireStore(h).deleteSkill(arg as string);
    case CHANNELS.skillUsage:
      return requireStore(h).usageOfSkill(arg as string);
    case CHANNELS.skillFiles:
      return requireStore(h).skillFiles(arg as string);
    case CHANNELS.addSkillFiles: {
      const { id, kind } = arg as { id: string; kind: 'files' | 'folder' };
      const store = requireStore(h);
      await store.loadSkill(id);
      const picked = await h.deps.pickSkillFiles?.(kind);
      if (!picked || picked.length === 0) return null;
      const tree = kind === 'folder' ? await readFolderNamed(picked[0]!) : await readFiles(picked);
      return store.addSkillFiles(id, tree.files);
    }
    case CHANNELS.addContextFiles: {
      const { id, kind } = arg as { id: string; kind: 'files' | 'folder' };
      const store = requireStore(h);
      const picked = await h.deps.pickSkillFiles?.(kind);
      if (!picked || picked.length === 0) return null;
      const tree = kind === 'folder' ? await readFolderNamed(picked[0]!) : await readFiles(picked);
      return store.addContextFiles(id, tree.files);
    }
    case CHANNELS.removeSkillFile: {
      const { id, path } = arg as { id: string; path: string };
      return requireStore(h).removeSkillFile(id, path);
    }
    case CHANNELS.saveSkillFile: {
      const { id, path, text } = arg as { id: string; path: string; text: string };
      await requireStore(h).saveSkillText(id, path, text);
      return null;
    }
    case CHANNELS.readSkillFile: {
      const { id, path } = arg as { id: string; path: string };
      return requireStore(h).readSkillFile(id, path);
    }
    case CHANNELS.inspectImport: {
      const store = requireStore(h);
      h.pending = undefined;
      const source = await h.deps.pickImport?.(arg as ImportKind);
      if (!source) return null;
      const tree = (arg as ImportKind) === 'zip' ? await readZipFile(source) : await readFolder(source);
      const plan = analyzeImport(tree, {
        agentIds: new Set((await store.listAgents()).map((a) => a.id)),
        skillIds: new Set(await store.listSkillIds()),
      });
      h.pending = { id: randomUUID(), plan };
      return { importId: h.pending.id, report: plan.report };
    }
    case CHANNELS.confirmImport: {
      const { importId, keys } = arg as { importId: string; keys: string[] };
      const store = requireStore(h);
      if (!h.pending || h.pending.id !== importId) throw new StoreError('not-found', 'Esa importación ya no está disponible; vuelve a elegir el paquete');
      const { plan } = h.pending;
      h.pending = undefined; // una importación solo se confirma una vez
      return installImport(store, plan, keys);
    }
    case CHANNELS.cancelImport:
      if (h.pending?.id === (arg as string)) h.pending = undefined;
      return null;
    case CHANNELS.listAgents:
      return requireStore(h).listAgents();
    case CHANNELS.saveAgent:
      await requireStore(h).saveAgent(arg as AgentDefinition);
      return null;
    case CHANNELS.deleteAgent:
      return requireStore(h).deleteAgent(arg as string);
    case CHANNELS.agentUsage:
      return requireStore(h).usageOfAgent(arg as string);
    case CHANNELS.listContexts:
      return requireStore(h).listContexts();
    case CHANNELS.getLibraryFolders:
      return requireStore(h).getLibraryFolders();
    case CHANNELS.saveLibraryFolders:
      return requireStore(h).saveLibraryFolders(arg as LibraryFolders);
    case CHANNELS.saveContext:
      await requireStore(h).saveContext(arg as ContextDefinition);
      return null;
    case CHANNELS.deleteContext:
      return requireStore(h).deleteContext(arg as string);
    case CHANNELS.contextUsage:
      return requireStore(h).usageOfContext(arg as string);
    case CHANNELS.listMcp: {
      const store = requireStore(h);
      const root = h.root!;
      return Promise.all((await store.listMcp()).map(async (m) => ({ ...m, secretsSet: (await h.deps.mcpVault?.names(mcpVaultKey(root, m.id, m.scope))) ?? [] })));
    }
    case CHANNELS.saveMcp: {
      const store = requireStore(h);
      const def = arg as McpServerDefinition;
      const before = await store.scopeOfMcp(def.id);
      await store.saveMcp(def);
      const after = def.scope ?? 'project';
      // al cambiar de ámbito, los secretos se mueven con el servidor [R30.9]
      if (before && before !== after) await h.deps.mcpVault?.move(mcpVaultKey(h.root!, def.id, before), mcpVaultKey(h.root!, def.id, after));
      return null;
    }
    case CHANNELS.deleteMcp: {
      const id = arg as string;
      const store = requireStore(h);
      const scope = await store.scopeOfMcp(id);
      const gone = await store.deleteMcp(id);
      if (scope) await h.deps.mcpVault?.remove(mcpVaultKey(h.root!, id, scope));
      return gone;
    }
    case CHANNELS.mcpUsage:
      return requireStore(h).usageOfMcp(arg as string);
    case CHANNELS.setMcpSecret: {
      const { id, name, value } = arg as { id: string; name: string; value: string };
      const scope = await requireStore(h).scopeOfMcp(id);
      if (!scope) throw new StoreError('not-found', 'Guarda primero el servidor MCP');
      if (!h.deps.mcpVault) throw new StoreError('unavailable', 'Este sistema no ofrece almacenamiento cifrado: el secreto no se guarda');
      await h.deps.mcpVault.set(mcpVaultKey(h.root!, id, scope), name, value);
      return null;
    }
    case CHANNELS.clearMcpSecret: {
      const { id, name } = arg as { id: string; name: string };
      const scope = await requireStore(h).scopeOfMcp(id);
      if (scope) await h.deps.mcpVault?.remove(mcpVaultKey(h.root!, id, scope), name);
      return null;
    }
    case CHANNELS.testMcp: {
      const store = requireStore(h);
      const root = h.root!;
      if (!h.deps.claudeQuery) throw new StoreError('unavailable', 'El motor de Claude no está disponible');
      const def = (await store.listMcp()).find((m) => m.id === (arg as string));
      if (!def) throw new StoreError('not-found', 'No existe ese servidor MCP');
      const secrets = (await h.deps.mcpVault?.read(mcpVaultKey(root, def.id, def.scope))) ?? {};
      const r = await testMcpServer({ query: h.deps.claudeQuery, server: { def, secrets }, settings: h.settings, apiKey: await h.deps.vault?.read(), cwd: root });
      return { ...r, message: scrubPaths(r.message, root) };
    }
    default:
      return UNHANDLED;
  }
}
