/** Límites de un paso de agente: latido y duración máxima [R70.2][R70.6], presupuesto propio [R77.9]. */
export interface StepLimits {
  /** Minutos sin señales de vida sin herramienta en curso antes de cortar el intento [R70.2]. */
  idleMinutes?: number;
  /** Minutos sin señales de vida con una herramienta en curso [R70.2]. */
  toolMinutes?: number;
  /** Duración máxima de cada intento, sin contar la espera a la persona [R70.6]. */
  maxMinutes?: number;
  /** Presupuesto propio de cada intento, en dólares [R77.9]. */
  maxCostUsd?: number;
}

/** Valores por defecto del latido [R70.2]. */
export const DEFAULT_IDLE_MINUTES = 10;
export const DEFAULT_TOOL_MINUTES = 30;
/** Rangos que admite Ajustes [R70.7]. */
export const IDLE_MINUTES_RANGE = [2, 120] as const;
export const TOOL_MINUTES_RANGE = [5, 480] as const;

/** Qué hacer con una pregunta que nadie responde [R70.14]. */
export interface UnansweredPolicy {
  afterMinutes: number;
  action: 'wait' | 'fallback' | 'fail';
}

export const DEFAULT_UNANSWERED: UnansweredPolicy = { afterMinutes: 60, action: 'wait' };
export const UNANSWERED_ACTIONS = ['wait', 'fallback', 'fail'] as const;

/** El primer valor definido de cada límite, en orden (paso, agente, ejecución) [R70.7]. */
export function mergeLimits(...sources: (StepLimits | undefined)[]): StepLimits {
  const out: StepLimits = {};
  for (const key of ['idleMinutes', 'toolMinutes', 'maxMinutes', 'maxCostUsd'] as const) {
    const v = sources.find((s) => s?.[key] !== undefined)?.[key];
    if (v !== undefined) out[key] = v;
  }
  return out;
}

const positive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

/** Problemas de unos límites; `field` lleva el prefijo que se pase [R70.7]. */
export function limitProblems(l: unknown, prefix = 'limits'): { field: string; message: string }[] {
  if (l === undefined) return [];
  if (typeof l !== 'object' || l === null || Array.isArray(l)) return [{ field: prefix, message: 'Los límites no son válidos' }];
  const v = l as Record<string, unknown>;
  const out: { field: string; message: string }[] = [];
  const range = (key: string, [lo, hi]: readonly [number, number], what: string) => {
    const n = v[key];
    if (n !== undefined && !(typeof n === 'number' && Number.isInteger(n) && n >= lo && n <= hi)) out.push({ field: `${prefix}.${key}`, message: `${what} va de ${lo} a ${hi} minutos` });
  };
  range('idleMinutes', IDLE_MINUTES_RANGE, 'La inactividad');
  range('toolMinutes', TOOL_MINUTES_RANGE, 'El tiempo con una herramienta en curso');
  if (v.maxMinutes !== undefined && !(positive(v.maxMinutes) && Number.isInteger(v.maxMinutes))) out.push({ field: `${prefix}.maxMinutes`, message: 'La duración máxima tiene que ser un número entero de minutos' });
  if (v.maxCostUsd !== undefined && !positive(v.maxCostUsd)) out.push({ field: `${prefix}.maxCostUsd`, message: 'El presupuesto del paso tiene que ser mayor que cero' });
  return out;
}

/** Política válida o `undefined` [R70.14]. */
export function readUnanswered(raw: unknown): UnansweredPolicy | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  if (!(UNANSWERED_ACTIONS as readonly unknown[]).includes(r.action)) return undefined;
  if (!positive(r.afterMinutes)) return undefined;
  return { afterMinutes: r.afterMinutes, action: r.action as UnansweredPolicy['action'] };
}
