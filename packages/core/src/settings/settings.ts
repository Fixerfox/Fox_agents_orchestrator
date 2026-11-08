import { DEFAULT_MODEL, DEFAULT_PERMISSION, type FieldProblem, LIMITS, MODELS, PROJECT_PERMISSIONS, type PermissionLevel, type ProjectPermission, type StepLimits, type UnansweredPolicy, limitProblems, readUnanswered } from '../shared';

/** v2: el nivel de permisos pasa a «Sin preguntar nunca» al migrar [R51.1]. */
export const SETTINGS_SCHEMA_VERSION = 2;

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
  /** El Supervisor revisa con IA; sin valor, activado [R60.14]. */
  supervisorReview?: boolean;
  /** Modelo del Supervisor; sin valor, el rápido y barato [R60.14]. */
  supervisorModel?: string;
  /** Lo que solo puede comprobar una persona: avisar (por defecto) o hacer fallar la ejecución [R65.2]. */
  supervisorHumanChecks?: HumanChecks;
  /** «Límites de tiempo»: inactividad y herramienta en curso por defecto [R70.21]. */
  limits?: Pick<StepLimits, 'idleMinutes' | 'toolMinutes'>;
  /** Qué hacer por defecto con una pregunta que nadie responde [R70.21]. */
  unanswered?: UnansweredPolicy;
  /** Tope de la memoria de la ejecución, en tokens [R72.15]. */
  memoryTokens?: number;
}

/** Rango del tope de la memoria [R72.15]. */
export const MEMORY_TOKENS_RANGE = [500, 8000] as const;
const memoryTokensOk = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= MEMORY_TOKENS_RANGE[0] && (v as number) <= MEMORY_TOKENS_RANGE[1];

export const HUMAN_CHECKS = ['warn', 'fail'] as const;
export type HumanChecks = (typeof HUMAN_CHECKS)[number];

/** Modelo del Supervisor si no se elige otro [R60.14]. */
export const SUPERVISOR_MODEL = 'claude-haiku-5-5';
/** Modelo fijo del Juez de las revisiones: no se configura [R34.26]. */
export const JUDGE_MODEL = 'claude-haiku-5-5';

/** ¿Revisa con IA el Supervisor? Activado salvo que se apague [R60.14]. */
export const supervisorReviews = (settings: Pick<AppSettings, 'supervisorReview'>): boolean => settings.supervisorReview !== false;

export const supervisorModel = (settings: Pick<AppSettings, 'supervisorModel'>): string => settings.supervisorModel ?? SUPERVISOR_MODEL;

/** Qué hace la comprobación final con lo que solo puede comprobar una persona [R65.2]. */
export const supervisorHumanChecks = (settings: Pick<AppSettings, 'supervisorHumanChecks'>): HumanChecks => settings.supervisorHumanChecks ?? 'warn';

/** ¿Se carga la configuración de Claude Code? Activado salvo que se apague [R50.3]. */
export const loadsClaudeConfig = (settings: Pick<AppSettings, 'claudeConfig'>): boolean => settings.claudeConfig !== false;

/** Nivel del proyecto [R47.8]. */
export const projectPermission = (settings: Pick<AppSettings, 'permissions'>): ProjectPermission => settings.permissions ?? DEFAULT_PERMISSION;

/** El del agente si lo tiene; si no, el del proyecto [R47.10]. */
export const effectivePermission = (agent: { permissions?: PermissionLevel }, settings: Pick<AppSettings, 'permissions'>): PermissionLevel =>
  agent.permissions ?? projectPermission(settings);

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const known = (model: unknown) => MODELS.some((m) => m.id === model);

export function defaultSettings(): AppSettings {
  return { schemaVersion: SETTINGS_SCHEMA_VERSION, authMode: 'claude-code', engine: 'simulated', defaultModel: DEFAULT_MODEL, maxParallel: 4 };
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
  if (s.supervisorReview !== undefined && typeof s.supervisorReview !== 'boolean') out.push({ field: 'supervisorReview', message: 'La revisión del Supervisor tiene que estar activa o no' });
  if (s.supervisorModel !== undefined && !known(s.supervisorModel)) out.push({ field: 'supervisorModel', message: 'Elige un modelo de la lista' });
  if (s.supervisorHumanChecks !== undefined && !(HUMAN_CHECKS as readonly unknown[]).includes(s.supervisorHumanChecks)) out.push({ field: 'supervisorHumanChecks', message: 'Elige «Avisar» o «Hacer fallar la ejecución»' });
  out.push(...limitProblems(s.limits));
  if (s.unanswered !== undefined && !readUnanswered(s.unanswered)) out.push({ field: 'unanswered', message: 'Elige qué hacer si nadie responde' });
  if (s.memoryTokens !== undefined && !memoryTokensOk(s.memoryTokens)) out.push({ field: 'memoryTokens', message: `El tope de la memoria va de ${MEMORY_TOKENS_RANGE[0]} a ${MEMORY_TOKENS_RANGE[1]} tokens` });
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
  if (typeof raw.supervisorReview === 'boolean') out.supervisorReview = raw.supervisorReview;
  if (known(raw.supervisorModel)) out.supervisorModel = raw.supervisorModel as string;
  if ((HUMAN_CHECKS as readonly unknown[]).includes(raw.supervisorHumanChecks)) out.supervisorHumanChecks = raw.supervisorHumanChecks as HumanChecks;
  // Ajustes anteriores a R47.8: «Modificar sin preguntar» pasa a automático y «preguntar todos los comandos», a preguntar.
  if ((PROJECT_PERMISSIONS as readonly unknown[]).includes(raw.permissions)) out.permissions = raw.permissions as ProjectPermission;
  else if (raw.askCommands === true) out.permissions = 'ask';
  else if (raw.autoWrite === true) out.permissions = 'auto';
  if (typeof raw.claudeConfig === 'boolean') out.claudeConfig = raw.claudeConfig;
  if (isObject(raw.limits) && limitProblems(raw.limits).length === 0) {
    const l = raw.limits as StepLimits;
    const limits: NonNullable<AppSettings['limits']> = {};
    if (l.idleMinutes !== undefined) limits.idleMinutes = l.idleMinutes;
    if (l.toolMinutes !== undefined) limits.toolMinutes = l.toolMinutes;
    if (Object.keys(limits).length > 0) out.limits = limits;
  }
  const unanswered = readUnanswered(raw.unanswered);
  if (unanswered) out.unanswered = unanswered;
  if (memoryTokensOk(raw.memoryTokens)) out.memoryTokens = raw.memoryTokens;
  return out;
}
