import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isSensitivePath } from './assistant-read';
import { sameOrInside } from './protected';
import type { PermissionResult } from './sdk-types';
import type { WritePolicyDeps } from './workfolder';

export const ALLOW_ONCE = 'Permitir';
export const ALLOW_RUN = 'Permitir en esta ejecución';
export const DENY = 'Denegar';

const allow = (input: Record<string, unknown>): PermissionResult => ({ behavior: 'allow', updatedInput: input });
const deny = (message: string): PermissionResult => ({ behavior: 'deny', message });

/** Motivo al leer un archivo o carpeta de secretos [R87.4]. */
export const SENSITIVE_DENY =
  'Ese archivo o carpeta guarda secretos (claves, credenciales, .env o los datos de la aplicación): los agentes no lo leen. Si hace falta un valor, pídeselo al usuario.';
export const READ_TOOLS_LOCAL = ['Read', 'Glob', 'Grep'] as const;
export const WEB_TOOLS = ['WebFetch', 'WebSearch'] as const;
/** «Permitir en esta ejecución» de lecturas y web, guardado con los comandos de la ejecución [R87.6][R87.8]. */
export const READ_OUTSIDE_GRANT = 'lectura:fuera';
export const WEB_SEARCH_GRANT = 'web:buscar';
export const webGrant = (host: string) => `web:${host}`;

/** Rutas y patrones de una lectura; los patrones solo cuentan como ruta hasta el primer comodín [R87.4][R87.5]. */
function readTargets(input: Record<string, unknown>): { names: string[]; places: string[] } {
  const names: string[] = [];
  const places: string[] = [];
  for (const key of ['file_path', 'notebook_path', 'path', 'pattern', 'glob']) {
    const v = input[key];
    if (typeof v !== 'string' || v.length === 0) continue;
    names.push(v);
    const isPattern = key === 'pattern' || key === 'glob';
    const plain = isPattern ? v.split(/[*?[{]/)[0]! : v;
    const expanded = plain.startsWith('~') ? path.join(os.homedir(), plain.slice(1)) : plain;
    // Un patrón relativo busca dentro de `path` o de la carpeta de trabajo: no dice nada del sitio.
    if (isPattern && !path.isAbsolute(expanded)) continue;
    if (expanded.length > 0) places.push(expanded);
  }
  return { names, places };
}

/** La ruta real (enlaces resueltos) del ancestro más cercano que existe [R87.5]. */
async function realNearest(abs: string): Promise<string> {
  let probe = abs;
  for (;;) {
    try {
      const real = await fs.realpath(probe);
      return probe === abs ? real : path.join(real, path.relative(probe, abs));
    } catch {
      const up = path.dirname(probe);
      if (up === probe) return abs;
      probe = up;
    }
  }
}

/** Lecturas y web de un agente: secretos nunca, fuera de la carpeta y web según el nivel [R87.4]–[R87.9]. */
export function createReadPolicy(deps: WritePolicyDeps): { decideRead: (input: Record<string, unknown>) => Promise<PermissionResult>; decideWeb: (tool: string, input: Record<string, unknown>) => Promise<PermissionResult> } {
  const readRoots = [deps.root, ...(deps.readRoots ?? [])];
  const grant = (key: string) => deps.commandGrants?.has(key) === true;
  const keep = (key: string) => deps.commandGrants?.add(key);
  const asks = deps.level === 'readonly' || deps.level === 'ask';

  /** Lecturas: secretos nunca; dentro, sin preguntar; fuera, según el nivel [R87.4]–[R87.6]. */
  const decideRead = async (input: Record<string, unknown>): Promise<PermissionResult> => {
    const { names, places } = readTargets(input);
    const shown = names[0] ?? '';
    const inRoot = async (p: string) => {
      const abs = path.resolve(deps.root, p);
      return sameOrInside(abs, deps.root) && sameOrInside(await realNearest(abs), await realNearest(deps.root));
    };
    for (const name of names) {
      const appData = (deps.protectedDirs ?? []).length > 0 && !(await inRoot(name)) && isSensitivePath(name, deps.protectedDirs, deps.root);
      if (isSensitivePath(name) || appData) {
        deps.note?.({ kind: 'denied', path: name, reason: 'archivo de secretos' });
        return deny(SENSITIVE_DENY);
      }
    }
    const outside: string[] = [];
    for (const place of places) {
      const abs = path.resolve(deps.root, place);
      const real = await realNearest(abs);
      let inside = false;
      for (const dir of readRoots) if (sameOrInside(abs, dir) && sameOrInside(real, await realNearest(dir))) inside = true;
      if (!inside) outside.push(place);
    }
    if (outside.length === 0 || !asks || grant(READ_OUTSIDE_GRANT)) return allow(input);
    const answer = (await deps.ask({ text: `¿Puedo leer fuera de la carpeta de trabajo?\n${outside[0] ?? shown}`, options: [ALLOW_ONCE, ALLOW_RUN, DENY], kind: 'permission', fallback: DENY })).trim();
    if (answer === ALLOW_ONCE) return allow(input);
    if (answer === ALLOW_RUN) {
      keep(READ_OUTSIDE_GRANT);
      return allow(input);
    }
    deps.note?.({ kind: 'denied', path: outside[0] ?? shown, reason: 'lectura fuera de la carpeta' });
    return deny(answer && answer !== DENY ? `El usuario no permite leer fuera de la carpeta y dice: ${answer}` : 'El usuario no permite leer fuera de la carpeta de trabajo.');
  };

  /** Web: por dominio y por ejecución en «Solo lectura» y «Preguntar» [R87.8][R87.9]. */
  const decideWeb = async (tool: string, input: Record<string, unknown>): Promise<PermissionResult> => {
    if (!asks) return allow(input);
    if (tool === 'WebSearch') {
      if (grant(WEB_SEARCH_GRANT)) return allow(input);
      const yes = 'Permitir buscar en esta ejecución';
      const answer = (await deps.ask({ text: '¿Puedo buscar en la web?', options: [yes, DENY], kind: 'permission', fallback: DENY })).trim();
      if (answer === yes) {
        keep(WEB_SEARCH_GRANT);
        return allow(input);
      }
      deps.note?.({ kind: 'denied', path: 'búsqueda web', reason: 'web no permitida' });
      return deny('El usuario no permite buscar en la web.');
    }
    let host: string;
    try {
      host = new URL(String(input['url'] ?? '')).hostname.toLowerCase();
    } catch {
      host = '';
    }
    if (!host) {
      deps.note?.({ kind: 'denied', path: String(input['url'] ?? ''), reason: 'dirección no válida' });
      return deny('La dirección no es válida.');
    }
    if (grant(webGrant(host))) return allow(input);
    const yes = `Permitir ${host} en esta ejecución`;
    const answer = (await deps.ask({ text: `¿Puedo abrir ${host}?`, options: [yes, DENY], kind: 'permission', fallback: DENY })).trim();
    if (answer === yes) {
      keep(webGrant(host));
      return allow(input);
    }
    deps.note?.({ kind: 'denied', path: host, reason: 'web no permitida' });
    return deny(`El usuario no permite abrir ${host}.`);
  };
  return { decideRead, decideWeb };
}
