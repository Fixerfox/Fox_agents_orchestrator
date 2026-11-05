import { AgentError, redactString } from '@orquestador/core';

const RETRIABLE = /ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|fetch failed|socket hang up|overloaded|rate.?limit|\b(429|500|502|503|504|529)\b/i;

/** Quita secretos (y la clave concreta, si se conoce) de un texto antes de mostrarlo [R27.8]. */
export function scrub(text: string, secret?: string): string {
  let out = redactString(text);
  if (secret && secret.length >= 8) out = out.split(secret).join('[REDACTED]');
  return out;
}

/** Traduce un error del propio SDK o del proceso en un `AgentError` en español [R27.6]. */
export function explainThrown(e: unknown, secret?: string): AgentError {
  if (e instanceof AgentError) return e;
  const raw = e instanceof Error ? e.message : String(e);
  const text = scrub(raw, secret);
  if (/ENOENT|not found|no se encuentra/i.test(raw) && /claude/i.test(raw)) {
    return new AgentError('No se encontró Claude Code. Instálalo o usa una clave API en Ajustes.', false);
  }
  if (/401|authentication|not logged in|invalid.*(api.?key|x-api-key)|login/i.test(raw)) {
    return new AgentError('Claude no tiene una sesión válida. Inicia sesión en Claude Code o revisa la clave API en Ajustes.', false);
  }
  return new AgentError(`Falló la conexión con Claude: ${text}`, RETRIABLE.test(raw));
}

/** Errores que el SDK adjunta a un mensaje del asistente. */
export function explainAssistantError(code: string): AgentError {
  switch (code) {
    case 'authentication_failed':
      return new AgentError('Claude no tiene una sesión válida. Inicia sesión en Claude Code o revisa la clave API en Ajustes.', false);
    case 'billing_error':
      return new AgentError('La cuenta de Claude no tiene saldo o el plan no permite esta consulta.', false);
    case 'rate_limit':
      return new AgentError('Claude ha alcanzado el límite de uso; se reintentará.', true);
    case 'server_error':
      return new AgentError('Claude tuvo un error temporal; se reintentará.', true);
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
      return new AgentError(`Claude terminó con un error: ${detail}`, RETRIABLE.test(detail));
    }
  }
}
