import path from 'node:path';

/** Carpetas internas que los agentes nunca escriben [R31.5]. */
export const PROTECTED_DIRS = ['.git', 'node_modules', '.orquestador'] as const;
const NAMES = new Set<string>(PROTECTED_DIRS);

/**
 * Cómo ve el sistema un segmento de ruta: en Windows no distingue mayúsculas, quita los puntos y espacios del final
 * y lo que va desde `:` es un flujo alternativo de NTFS (`.git::$INDEX_ALLOCATION` es la carpeta `.git`) [R87.1].
 */
export function systemName(segment: string, platform: NodeJS.Platform = process.platform): string {
  // El disco de macOS no distingue mayúsculas por defecto [R87.2].
  if (platform === 'darwin') return segment.toLowerCase();
  if (platform !== 'win32') return segment;
  const colon = segment.indexOf(':');
  // «C:» al principio de una ruta absoluta es la unidad, no un flujo.
  const base = colon > 1 ? segment.slice(0, colon) : segment;
  return base.replace(/[. ]+$/, '').toLowerCase();
}

/** ¿Es `.git`, `node_modules` o `.orquestador`, como lo vería el sistema? [R87.1] */
export const protectedName = (segment: string, platform: NodeJS.Platform = process.platform): boolean => NAMES.has(systemName(segment, platform).toLowerCase());

/** Ruta normalizada como la vería el sistema, para comparar carpetas [R87.2]. */
export function systemPath(p: string, platform: NodeJS.Platform = process.platform): string {
  const abs = path.resolve(p);
  if (platform === 'darwin') return abs.toLowerCase();
  if (platform !== 'win32') return abs;
  return abs
    .split(/[\\/]+/)
    .map((s, i) => (i === 0 ? s.toLowerCase() : systemName(s, platform)))
    .join(path.sep);
}

/** ¿Está `abs` en `dir` o dentro, como lo vería el sistema? [R87.2] */
export function sameOrInside(abs: string, dir: string, platform: NodeJS.Platform = process.platform): boolean {
  const a = systemPath(abs, platform);
  const d = systemPath(dir, platform);
  return a === d || a.startsWith(d.endsWith(path.sep) ? d : `${d}${path.sep}`);
}
