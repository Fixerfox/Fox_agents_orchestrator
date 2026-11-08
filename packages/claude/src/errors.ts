import { AgentError, redactString, type AgentErrorKind } from '@orquestador/core';

/** Último recurso cuando el SDK no da ni código ni estado [R71.2]. */
const RETRIABLE = /ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|fetch failed|socket hang up|overloaded|rate.?limit|\b(429|500|502|503|504|529)\b/i;

/** Quita secretos (y la clave concreta, si se conoce) de un texto antes de mostrarlo [R27.8]. */
export function scrub(text: string, secret?: string): string {
  let out = redactString(text);
  if (secret && secret.length >= 8) out = out.split(secret).join('[REDACTED]');
  return out;
}

/** Tipo de error por estado HTTP [R71.2]. */
export function kindOfStatus(status: number): AgentErrorKind | undefined {
  if (status === 429) return 'rate_limit';
  if (status === 529) return 'overloaded';
  if (status === 408 || status >= 500) return 'transient';
  if (status >= 400) return 'fatal';
  return undefined;
}

/** Lo que pide esperar el proveedor, en milisegundos, si lo dice (`retry-after` en segundos o como fecha) [R71.2]. */
export function retryAfterOf(e: unknown, now = Date.now()): number | undefined {
  const raw = headerOf(e, 'retry-after');
  if (raw === undefined) {
    const m = /retry[- ]after[:= ]+(\d+(?:\.\d+)?)/i.exec(e instanceof Error ? e.message : String(e));
    return m ? Math.round(Number(m[1]) * 1000) : undefined;
  }
  const secs = Number(raw);
  if (Number.isFinite(secs)) return Math.max(0, Math.round(secs * 1000));
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.max(0, at - now) : undefined;
}

function headerOf(e: unknown, name: string): string | undefined {
  if (!e || typeof e !== 'object') return undefined;
  const headers = (e as { headers?: unknown }).headers;
  if (!headers || typeof headers !== 'object') return undefined;
  const get = (headers as { get?: unknown }).get;
  if (typeof get === 'function') {
    const v = (get as (n: string) => unknown).call(headers, name);
    return typeof v === 'string' ? v : undefined;
  }
  const v = (headers as Record<string, unknown>)[name] ?? (headers as Record<string, unknown>)[name.toLowerCase()];
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : undefined;
}

function statusOf(e: unknown): number | undefined {
  if (!e || typeof e !== 'object') return undefined;
  const s = (e as { status?: unknown }).status;
  return typeof s === 'number' ? s : undefined;
}

/** Tipo por el texto, solo cuando no hay nada mejor [R71.2]. */
function kindOfText(raw: string): AgentErrorKind {
  if (/rate.?limit|\b429\b/i.test(raw)) return 'rate_limit';
  if (/overloaded|\b529\b/i.test(raw)) return 'overloaded';
  return RETRIABLE.test(raw) ? 'transient' : 'fatal';
}

/** Traduce un error del propio SDK o del proceso en un `AgentError` en español, con su tipo [R27.6][R71.2]. */
export function explainThrown(e: unknown, secret?: string): AgentError {
  if (e instanceof AgentError) return e;
  const raw = e instanceof Error ? e.message : String(e);
  const text = scrub(raw, secret);
  if (/ENOENT|not found|no se encuentra/i.test(raw) && /claude/i.test(raw)) {
    return new AgentError('No se encontró Claude Code. Instálalo o usa una clave API en Ajustes.', false);
  }
  const status = statusOf(e);
  if (status === 401 || status === 403 || (status === undefined && /401|authentication|not logged in|invalid.*(api.?key|x-api-key)|login/i.test(raw))) {
    return new AgentError('Claude no tiene una sesión válida. Inicia sesión en Claude Code o revisa la clave API en Ajustes.', false);
  }
  const kind = (status !== undefined ? kindOfStatus(status) : undefined) ?? kindOfText(raw);
  const retryAfterMs = retryAfterOf(e);
  return new AgentError(`Falló la conexión con Claude: ${text}`, kind !== 'fatal', [], { kind, ...(retryAfterMs !== undefined ? { retryAfterMs } : {}) });
}

/** Errores que el SDK adjunta a un mensaje del asistente, con su tipo [R71.2]. */
export function explainAssistantError(code: string): AgentError {
  switch (code) {
    case 'authentication_failed':
      return new AgentError('Claude no tiene una sesión válida. Inicia sesión en Claude Code o revisa la clave API en Ajustes.', false);
    case 'billing_error':
      return new AgentError('La cuenta de Claude no tiene saldo o el plan no permite esta consulta.', false);
    case 'rate_limit':
      return new AgentError('Claude ha alcanzado el límite de uso; se reintentará.', true, [], { kind: 'rate_limit' });
    case 'overloaded_error':
    case 'overloaded':
      return new AgentError('Claude está saturado; se reintentará.', true, [], { kind: 'overloaded' });
    case 'server_error':
      return new AgentError('Claude tuvo un error temporal; se reintentará.', true, [], { kind: 'transient' });
    case 'invalid_request':
      return new AgentError('Claude rechazó la petición como no válida.', false);
    default:
      return new AgentError(`Claude devolvió un error (${code}).`, false);
  }
}

/** Resultado final con error. */
export function explainResult(subtype: string | undefined, errors: string[] | undefined, text: string | undefined, secret?: string): AgentError {
  switch (subtype) {
    case 'error_max_turns':
      return new AgentError('El agente agotó su máximo de turnos sin terminar. Sube el máximo o simplifica la tarea.', false);
    case 'error_max_budget_usd':
      return new AgentError('Se alcanzó el presupuesto máximo de la consulta.', false);
    default: {
      const detail = scrub((errors && errors.length > 0 ? errors.join('; ') : text) ?? 'sin detalle', secret);
      const kind = kindOfText(detail);
      return new AgentError(`Claude terminó con un error: ${detail}`, kind !== 'fatal', [], { kind });
    }
  }
}
