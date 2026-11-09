/** Comprobación determinista de un paso, un agente o un diagrama [R75.1]. */
export type StepCheck =
  | { id: string; label: string; kind: 'command'; run: string; timeoutSec?: number; expectExit?: number }
  | { id: string; label: string; kind: 'files'; mustExist?: string[]; mustChange?: string[] }
  | { id: string; label: string; kind: 'output'; contains?: string; notContains?: string; matches?: string }
  | { id: string; label: string; kind: 'schema'; schema: string };

export const CHECK_KINDS = ['command', 'files', 'output', 'schema'] as const;
/** Tiempo de un comando de comprobación por defecto [R75.1]. */
export const CHECK_TIMEOUT_SEC = 300;
/** Repeticiones solas de un paso cuyas comprobaciones fallan [R75.5]. */
export const CHECKS_RETRY = 1;

/** Resultado de una comprobación [R75.3]. */
export interface CheckResult {
  checkId: string;
  label: string;
  kind: StepCheck['kind'];
  ok: boolean;
  detail: string;
  durationMs: number;
}

/** Verificar con un agente [R75.13]. */
export interface VerifySettings {
  /** Agente que verifica; por defecto el «Verificador» incluido. */
  agentId?: string;
  skillIds?: string[];
  /** Presupuesto de la verificación; 0,50 $ por defecto. */
  maxCostUsd?: number;
  /** Tiempo máximo; 10 min por defecto. */
  maxMinutes?: number;
}
export const VERIFIER_AGENT_ID = 'verificador';
export const VERIFY_SKILL_ID = 'verificar-lo-pedido';
export const VERIFY_MAX_COST_USD = 0.5;
export const VERIFY_MAX_MINUTES = 10;

/** Cuándo revisa la IA un paso [R75.11]. */
export type AiReviewMode = 'always' | 'final-or-checks' | 'never';
export const AI_REVIEW_MODES: readonly AiReviewMode[] = ['always', 'final-or-checks', 'never'];

/** Gravedad de un problema de la revisión [R75.9]. */
export type Severity = 'none' | 'low' | 'medium' | 'high';
const RANK: Record<Severity, number> = { none: 0, low: 1, medium: 2, high: 3 };
export const severityRank = (s: Severity): number => RANK[s];

/** Desde qué gravedad se para y se pregunta [R75.10]. */
export type StopAt = 'high' | 'medium' | 'never';
export const STOP_AT: readonly StopAt[] = ['high', 'medium', 'never'];
export const stops = (severity: Severity, at: StopAt): boolean => at !== 'never' && severityRank(severity) >= severityRank(at);

const SAFE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** Lo que no vale de unas comprobaciones, para la validación del diagrama y de la ficha [R75.1]. */
export function checkProblems(checks: unknown): string[] {
  if (checks === undefined) return [];
  if (!Array.isArray(checks)) return ['Las comprobaciones tienen que ser una lista'];
  const out: string[] = [];
  const ids = new Set<string>();
  for (const c of checks as Record<string, unknown>[]) {
    const id = typeof c?.['id'] === 'string' ? (c['id'] as string) : '';
    const label = typeof c?.['label'] === 'string' ? (c['label'] as string).trim() : '';
    if (!SAFE.test(id)) out.push(`Comprobación sin id válido: ${id || '(vacío)'}`);
    else if (ids.has(id)) out.push(`Comprobación repetida: ${id}`);
    ids.add(id);
    if (!label) out.push(`La comprobación ${id || '(sin id)'} no tiene nombre`);
    const kind = c?.['kind'];
    if (kind === 'command') {
      if (typeof c['run'] !== 'string' || !(c['run'] as string).trim()) out.push(`«${label || id}»: falta el comando`);
      if (c['timeoutSec'] !== undefined && !(Number.isInteger(c['timeoutSec']) && (c['timeoutSec'] as number) >= 1 && (c['timeoutSec'] as number) <= 3600)) out.push(`«${label || id}»: el tiempo va de 1 a 3600 s`);
      if (c['expectExit'] !== undefined && !Number.isInteger(c['expectExit'])) out.push(`«${label || id}»: el código de salida tiene que ser un número entero`);
    } else if (kind === 'files') {
      const lists = ['mustExist', 'mustChange'].map((k) => c[k]);
      if (lists.every((l) => l === undefined || (Array.isArray(l) && l.length === 0))) out.push(`«${label || id}»: di qué archivos tienen que existir o cambiar`);
      for (const l of lists) if (l !== undefined && (!Array.isArray(l) || l.some((p) => typeof p !== 'string' || p.startsWith('/') || p.includes('..')))) out.push(`«${label || id}»: los patrones son rutas relativas a la carpeta`);
    } else if (kind === 'output') {
      if (![c['contains'], c['notContains'], c['matches']].some((v) => typeof v === 'string' && v !== '')) out.push(`«${label || id}»: di qué tiene que tener (o no) la salida`);
      if (typeof c['matches'] === 'string') {
        try {
          new RegExp(c['matches'] as string);
        } catch {
          out.push(`«${label || id}»: la expresión regular no es válida`);
        }
      }
    } else if (kind === 'schema') {
      try {
        JSON.parse(String(c['schema']));
      } catch {
        out.push(`«${label || id}»: el esquema no es JSON válido`);
      }
    } else out.push(`«${label || id}»: tipo de comprobación desconocido`);
  }
  return out;
}

/** Un patrón glob sencillo (`*`, `**`, `?`) como expresión regular sobre rutas con `/` [R75.1]. */
export function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i]!;
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        re += glob[i + 2] === '/' ? '(?:.*/)?' : '.*';
        i += glob[i + 2] === '/' ? 2 : 1;
      } else re += '[^/]*';
    } else if (ch === '?') re += '[^/]';
    else re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}
