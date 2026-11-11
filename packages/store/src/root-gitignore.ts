import { promises as fs } from 'node:fs';
import path from 'node:path';
import { atomicWrite } from './fs-util';

/** `shared`: la configuración de `.orquestador` va a git; `all`: no se sube nada [R96.9]. */
export type GitIgnoreMode = 'shared' | 'all';

export interface GitIgnoreState {
  /** La opción se ofrece: la carpeta está en un repositorio o ya tiene `.gitignore`. */
  available: boolean;
  exists: boolean;
  mode: GitIgnoreMode;
}

/** Comentario que acompaña a la línea que añade la app; sirve para retirarla después [R96.11]. */
export const ROOT_GITIGNORE_NOTE = '# Orquestador: su configuración y sus ejecuciones no se suben';
const ENTRY = '.orquestador/';
const IGNORES_ALL = new Set(['.orquestador', '.orquestador/', '/.orquestador', '/.orquestador/']);

const lines = (text: string) => text.split(/\r?\n/);
const eolOf = (text: string) => (text.includes('\r\n') ? '\r\n' : '\n');

/** ¿Alguna línea ignora `.orquestador` entero? [R96.9] */
export function ignoresOrq(text: string): boolean {
  return lines(text).some((l) => IGNORES_ALL.has(l.trim()));
}

/** El `.gitignore` con `.orquestador/` al final, en sus mismos saltos de línea; igual si ya lo ignoraba [R96.10]. */
export function withOrqIgnored(text: string): string {
  if (ignoresOrq(text)) return text;
  const eol = eolOf(text);
  const head = text === '' || /\r?\n$/.test(text) ? text : `${text}${eol}`;
  return `${head}${ROOT_GITIGNORE_NOTE}${eol}${ENTRY}${eol}`;
}

/** El `.gitignore` sin las líneas que ignoran `.orquestador` entero ni el comentario de la app [R96.11]. */
export function withoutOrqIgnored(text: string): string {
  if (!ignoresOrq(text)) return text;
  const eol = eolOf(text);
  const kept = lines(text).filter((l) => !IGNORES_ALL.has(l.trim()) && l.trim() !== ROOT_GITIGNORE_NOTE);
  const out = kept.join(eol);
  return out === '' || out.endsWith(eol) ? out : `${out}${eol}`;
}

/** ¿Hay un `.git` en la carpeta o en alguna de las que la contienen? No lanza `git` [R96.9]. */
export async function insideGitRepo(dir: string): Promise<boolean> {
  let at = path.resolve(dir);
  for (;;) {
    if (await fs.stat(path.join(at, '.git')).then(() => true, () => false)) return true;
    const up = path.dirname(at);
    if (up === at) return false;
    at = up;
  }
}

const read = (file: string) => fs.readFile(file, 'utf8').then((t) => t as string | undefined, () => undefined);

export async function rootGitignoreState(root: string): Promise<GitIgnoreState> {
  const text = await read(path.join(root, '.gitignore'));
  return { available: text !== undefined || (await insideGitRepo(root)), exists: text !== undefined, mode: text !== undefined && ignoresOrq(text) ? 'all' : 'shared' };
}

/** Deja el `.gitignore` de la carpeta del proyecto en ese modo; solo escribe si cambia algo [R96.10][R96.11]. */
export async function setRootGitignore(root: string, mode: GitIgnoreMode): Promise<GitIgnoreState> {
  const file = path.join(root, '.gitignore');
  const text = await read(file);
  const next = mode === 'all' ? withOrqIgnored(text ?? '') : text === undefined ? undefined : withoutOrqIgnored(text);
  if (next !== undefined && next !== text) await atomicWrite(file, next);
  return rootGitignoreState(root);
}
