import type { Id } from './types';
import { isSafeId } from './agents';

/**
 * Carpetas de la biblioteca del proyecto (agentes, skills, contextos, MCP y diagramas) [R38.13][R38.22]. Viven en un archivo aparte
 * (`.orquestador/library.json`) para no tocar el formato de cada cosa: una skill sigue siendo un `SKILL.md` de Claude
 * Code. Una carpeta es una ruta con `/` («Arte/Píxel»); `''` es la raíz.
 */
export type LibraryKind = 'agents' | 'skills' | 'contexts' | 'mcp' | 'diagrams';
export const LIBRARY_KINDS: readonly LibraryKind[] = ['agents', 'skills', 'contexts', 'mcp', 'diagrams'];
export const LIBRARY_SCHEMA_VERSION = 1;
export const FOLDER_LIMITS = { segment: 40, depth: 3, folders: 200, items: 5_000 } as const;

export interface KindFolders {
  /** Carpetas que existen (también vacías), con su ruta completa. */
  folders: string[];
  /** Carpeta de cada elemento; lo que no está va en la raíz. */
  items: Record<Id, string>;
}
export interface LibraryFolders {
  schemaVersion: number;
  kinds: Record<LibraryKind, KindFolders>;
}

export function emptyLibraryFolders(): LibraryFolders {
  return { schemaVersion: LIBRARY_SCHEMA_VERSION, kinds: { agents: { folders: [], items: {} }, skills: { folders: [], items: {} }, contexts: { folders: [], items: {} }, mcp: { folders: [], items: {} }, diagrams: { folders: [], items: {} } } };
}

/** Normaliza una ruta de carpeta: sin espacios sobrantes ni `/` repetidas; `undefined` si no es válida [R38.13]. */
export function normalizeFolder(raw: string): string | undefined {
  const segs = raw.split('/').map((s) => s.trim().replace(/\s+/g, ' ')).filter((s) => s !== '');
  if (segs.length > FOLDER_LIMITS.depth) return undefined;
  for (const s of segs) if (s.length > FOLDER_LIMITS.segment || s === '.' || s === '..' || /\\/.test(s) || [...s].some((ch) => ch.charCodeAt(0) < 32)) return undefined;
  return segs.join('/');
}

/** Padres de una ruta: «a/b/c» → «a», «a/b». */
const parents = (p: string): string[] => {
  const segs = p.split('/');
  return segs.slice(0, -1).map((_, i) => segs.slice(0, i + 1).join('/'));
};
const sorted = (xs: Iterable<string>) => [...new Set(xs)].filter((x) => x !== '').sort((a, b) => a.localeCompare(b, 'es'));

/** Deja el documento coherente: rutas normalizadas, padres presentes, elementos en carpetas que existen [R38.13]. */
export function tidyLibraryFolders(raw: unknown): LibraryFolders {
  const out = emptyLibraryFolders();
  const src = typeof raw === 'object' && raw !== null ? ((raw as { kinds?: unknown }).kinds as Record<string, unknown> | undefined) : undefined;
  for (const k of LIBRARY_KINDS) {
    const kf = src && typeof src[k] === 'object' && src[k] !== null ? (src[k] as Partial<KindFolders>) : {};
    const set = new Set<string>();
    const add = (p: string) => {
      const n = normalizeFolder(p);
      if (!n) return undefined;
      set.add(n);
      for (const q of parents(n)) set.add(q);
      return n;
    };
    for (const f of Array.isArray(kf.folders) ? kf.folders : []) if (typeof f === 'string') add(f);
    const items: Record<Id, string> = {};
    if (kf.items && typeof kf.items === 'object') {
      for (const [id, f] of Object.entries(kf.items)) {
        if (!isSafeId(id) || typeof f !== 'string') continue;
        const n = add(f);
        if (n) items[id] = n;
      }
    }
    out.kinds[k] = { folders: sorted(set).slice(0, FOLDER_LIMITS.folders), items };
  }
  return out;
}

/** Problemas del documento al guardarlo [R38.13]. */
export function validateLibraryFolders(f: LibraryFolders): string | undefined {
  for (const k of LIBRARY_KINDS) {
    const kf = f.kinds[k];
    if (kf.folders.length > FOLDER_LIMITS.folders) return `Demasiadas carpetas (máximo ${FOLDER_LIMITS.folders})`;
    if (Object.keys(kf.items).length > FOLDER_LIMITS.items) return 'Demasiados elementos';
    for (const p of kf.folders) if (normalizeFolder(p) !== p || p === '') return `Nombre de carpeta no válido: «${p}»`;
  }
  return undefined;
}

const withKind = (f: LibraryFolders, kind: LibraryKind, next: KindFolders): LibraryFolders => tidyLibraryFolders({ ...f, kinds: { ...f.kinds, [kind]: next } });

/** Crea una carpeta (y sus padres). Lanza si el nombre no vale [R38.14]. */
export function addFolder(f: LibraryFolders, kind: LibraryKind, path: string): LibraryFolders {
  const n = normalizeFolder(path);
  if (!n) throw new Error('Nombre de carpeta no válido');
  return withKind(f, kind, { ...f.kinds[kind], folders: [...f.kinds[kind].folders, n] });
}

/** Mueve un elemento a una carpeta (`''` = raíz) [R38.14]. */
export function moveToFolder(f: LibraryFolders, kind: LibraryKind, id: Id, folder: string): LibraryFolders {
  const n = normalizeFolder(folder);
  if (n === undefined) throw new Error('Nombre de carpeta no válido');
  const items = { ...f.kinds[kind].items };
  if (n === '') delete items[id];
  else items[id] = n;
  return withKind(f, kind, { folders: [...f.kinds[kind].folders, ...(n ? [n] : [])], items });
}

const under = (p: string, base: string) => p === base || p.startsWith(`${base}/`);
const rebase = (p: string, from: string, to: string) => (to === '' ? p.slice(from.length + 1) || '' : `${to}${p.slice(from.length)}`);

/** Renombra o mueve una carpeta con todo lo que tiene dentro [R38.14]. */
export function renameFolder(f: LibraryFolders, kind: LibraryKind, from: string, to: string): LibraryFolders {
  const n = normalizeFolder(to);
  if (!n) throw new Error('Nombre de carpeta no válido');
  if (under(n, from) && n !== from) throw new Error('Una carpeta no puede ir dentro de sí misma');
  if (n !== from && f.kinds[kind].folders.includes(n)) throw new Error(`Ya existe la carpeta «${n}»`);
  const kf = f.kinds[kind];
  const folders = kf.folders.map((p) => (under(p, from) ? rebase(p, from, n) : p));
  if (folders.some((p) => p.split('/').length > FOLDER_LIMITS.depth)) throw new Error(`Como mucho ${FOLDER_LIMITS.depth} niveles de carpetas`);
  const items = Object.fromEntries(Object.entries(kf.items).map(([id, p]) => [id, under(p, from) ? rebase(p, from, n) : p]));
  return withKind(f, kind, { folders, items });
}

/** Quita una carpeta: lo de dentro (subcarpetas y elementos) sube a la carpeta padre; nada se borra [R38.14]. */
export function removeFolder(f: LibraryFolders, kind: LibraryKind, path: string): LibraryFolders {
  const parent = parents(path).at(-1) ?? '';
  const kf = f.kinds[kind];
  const lift = (p: string) => (p === path ? parent : under(p, path) ? (parent ? `${parent}/` : '') + p.slice(path.length + 1) : p);
  const folders = kf.folders.filter((p) => p !== path).map(lift);
  const items: Record<Id, string> = {};
  for (const [id, p] of Object.entries(kf.items)) {
    const q = lift(p);
    if (q !== '') items[id] = q;
  }
  return withKind(f, kind, { folders, items });
}

export interface FolderTreeNode<T> {
  name: string;
  path: string;
  folders: FolderTreeNode<T>[];
  items: T[];
  /** Elementos aquí y en las subcarpetas. */
  total: number;
}

/** Árbol para la lista: carpetas por nombre, elementos por nombre; ids sin carpeta conocida van a la raíz [R38.13]. */
export function buildFolderTree<T extends { id: Id; name: string }>(items: readonly T[], kf: KindFolders | undefined): FolderTreeNode<T> {
  const root: FolderTreeNode<T> = { name: '', path: '', folders: [], items: [], total: 0 };
  const byPath = new Map<string, FolderTreeNode<T>>([['', root]]);
  const ensure = (p: string): FolderTreeNode<T> => {
    const hit = byPath.get(p);
    if (hit) return hit;
    const segs = p.split('/');
    const parent = ensure(segs.slice(0, -1).join('/'));
    const node: FolderTreeNode<T> = { name: segs.at(-1)!, path: p, folders: [], items: [], total: 0 };
    parent.folders.push(node);
    byPath.set(p, node);
    return node;
  };
  for (const p of kf?.folders ?? []) ensure(p);
  for (const it of items) ensure(kf?.items[it.id] ?? '').items.push(it);
  const fin = (n: FolderTreeNode<T>): number => {
    n.folders.sort((a, b) => a.name.localeCompare(b.name, 'es'));
    n.items.sort((a, b) => a.name.localeCompare(b.name, 'es'));
    n.total = n.items.length + n.folders.reduce((s, c) => s + fin(c), 0);
    return n.total;
  };
  fin(root);
  return root;
}
