export type Id = string;

/** Lo que viaja por una conexión entre nodos: texto de salida + archivos del espacio de trabajo. */
export interface Payload {
  text: string;
  files: string[];
}

export const LIMITS = {
  name: 60,
  description: 300,
  instructions: 20_000,
  contextText: 100_000,
  contextValue: 2_000,
  maxTurns: 200,
  maxParallel: 16,
} as const;

export interface FieldProblem {
  field: string;
  message: string;
}

export const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export const isSafeId = (v: unknown): v is string => typeof v === 'string' && SAFE_ID.test(v) && !v.includes('..');

/** `true` si la ruta es relativa, sin `..` y sin letra de unidad [R22.2]. */
export function isRelativeInside(path: string): boolean {
  if (path.length === 0 || path.startsWith('/') || path.startsWith('\\') || /^[A-Za-z]:/.test(path)) return false;
  return !path.split(/[\\/]/).some((seg) => seg === '..');
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
