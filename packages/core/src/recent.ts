/** Proyecto reciente tal como se guarda en la carpeta de datos de la app [R28.2]. */
export interface RecentProject {
  id: string;
  name: string;
  root: string;
  openedAt: string;
}

/** Lo único que ve la interfaz de un reciente: nunca la ruta absoluta [R28.3]. */
export interface RecentView {
  id: string;
  name: string;
  /** Carpeta contenedora y carpeta del proyecto, p. ej. «Juegos / Sprites». */
  folder: string;
  openedAt: string;
  /** La carpeta ya no existe o no es un proyecto. */
  missing: boolean;
}

export const RECENT_LIMIT = 10;
export const RECENT_SCHEMA_VERSION = 1;

const norm = (root: string) => root.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

/** Id estable y opaco de una carpeta (FNV-1a doble); la misma carpeta da siempre el mismo id. */
export function recentId(root: string): string {
  const s = norm(root);
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b + c, 0x85ebca6b) >>> 0;
  }
  return `p${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}`;
}

/** Pone un proyecto el primero, sin duplicados y con el máximo permitido [R28.2]. */
export function touchRecent(list: readonly RecentProject[], entry: { root: string; name: string }, now: Date): RecentProject[] {
  const id = recentId(entry.root);
  const fresh: RecentProject = { id, name: entry.name, root: entry.root, openedAt: now.toISOString() };
  return [fresh, ...list.filter((r) => r.id !== id)].slice(0, RECENT_LIMIT);
}

export const forgetRecent = (list: readonly RecentProject[], id: string): RecentProject[] => list.filter((r) => r.id !== id);

/** Lee una lista guardada descartando lo que no sea válido (archivo antiguo o dañado) [R28.2]. */
export function normalizeRecents(raw: unknown): RecentProject[] {
  const items = Array.isArray(raw) ? raw : raw && typeof raw === 'object' && Array.isArray((raw as { items?: unknown }).items) ? (raw as { items: unknown[] }).items : [];
  const out: RecentProject[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    if (!it || typeof it !== 'object') continue;
    const r = it as Record<string, unknown>;
    if (typeof r['root'] !== 'string' || r['root'] === '' || typeof r['name'] !== 'string' || typeof r['openedAt'] !== 'string') continue;
    const id = recentId(r['root']);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name: r['name'], root: r['root'], openedAt: r['openedAt'] });
  }
  return out.slice(0, RECENT_LIMIT);
}

/** «Carpeta contenedora / carpeta del proyecto», sin ruta absoluta [R28.3]. */
export function folderLabel(root: string): string {
  const parts = root.replace(/\\/g, '/').split('/').filter(Boolean);
  const last = parts.slice(-2);
  return last.length === 2 ? last.join(' / ') : (last[0] ?? '');
}
