const SENSITIVE_KEY = /^(x[-_])?(api[-_]?key|token|secret|password|authorization|auth|access[-_]?token|refresh[-_]?token|private[-_]?key|client[-_]?secret)$/i;

const SECRET_PATTERNS: RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]{8,}/g,
  /sk-[A-Za-z0-9_-]{20,}/g,
  /Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /gh[pousr]_[A-Za-z0-9]{20,}/g,
  // Slack, Google, AWS, Notion, GitLab y npm [R90.5].
  /xox[abprs]-[A-Za-z0-9-]{10,}/g,
  /AIza[0-9A-Za-z_-]{35}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\b(secret|ntn)_[A-Za-z0-9]{32,}/g,
  /glpat-[A-Za-z0-9_-]{20,}/g,
  /\bnpm_[A-Za-z0-9]{36}\b/g,
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

/** Valores que se ocultan tal cual: más cortos no, porque taparían palabras normales [R90.4]. */
export const MIN_SECRET_VALUE = 6;

/** Como `redactSecrets`, y además oculta cada valor conocido (clave API, secretos MCP) donde aparezca [R90.4]. */
export function redactWith(values: () => readonly string[]): (value: unknown) => unknown {
  const hide = (text: string): string => {
    let out = redactString(text);
    for (const v of values()) if (v.length >= MIN_SECRET_VALUE && out.includes(v)) out = out.split(v).join(REDACTED);
    return out;
  };
  const walk = (value: unknown): unknown => {
    if (typeof value === 'string') return hide(value);
    if (Array.isArray(value)) return value.map(walk);
    if (value !== null && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, v] of Object.entries(value)) out[key] = SENSITIVE_KEY.test(key) ? REDACTED : walk(v);
      return out;
    }
    return value;
  };
  return walk;
}
