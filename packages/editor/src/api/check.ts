/** Comprobaciones comunes de las peticiones IPC [R19.3]. */

export const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
export const safeId = (v: unknown): v is string => typeof v === 'string' && SAFE_ID.test(v) && !v.includes('..');

/** Lo que devuelve el analizador de un contexto cuando el canal no es suyo. */
export const UNHANDLED = Symbol('unhandled');

/** Ayudas para validar la petición de un canal; se crean una vez por llamada. */
export interface RequestCheck {
  bad(message: string): Error;
  exact(o: Record<string, unknown>, allowed: string[]): void;
  str(v: unknown, name: string, max: number, min?: number): string;
}

export function requestCheck(bad: (m: string) => Error): RequestCheck {
  return {
    bad,
    exact: (o, allowed) => {
      for (const k of Object.keys(o)) if (!allowed.includes(k)) throw bad(`campo no permitido «${k}»`);
    },
    str: (v, name, max, min = 0) => {
      if (typeof v !== 'string' || v.length < min || v.length > max) throw bad(`${name} no válido`);
      return v;
    },
  };
}
