/** Clave `ruta/id` de un paso como nombre de carpeta: cada id codificado y unidos por «~» [R54.3]. */
export const encodeStepKey = (key: string): string => key.split('/').map(encodeURIComponent).join('~');

/** ¿Ruta relativa, con «/», sin salir de la carpeta y fuera de `.orquestador` y `.git`? */
export function safePreviewPath(rel: string): boolean {
  if (!rel || rel.includes('\\') || rel.startsWith('/') || /^[a-z]:/i.test(rel)) return false;
  const segs = rel.split('/');
  if (segs.some((s) => s === '' || s === '.' || s === '..')) return false;
  return !['.orquestador', '.git'].includes(segs[0]!.toLowerCase());
}
