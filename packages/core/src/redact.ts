const SENSITIVE_KEY = /^(api[-_]?key|token|secret|password|authorization|auth|access[-_]?token|refresh[-_]?token)$/i;

const SECRET_PATTERNS: RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]{8,}/g,
  /sk-[A-Za-z0-9_-]{20,}/g,
  /Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /gh[pousr]_[A-Za-z0-9]{20,}/g,
];

export const REDACTED = '[REDACTED]';

export function redactString(text: string): string {
  return SECRET_PATTERNS.reduce((acc, re) => acc.replace(re, REDACTED), text);
}

/** `true` si el valor contiene claves sensibles o secretos reconocibles. */
export function containsSecrets(value: unknown): boolean {
  return JSON.stringify(redactSecrets(value)) !== JSON.stringify(value);
}

/** Copia profunda con claves sensibles y secretos reconocibles ocultos. Nunca modifica el original. */
export function redactSecrets(value: unknown): unknown {
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      out[key] = SENSITIVE_KEY.test(key) ? REDACTED : redactSecrets(v);
    }
    return out;
  }
  return value;
}
