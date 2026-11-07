import { SECRET_NAME, isRelativeInside } from '@orquestador/core';
import type { AgentDefinition, ContextDefinition, Id, ImportReport, ImportResult, LibraryFolders, McpServerDefinition, SkillDefinition } from '@orquestador/core';
import { UNHANDLED, isObject, safeId, type RequestCheck } from './check';
import { CHANNELS } from './contract';
import type { ApiResult } from './result';

export type ImportKind = 'folder' | 'zip';

/** Tamaño máximo de un archivo de texto de skill editado desde la interfaz [R32.35]. */
export const SKILL_FILE_MAX = 200_000;

/** Servidor MCP tal como lo ve la interfaz [R30.1]. */
export type McpView = McpServerDefinition & { secretsSet: string[] };
export interface McpTestResult {
  ok: boolean;
  message: string;
  tools: string[];
  ms: number;
}

/** Biblioteca: skills, agentes, contextos, carpetas, servidores MCP e instalación de paquetes. */
export interface KnowledgeApi {
  // --- skills e instalación (SPEC-024, SPEC-025) ---
  listSkills(): Promise<ApiResult<SkillDefinition[]>>;
  saveSkill(skill: SkillDefinition): Promise<ApiResult<null>>;
  deleteSkill(id: Id): Promise<ApiResult<boolean>>;
  skillUsage(id: Id): Promise<ApiResult<{ agentId: Id; name: string }[]>>;
  skillFiles(id: Id): Promise<ApiResult<{ path: string; size: number }[]>>;
  /** Abre el diálogo del sistema y copia los archivos o la carpeta elegidos a la skill; `null` si se cancela [R24.9]. */
  addSkillFiles(req: { id: Id; kind: 'files' | 'folder' }): Promise<ApiResult<{ added: { path: string; size: number }[]; scripts: string[]; renamed: number } | null>>;
  /** Abre el diálogo del sistema y copia archivos o una carpeta al contexto; devuelve la ruta a guardar, o `null` si se cancela [R22.14]. */
  addContextFiles(req: { id: Id; kind: 'files' | 'folder' }): Promise<ApiResult<{ value: string; files: number; bytes: number; renamed: number; scripts: string[] } | null>>;
  removeSkillFile(req: { id: Id; path: string }): Promise<ApiResult<boolean>>;
  readSkillFile(req: { id: Id; path: string }): Promise<ApiResult<{ text: string; truncated: boolean }>>;
  /** Crea o reescribe un archivo de texto de la skill (no `SKILL.md`) [R32.35]. */
  saveSkillFile(req: { id: Id; path: string; text: string }): Promise<ApiResult<null>>;
  /** Abre el diálogo del sistema y analiza el paquete; `null` si se cancela. No instala nada. */
  inspectImport(kind: ImportKind): Promise<ApiResult<{ importId: string; report: ImportReport } | null>>;
  confirmImport(req: { importId: string; keys: string[] }): Promise<ApiResult<ImportResult>>;
  cancelImport(importId: string): Promise<ApiResult<null>>;
  // --- agentes y contextos (SPEC-022) ---
  listAgents(): Promise<ApiResult<AgentDefinition[]>>;
  saveAgent(agent: AgentDefinition): Promise<ApiResult<null>>;
  deleteAgent(id: Id): Promise<ApiResult<boolean>>;
  agentUsage(id: Id): Promise<ApiResult<{ diagramId: Id; name: string }[]>>;
  listContexts(): Promise<ApiResult<ContextDefinition[]>>;
  /** Carpetas de agentes, skills, contextos y MCP del proyecto [R38.13]. */
  getLibraryFolders(): Promise<ApiResult<LibraryFolders>>;
  /** Guarda el documento entero de carpetas y devuelve cómo ha quedado [R38.13]. */
  saveLibraryFolders(folders: LibraryFolders): Promise<ApiResult<LibraryFolders>>;
  saveContext(context: ContextDefinition): Promise<ApiResult<null>>;
  deleteContext(id: Id): Promise<ApiResult<boolean>>;
  contextUsage(id: Id): Promise<ApiResult<{ agentId: Id; name: string }[]>>;
  /** Servidores MCP del proyecto, con los nombres de secreto que ya tienen valor (nunca los valores) [R30.1]. */
  listMcp(): Promise<ApiResult<McpView[]>>;
  saveMcp(server: McpServerDefinition): Promise<ApiResult<null>>;
  deleteMcp(id: Id): Promise<ApiResult<boolean>>;
  mcpUsage(id: Id): Promise<ApiResult<{ agentId: Id; name: string }[]>>;
  /** Guarda cifrado el valor de un secreto; el valor nunca vuelve a la interfaz [R30.8]. */
  setMcpSecret(req: { id: Id; name: string; value: string }): Promise<ApiResult<null>>;
  clearMcpSecret(req: { id: Id; name: string }): Promise<ApiResult<null>>;
  /** Arranca el servidor y lista sus herramientas sin gastar tokens [R30.5]. */
  testMcp(id: Id): Promise<ApiResult<McpTestResult>>;
}

export function parseKnowledgeRequest(channel: string, payload: unknown, { bad, exact, str }: RequestCheck): unknown {
  switch (channel) {
    case CHANNELS.listAgents:
    case CHANNELS.listSkills:
    case CHANNELS.listContexts:
    case CHANNELS.getLibraryFolders:
    case CHANNELS.listMcp:
      if (payload !== undefined && payload !== null) throw bad('no admite argumentos');
      return undefined;
    case CHANNELS.deleteAgent:
    case CHANNELS.agentUsage:
    case CHANNELS.deleteContext:
    case CHANNELS.contextUsage:
    case CHANNELS.deleteMcp:
    case CHANNELS.mcpUsage:
    case CHANNELS.testMcp:
    case CHANNELS.deleteSkill:
    case CHANNELS.skillUsage:
    case CHANNELS.skillFiles:
    case CHANNELS.cancelImport:
      if (!safeId(payload)) throw bad('id no válido');
      return payload;
    case CHANNELS.saveAgent: {
      if (!isObject(payload)) throw bad('se esperaba un agente');
      exact(payload, ['id', 'schemaVersion', 'name', 'description', 'instructions', 'model', 'contextIds', 'skillIds', 'mcpIds', 'maxTurns', 'askFirst', 'permissions', 'icon', 'tone', 'required']);
      if (!safeId(payload.id)) throw bad('id no válido');
      if (typeof payload.schemaVersion !== 'number') throw bad('falta la versión');
      str(payload.name, 'name', 1000);
      str(payload.description, 'description', 5000);
      str(payload.instructions, 'instructions', 200_000);
      str(payload.model, 'model', 200);
      if (!Array.isArray(payload.contextIds) || payload.contextIds.length > 200 || !payload.contextIds.every(safeId)) throw bad('contextIds no válido');
      if (payload.skillIds !== undefined && (!Array.isArray(payload.skillIds) || payload.skillIds.length > 200 || !payload.skillIds.every(safeId))) throw bad('skillIds no válido');
      if (payload.mcpIds !== undefined && (!Array.isArray(payload.mcpIds) || payload.mcpIds.length > 50 || !payload.mcpIds.every(safeId))) throw bad('mcpIds no válido');
      if (payload.maxTurns !== undefined && typeof payload.maxTurns !== 'number') throw bad('maxTurns no válido');
      if (payload.askFirst !== undefined && typeof payload.askFirst !== 'boolean') throw bad('askFirst no válido');
      if (payload.permissions !== undefined && !['readonly', 'ask', 'auto', 'full'].includes(payload.permissions as string)) throw bad('permissions no válido');
      if (payload.required !== undefined) {
        if (!isObject(payload.required)) throw bad('required no válido');
        exact(payload.required, ['skillIds', 'contextIds', 'mcpIds']);
        for (const v of Object.values(payload.required)) if (!Array.isArray(v) || v.length > 200 || !v.every(safeId)) throw bad('required no válido');
      }
      if (payload.icon !== undefined) str(payload.icon, 'icon', 40);
      if (payload.tone !== undefined) str(payload.tone, 'tone', 40);
      return payload as unknown as AgentDefinition;
    }
    case CHANNELS.saveMcp: {
      if (!isObject(payload)) throw bad('se esperaba un servidor MCP');
      exact(payload, ['id', 'schemaVersion', 'name', 'description', 'transport', 'command', 'args', 'url', 'secretNames', 'enabled', 'trusted', 'scope']);
      if (!safeId(payload.id)) throw bad('id no válido');
      if (typeof payload.schemaVersion !== 'number') throw bad('falta la versión');
      str(payload.name, 'name', 1000);
      str(payload.description, 'description', 5000, 0);
      if (payload.transport !== 'stdio' && payload.transport !== 'http') throw bad('transport no válido');
      if (payload.command !== undefined) str(payload.command, 'command', 2000, 0);
      if (payload.url !== undefined) str(payload.url, 'url', 4000, 0);
      if (payload.args !== undefined && (!Array.isArray(payload.args) || payload.args.length > 100 || payload.args.some((a) => typeof a !== 'string' || a.length > 2000))) throw bad('args no válido');
      if (payload.secretNames !== undefined && (!Array.isArray(payload.secretNames) || payload.secretNames.length > 50 || payload.secretNames.some((a) => typeof a !== 'string' || a.length > 100))) throw bad('secretNames no válido');
      if (typeof payload.enabled !== 'boolean') throw bad('enabled no válido');
      if (payload.trusted !== undefined && typeof payload.trusted !== 'boolean') throw bad('trusted no válido');
      if (payload.scope !== undefined && payload.scope !== 'project' && payload.scope !== 'app') throw bad('scope no válido');
      return payload as unknown as McpServerDefinition;
    }
    case CHANNELS.setMcpSecret:
    case CHANNELS.clearMcpSecret: {
      if (!isObject(payload)) throw bad('se esperaba un objeto');
      exact(payload, channel === CHANNELS.setMcpSecret ? ['id', 'name', 'value'] : ['id', 'name']);
      if (!safeId(payload.id)) throw bad('id no válido');
      if (typeof payload.name !== 'string' || !SECRET_NAME.test(payload.name)) throw bad('nombre de secreto no válido');
      if (channel === CHANNELS.setMcpSecret) str(payload.value, 'value', 4000, 1);
      return payload;
    }
    case CHANNELS.saveLibraryFolders: {
      if (!isObject(payload)) throw bad('se esperaban carpetas');
      exact(payload, ['schemaVersion', 'kinds']);
      if (!isObject(payload.kinds)) throw bad('kinds no válido');
      exact(payload.kinds, ['agents', 'skills', 'contexts', 'mcp', 'diagrams']);
      for (const kf of Object.values(payload.kinds)) {
        if (!isObject(kf)) throw bad('kinds no válido');
        exact(kf, ['folders', 'items']);
        if (!Array.isArray(kf.folders) || kf.folders.length > 200 || !kf.folders.every((x) => typeof x === 'string' && x.length <= 200)) throw bad('folders no válido');
        if (!isObject(kf.items) || Object.keys(kf.items).length > 5000) throw bad('items no válido');
        for (const [id, f] of Object.entries(kf.items)) if (!safeId(id) || typeof f !== 'string' || f.length > 200) throw bad('items no válido');
      }
      return payload as unknown as LibraryFolders;
    }
    case CHANNELS.saveContext: {
      if (!isObject(payload)) throw bad('se esperaba un contexto');
      exact(payload, ['id', 'schemaVersion', 'name', 'kind', 'value']);
      if (!safeId(payload.id)) throw bad('id no válido');
      if (typeof payload.schemaVersion !== 'number') throw bad('falta la versión');
      str(payload.name, 'name', 1000);
      if (payload.kind !== 'text' && payload.kind !== 'url' && payload.kind !== 'file') throw bad('kind no válido');
      str(payload.value, 'value', 300_000);
      return payload as unknown as ContextDefinition;
    }
    case CHANNELS.saveSkill: {
      if (!isObject(payload)) throw bad('se esperaba una skill');
      exact(payload, ['id', 'name', 'description', 'body']);
      if (!safeId(payload.id)) throw bad('id no válido');
      str(payload.name, 'name', 1000);
      str(payload.description, 'description', 5000);
      str(payload.body, 'body', 200_000);
      return payload as unknown as SkillDefinition;
    }
    case CHANNELS.addContextFiles:
    case CHANNELS.addSkillFiles: {
      if (!isObject(payload)) throw bad('se esperaba un objeto');
      exact(payload, ['id', 'kind']);
      if (!safeId(payload.id)) throw bad('id no válido');
      if (payload.kind !== 'files' && payload.kind !== 'folder') throw bad('kind no válido');
      return payload;
    }
    case CHANNELS.removeSkillFile:
    case CHANNELS.readSkillFile: {
      if (!isObject(payload)) throw bad('se esperaba un objeto');
      exact(payload, ['id', 'path']);
      if (!safeId(payload.id)) throw bad('id no válido');
      const rel = str(payload.path, 'path', 500, 1);
      if (!isRelativeInside(rel)) throw bad('ruta no válida');
      return payload;
    }
    case CHANNELS.saveSkillFile: {
      if (!isObject(payload)) throw bad('se esperaba un objeto');
      exact(payload, ['id', 'path', 'text']);
      if (!safeId(payload.id)) throw bad('id no válido');
      const rel = str(payload.path, 'path', 500, 1);
      if (!isRelativeInside(rel) || rel === 'SKILL.md') throw bad('ruta no válida');
      str(payload.text, 'text', SKILL_FILE_MAX, 0);
      return payload;
    }
    case CHANNELS.inspectImport:
      if (payload !== 'folder' && payload !== 'zip') throw bad('tipo de origen no válido');
      return payload;
    case CHANNELS.confirmImport: {
      if (!isObject(payload)) throw bad('se esperaba un objeto');
      exact(payload, ['importId', 'keys']);
      if (!safeId(payload.importId)) throw bad('importId no válido');
      if (!Array.isArray(payload.keys) || payload.keys.length > 1000 || !payload.keys.every((k) => typeof k === 'string' && k.length > 0 && k.length <= 600)) throw bad('keys no válido');
      return payload;
    }
    default:
      return UNHANDLED;
  }
}
