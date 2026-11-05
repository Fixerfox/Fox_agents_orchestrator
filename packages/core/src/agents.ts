import type { Id } from './types';

/** Modelos que se pueden asignar a un agente. */
export const MODELS = [
  { id: 'claude-sonnet-5-5', name: 'Sonnet 5.5' },
  { id: 'claude-opus-5-5', name: 'Opus 5.5' },
  { id: 'claude-haiku-5-5', name: 'Haiku 5.5' },
] as const;
export const DEFAULT_MODEL = 'claude-sonnet-5-5';

export const AGENT_SCHEMA_VERSION = 1;
export const CONTEXT_SCHEMA_VERSION = 1;
/** v2: el nivel de permisos pasa a «Sin preguntar nunca» al migrar [R51.1]. */
export const SETTINGS_SCHEMA_VERSION = 2;

export const LIMITS = {
  name: 60,
  description: 300,
  instructions: 20_000,
  contextText: 100_000,
  contextValue: 2_000,
  maxTurns: 200,
  maxParallel: 16,
} as const;

/** Agente del proyecto [R22.1]. */
export interface AgentDefinition {
  id: Id;
  schemaVersion: number;
  name: string;
  description: string;
  instructions: string;
  model: string;
  /** Contextos asignados; se entregan por referencia. */
  contextIds: Id[];
  /** Skills del proyecto asignadas [R24.4]. */
  skillIds: Id[];
  /** Servidores MCP del proyecto asignados [R30.3]. */
  mcpIds?: Id[];
  maxTurns?: number;
  /** Pregunta siempre antes de implementar o decidir [R39.1]. */
  askFirst?: boolean;
  /** Permisos propios; sin valor, los del proyecto [R47.10]. */
  permissions?: PermissionLevel;
  /** Lo del agente que es obligatorio en cada paso: va entero en el prompt o se comprueba que lo usa [R39.12]. */
  required?: { skillIds?: Id[]; contextIds?: Id[]; mcpIds?: Id[] };
  /** Icono y tono del catálogo para reconocerlo [R39.7]. */
  icon?: AgentIcon;
  tone?: AgentTone;
}

/** Iconos que se pueden poner a un agente [R39.7]. */
export const AGENT_ICONS = [
  'bot', 'brain', 'code', 'bug', 'test', 'search', 'shield', 'scroll', 'pen', 'palette', 'image', 'music',
  'gamepad', 'map', 'swords', 'database', 'globe', 'wrench', 'hammer', 'rocket', 'lightbulb', 'clipboard', 'eye', 'layers',
] as const;
export type AgentIcon = (typeof AGENT_ICONS)[number];
/** Tonos del icono [R39.7]. */
export const AGENT_TONES = ['neutral', 'amber', 'blue', 'green', 'rose', 'violet', 'teal'] as const;
export type AgentTone = (typeof AGENT_TONES)[number];

export type ContextKind = 'text' | 'url' | 'file';

/** Contexto del proyecto [R22.2]: texto, URL o ruta relativa de un archivo del proyecto. */
export interface ContextDefinition {
  id: Id;
  schemaVersion: number;
  name: string;
  kind: ContextKind;
  value: string;
}

export type AuthMode = 'claude-code' | 'api-key';
/** Motor de los agentes: simulado (demo) o Claude real [R27.1]. */
export type Engine = 'simulated' | 'claude';

/** Ajustes globales de la app [R23.1]. Nunca incluyen secretos. */
export interface AppSettings {
  schemaVersion: number;
  authMode: AuthMode;
  engine: Engine;
  defaultModel: string;
  maxParallel: number;
  defaultMaxTokens?: number;
  /** Permisos de los agentes del proyecto [R47.8]; sin valor, «sin preguntar nunca» [R51.1]. */
  permissions?: ProjectPermission;
  /**
   * Cargar la configuración de Claude Code (CLAUDE.md, `.claude` y `~/.claude`) en los agentes y el asistente
   * [R50.3]; sin valor, activado.
   */
  claudeConfig?: boolean;
}

/** ¿Se carga la configuración de Claude Code? Activado salvo que se apague [R50.3]. */
export const loadsClaudeConfig = (settings: Pick<AppSettings, 'claudeConfig'>): boolean => settings.claudeConfig !== false;

/**
 * Niveles de permisos [R47.8]: solo lectura (solo para un agente), preguntar, automático (solo pregunta lo
 * delicado: borrar, salir de la carpeta, publicar fuera) y sin preguntar nunca.
 */
export const PERMISSION_LEVELS = ['readonly', 'ask', 'auto', 'full'] as const;
export type PermissionLevel = (typeof PERMISSION_LEVELS)[number];
export const PROJECT_PERMISSIONS = ['ask', 'auto', 'full'] as const;
export type ProjectPermission = (typeof PROJECT_PERMISSIONS)[number];
/** Por defecto no se pregunta nada [R51.1]. */
export const DEFAULT_PERMISSION: ProjectPermission = 'full';

/** Nivel del proyecto [R47.8]. */
export const projectPermission = (settings: Pick<AppSettings, 'permissions'>): ProjectPermission => settings.permissions ?? DEFAULT_PERMISSION;
/** El del agente si lo tiene; si no, el del proyecto [R47.10]. */
export const effectivePermission = (agent: Pick<AgentDefinition, 'permissions'>, settings: Pick<AppSettings, 'permissions'>): PermissionLevel =>
  agent.permissions ?? projectPermission(settings);

export interface FieldProblem {
  field: string;
  message: string;
}

export const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
export const isSafeId = (v: unknown): v is string => typeof v === 'string' && SAFE_ID.test(v) && !v.includes('..');

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const known = (model: unknown) => MODELS.some((m) => m.id === model);

export function defaultSettings(): AppSettings {
  return { schemaVersion: SETTINGS_SCHEMA_VERSION, authMode: 'claude-code', engine: 'simulated', defaultModel: DEFAULT_MODEL, maxParallel: 4 };
}

export function newAgent(id: Id, name: string): AgentDefinition {
  return { id, schemaVersion: AGENT_SCHEMA_VERSION, name, description: '', instructions: '', model: DEFAULT_MODEL, contextIds: [], skillIds: [] };
}

export function newContext(id: Id, name: string, kind: ContextKind = 'text'): ContextDefinition {
  return { id, schemaVersion: CONTEXT_SCHEMA_VERSION, name, kind, value: '' };
}

/** Valida un agente. `contextIds` son los contextos que existen en el proyecto [R22.1][R22.4]. */
export function validateAgent(a: unknown, existing: { contextIds: ReadonlySet<Id>; skillIds?: ReadonlySet<Id>; mcpIds?: ReadonlySet<Id> }): FieldProblem[] {
  if (!isObject(a)) return [{ field: 'agent', message: 'El agente no es válido' }];
  const out: FieldProblem[] = [];
  if (!isSafeId(a.id)) out.push({ field: 'id', message: 'El identificador no es válido' });
  const name = typeof a.name === 'string' ? a.name.trim() : '';
  if (name.length === 0) out.push({ field: 'name', message: 'Escribe un nombre' });
  else if (name.length > LIMITS.name) out.push({ field: 'name', message: `El nombre admite hasta ${LIMITS.name} caracteres` });
  if (typeof a.description !== 'string') out.push({ field: 'description', message: 'La descripción no es válida' });
  else if (a.description.length > LIMITS.description) out.push({ field: 'description', message: `La descripción admite hasta ${LIMITS.description} caracteres` });
  if (typeof a.instructions !== 'string') out.push({ field: 'instructions', message: 'Las instrucciones no son válidas' });
  else if (a.instructions.length > LIMITS.instructions) out.push({ field: 'instructions', message: `Las instrucciones admiten hasta ${LIMITS.instructions} caracteres` });
  if (!known(a.model)) out.push({ field: 'model', message: 'Elige un modelo de la lista' });
  if (!Array.isArray(a.contextIds) || a.contextIds.some((c) => typeof c !== 'string')) out.push({ field: 'contextIds', message: 'Los contextos no son válidos' });
  else {
    const missing = (a.contextIds as string[]).filter((c) => !existing.contextIds.has(c));
    if (missing.length > 0) out.push({ field: 'contextIds', message: `No existe el contexto: ${missing.join(', ')}` });
    if (new Set(a.contextIds as string[]).size !== a.contextIds.length) out.push({ field: 'contextIds', message: 'Hay contextos repetidos' });
  }
  const skills = a.skillIds ?? [];
  if (!Array.isArray(skills) || skills.some((c) => typeof c !== 'string')) out.push({ field: 'skillIds', message: 'Las skills no son válidas' });
  else {
    const missing = existing.skillIds ? (skills as string[]).filter((c) => !existing.skillIds!.has(c)) : [];
    if (missing.length > 0) out.push({ field: 'skillIds', message: `No existe la skill: ${missing.join(', ')}` });
    if (new Set(skills as string[]).size !== skills.length) out.push({ field: 'skillIds', message: 'Hay skills repetidas' });
  }
  if (a.mcpIds !== undefined) {
    const mcp = a.mcpIds;
    if (!Array.isArray(mcp) || mcp.some((c) => typeof c !== 'string')) out.push({ field: 'mcpIds', message: 'Los servidores MCP no son válidos' });
    else {
      const missing = existing.mcpIds ? (mcp as string[]).filter((c) => !existing.mcpIds!.has(c)) : [];
      if (missing.length > 0) out.push({ field: 'mcpIds', message: `No existe el servidor MCP: ${missing.join(', ')}` });
      if (new Set(mcp as string[]).size !== mcp.length) out.push({ field: 'mcpIds', message: 'Hay servidores MCP repetidos' });
    }
  }
  if (a.required !== undefined) {
    const req = a.required as Record<string, unknown>;
    const own: Record<string, unknown> = { skillIds: a.skillIds ?? [], contextIds: a.contextIds, mcpIds: a.mcpIds ?? [] };
    const bad =
      !isObject(req) ||
      Object.entries(req).some(([k, v]) => !(k in own) || !Array.isArray(v) || v.some((x) => typeof x !== 'string' || !(Array.isArray(own[k]) && (own[k] as unknown[]).includes(x))));
    if (bad) out.push({ field: 'required', message: 'Lo obligatorio tiene que estar asignado al agente' });
  }
  if (a.askFirst !== undefined && typeof a.askFirst !== 'boolean') out.push({ field: 'askFirst', message: '«Pregunta antes de actuar» no es válido' });
  if (a.permissions !== undefined && !(PERMISSION_LEVELS as readonly unknown[]).includes(a.permissions)) out.push({ field: 'permissions', message: 'Elige un nivel de permisos de la lista' });
  if (a.icon !== undefined && !(AGENT_ICONS as readonly unknown[]).includes(a.icon)) out.push({ field: 'icon', message: 'Elige un icono de la lista' });
  if (a.tone !== undefined && !(AGENT_TONES as readonly unknown[]).includes(a.tone)) out.push({ field: 'tone', message: 'Elige un tono de la lista' });
  if (a.maxTurns !== undefined && !(Number.isInteger(a.maxTurns) && (a.maxTurns as number) >= 1 && (a.maxTurns as number) <= LIMITS.maxTurns)) {
    out.push({ field: 'maxTurns', message: `El máximo de turnos va de 1 a ${LIMITS.maxTurns}` });
  }
  return out;
}

/** `true` si la ruta es relativa, sin `..` y sin letra de unidad [R22.2]. */
export function isRelativeInside(path: string): boolean {
  if (path.length === 0 || path.startsWith('/') || path.startsWith('\\') || /^[A-Za-z]:/.test(path)) return false;
  return !path.split(/[\\/]/).some((seg) => seg === '..');
}

export function validateContext(c: unknown): FieldProblem[] {
  if (!isObject(c)) return [{ field: 'context', message: 'El contexto no es válido' }];
  const out: FieldProblem[] = [];
  if (!isSafeId(c.id)) out.push({ field: 'id', message: 'El identificador no es válido' });
  const name = typeof c.name === 'string' ? c.name.trim() : '';
  if (name.length === 0) out.push({ field: 'name', message: 'Escribe un nombre' });
  else if (name.length > LIMITS.name) out.push({ field: 'name', message: `El nombre admite hasta ${LIMITS.name} caracteres` });
  const value = typeof c.value === 'string' ? c.value : undefined;
  if (c.kind !== 'text' && c.kind !== 'url' && c.kind !== 'file') out.push({ field: 'kind', message: 'Elige un tipo de contexto' });
  else if (value === undefined) out.push({ field: 'value', message: 'El contenido no es válido' });
  else if (c.kind === 'text') {
    if (value.trim().length === 0) out.push({ field: 'value', message: 'Escribe el texto del contexto' });
    else if (value.length > LIMITS.contextText) out.push({ field: 'value', message: `El texto admite hasta ${LIMITS.contextText} caracteres` });
  } else if (value.length > LIMITS.contextValue) out.push({ field: 'value', message: `Admite hasta ${LIMITS.contextValue} caracteres` });
  else if (c.kind === 'url') {
    let ok: boolean;
    try {
      const u = new URL(value);
      ok = u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      ok = false;
    }
    if (!ok) out.push({ field: 'value', message: 'Escribe una dirección que empiece por http:// o https://' });
  } else if (!isRelativeInside(value)) {
    out.push({ field: 'value', message: 'Escribe una ruta relativa dentro del proyecto, sin «..»' });
  }
  return out;
}

/** Valida ajustes; los que faltan se completan con los de por defecto en `normalizeSettings`. */
export function validateSettings(s: unknown): FieldProblem[] {
  if (!isObject(s)) return [{ field: 'settings', message: 'Los ajustes no son válidos' }];
  const out: FieldProblem[] = [];
  if (s.authMode !== 'claude-code' && s.authMode !== 'api-key') out.push({ field: 'authMode', message: 'Elige cómo se conecta Claude' });
  if (s.engine !== 'simulated' && s.engine !== 'claude') out.push({ field: 'engine', message: 'Elige el motor de los agentes' });
  if (!known(s.defaultModel)) out.push({ field: 'defaultModel', message: 'Elige un modelo de la lista' });
  if (!(Number.isInteger(s.maxParallel) && (s.maxParallel as number) >= 1 && (s.maxParallel as number) <= LIMITS.maxParallel)) {
    out.push({ field: 'maxParallel', message: `Los agentes en paralelo van de 1 a ${LIMITS.maxParallel}` });
  }
  if (s.defaultMaxTokens !== undefined && !(Number.isInteger(s.defaultMaxTokens) && (s.defaultMaxTokens as number) > 0)) {
    out.push({ field: 'defaultMaxTokens', message: 'El límite de tokens debe ser un número entero mayor que cero' });
  }
  if (s.permissions !== undefined && !(PROJECT_PERMISSIONS as readonly unknown[]).includes(s.permissions)) out.push({ field: 'permissions', message: 'Elige un nivel de permisos de la lista' });
  if (s.claudeConfig !== undefined && typeof s.claudeConfig !== 'boolean') out.push({ field: 'claudeConfig', message: '«Cargar la configuración de Claude Code» no es válido' });
  return out;
}

/** Completa con los valores por defecto lo que falta o no es válido (para leer ajustes antiguos o dañados). */
export function normalizeSettings(raw: unknown): AppSettings {
  const base = defaultSettings();
  if (!isObject(raw)) return base;
  const out: AppSettings = { ...base };
  if (raw.authMode === 'claude-code' || raw.authMode === 'api-key') out.authMode = raw.authMode;
  if (raw.engine === 'simulated' || raw.engine === 'claude') out.engine = raw.engine;
  if (known(raw.defaultModel)) out.defaultModel = raw.defaultModel as string;
  if (Number.isInteger(raw.maxParallel) && (raw.maxParallel as number) >= 1 && (raw.maxParallel as number) <= LIMITS.maxParallel) out.maxParallel = raw.maxParallel as number;
  if (Number.isInteger(raw.defaultMaxTokens) && (raw.defaultMaxTokens as number) > 0) out.defaultMaxTokens = raw.defaultMaxTokens as number;
  // Ajustes anteriores a R47.8: «Modificar sin preguntar» pasa a automático y «preguntar todos los comandos», a preguntar.
  if ((PROJECT_PERMISSIONS as readonly unknown[]).includes(raw.permissions)) out.permissions = raw.permissions as ProjectPermission;
  else if (raw.askCommands === true) out.permissions = 'ask';
  else if (raw.autoWrite === true) out.permissions = 'auto';
  if (typeof raw.claudeConfig === 'boolean') out.claudeConfig = raw.claudeConfig;
  return out;
}

/** Id único a partir de un nombre: minúsculas, sin acentos, con guiones [R22.6]. */
export function slugify(name: string, taken: ReadonlySet<Id>, fallback = 'elemento'): Id {
  const base =
    name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || fallback;
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

/** Quita un contexto de los agentes que lo usaban y devuelve solo los que cambian [R22.4]. */
export function withoutContext(agents: readonly AgentDefinition[], contextId: Id): AgentDefinition[] {
  return agents
    .filter((a) => a.contextIds.includes(contextId))
    .map((a) => ({ ...a, contextIds: a.contextIds.filter((c) => c !== contextId) }));
}

/** Quita una skill de los agentes que la usaban y devuelve solo los que cambian [R24.4]. */
export function withoutSkill(agents: readonly AgentDefinition[], skillId: Id): AgentDefinition[] {
  return agents
    .filter((a) => (a.skillIds ?? []).includes(skillId))
    .map((a) => ({ ...a, skillIds: (a.skillIds ?? []).filter((c) => c !== skillId) }));
}
