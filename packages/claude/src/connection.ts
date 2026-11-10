import { AgentError, loadsClaudeConfig, type AppSettings } from '@orquestador/core';
import { READ_ONLY_TOOLS } from './prompt';
import type { ClaudeQueryOptions, PermissionResult } from './sdk-types';

/** Variables del proceso del SDK según Ajustes; la clave solo viaja aquí [R27.8]. */
export function buildEnv(settings: AppSettings, apiKey: string | undefined, base: Record<string, string | undefined> = process.env): Record<string, string | undefined> {
  const env = { ...base };
  if (settings.authMode === 'api-key') {
    if (!apiKey) throw new AgentError('Falta la clave API. Guárdala en Ajustes o cambia a la sesión de Claude Code.', false);
    env['ANTHROPIC_API_KEY'] = apiKey;
  } else {
    delete env['ANTHROPIC_API_KEY'];
  }
  // La memoria propia de Claude Code se apaga salvo que se pida: toda la memoria que cambia a los agentes, a la vista [R76.18].
  if (settings.claudeAutoMemory === true) delete env['CLAUDE_CODE_DISABLE_AUTO_MEMORY'];
  else env['CLAUDE_CODE_DISABLE_AUTO_MEMORY'] = '1';
  return env;
}

/** Solo lectura y búsqueda; la usan las consultas sin escritura (decisiones, borradores, prueba de conexión) [R27.9]. */
export async function permissionPolicy(tool: string, input: Record<string, unknown>): Promise<PermissionResult> {
  if ((READ_ONLY_TOOLS as readonly string[]).includes(tool)) return { behavior: 'allow', updatedInput: input };
  return { behavior: 'deny', message: `La herramienta ${tool} aún no está permitida: por ahora los agentes solo pueden leer y buscar.` };
}

/** Herramientas que se aprueban sin pasar por la política: no escriben ni ejecutan nada por sí mismas [R50.2]. */
export const AUTO_TOOLS = ['Agent', 'TodoWrite', 'Skill'] as const;

/** Fuentes de configuración de Claude Code: todas, como la CLI, o ninguna [R50.3]. */
export const CLAUDE_SETTING_SOURCES = ['user', 'project', 'local'] as const;
/** Sin confianza en el proyecto, solo la del usuario: la del repositorio puede traer hooks o env [R88.2]. */
export const settingSourcesFor = (settings: AppSettings, projectTrusted = true): string[] => (!loadsClaudeConfig(settings) ? [] : projectTrusted ? [...CLAUDE_SETTING_SOURCES] : ['user']);

export function baseOptions(args: {
  settings: AppSettings;
  apiKey: string | undefined;
  cwd: string;
  model?: string;
  maxTurns?: number;
  maxBudgetUsd?: number;
  controller: AbortController;
  tools?: boolean;
  toolList?: readonly string[];
  canUseTool?: ClaudeQueryOptions['canUseTool'];
  /** Paso de agente: carga la configuración de Claude Code y solo sus MCP [R50.3]. */
  claudeCode?: boolean;
  /** ¿Se carga la configuración de Claude Code del proyecto? [R88.4] */
  projectTrusted?: boolean;
}): ClaudeQueryOptions {
  const tools = args.tools === false ? [] : [...(args.toolList ?? READ_ONLY_TOOLS)];
  // En los pasos de agente las lecturas y la web también pasan por la política [R87.3].
  const auto = (args.claudeCode ? [...AUTO_TOOLS] : [...READ_ONLY_TOOLS, ...AUTO_TOOLS]) as readonly string[];
  return {
    model: args.model ?? args.settings.defaultModel,
    cwd: args.cwd,
    ...(args.maxTurns !== undefined ? { maxTurns: args.maxTurns } : {}),
    ...(args.maxBudgetUsd !== undefined ? { maxBudgetUsd: args.maxBudgetUsd } : {}),
    tools,
    // `allowedTools` aprueba sin llamar a `canUseTool`: solo las lecturas. Escribir, ejecutar y preguntar pasan
    // siempre por la política (copia, permiso y registro de lo tocado) [R45.1].
    allowedTools: tools.filter((t) => auto.includes(t)),
    permissionMode: 'default',
    canUseTool: args.canUseTool ?? permissionPolicy,
    abortController: args.controller,
    env: buildEnv(args.settings, args.apiKey),
    settingSources: args.claudeCode ? settingSourcesFor(args.settings, args.projectTrusted ?? true) : [],
    ...(args.claudeCode ? { strictMcpConfig: true } : {}),
    persistSession: false,
  };
}
