import { withinDeclared } from '@orquestador/core';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { AgentQuestion } from '@orquestador/core';
import type { PermissionLevel } from '@orquestador/core';
import { ISOLATED_GIT_DENY, allowCommandForRun, classifyCommand, grantKey, sensitiveCommand, writesGit } from './commands';
import { AUTO_TOOLS } from './connection';
import type { CanUseTool, PermissionResult, PreToolUseHook } from './sdk-types';

/** Carpetas que nunca se resumen ni se pueden escribir [R31.2][R31.5]. */
const HIDDEN = new Set(['.git', 'node_modules', '.orquestador']);
const BINARY = /\.(png|jpe?g|gif|webp|bmp|ico|psd|zip|7z|rar|gz|tar|exe|dll|so|dylib|bin|pdf|mp3|wav|ogg|flac|mp4|mov|avi|webm|ttf|otf|woff2?|pyc)$/i;
const MANIFESTS = ['README.md', 'CLAUDE.md', 'package.json', 'pyproject.toml', 'Cargo.toml'];
const MAX_ENTRIES = 5000;
const MAX_LISTED = 120;
const MAX_DOC = 2000;

export interface FolderSummary {
  /** Nombre de la carpeta (nunca la ruta) [R31.1]. */
  name: string;
  files: number;
  /** Texto para el prompt de los agentes [R31.2]. */
  text: string;
}

const isHidden = (name: string) => HIDDEN.has(name);

/** Cuenta los archivos de una carpeta sin entrar en las ocultas ni pasar de un tope. */
async function walk(dir: string, depth: number, rel: string, tree: string[], count: { n: number }): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const e of entries) {
    if (count.n >= MAX_ENTRIES) return;
    if (isHidden(e.name)) continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (depth < 2 && tree.length < MAX_LISTED) tree.push(`${r}/`);
      await walk(path.join(dir, e.name), depth + 1, r, tree, count);
    } else if (e.isFile() && !BINARY.test(e.name)) {
      count.n++;
      if (depth <= 2 && tree.length < MAX_LISTED) tree.push(r);
    }
  }
}

/** Resumen de la carpeta de trabajo: árbol de dos niveles y el principio de README, CLAUDE.md y manifiestos [R31.2]. */
export async function summarizeFolder(root: string): Promise<FolderSummary> {
  const tree: string[] = [];
  const count = { n: 0 };
  await walk(root, 1, '', tree, count);
  const docs: string[] = [];
  for (const name of MANIFESTS) {
    try {
      const raw = await fs.readFile(path.join(root, name), 'utf8');
      docs.push(`--- ${name} ---\n${raw.length > MAX_DOC ? `${raw.slice(0, MAX_DOC)}…` : raw}`);
    } catch {
      /* no existe */
    }
  }
  const more = count.n > tree.length ? `\n(… hasta ${count.n} archivos en total)` : '';
  const text = [`Archivos y carpetas (dos niveles):\n${tree.join('\n') || '(carpeta vacía)'}${more}`, ...docs].join('\n\n');
  return { name: path.basename(root) || root, files: count.n, text };
}

/**
 * Ruta absoluta dentro de `root`, o `null` si sale de ella: rutas absolutas ajenas, `..`, enlaces simbólicos
 * que salen y carpetas internas protegidas [R31.5].
 */
export async function confine(root: string, target: string): Promise<{ abs: string; rel: string } | null> {
  if (typeof target !== 'string' || target.length === 0 || target.includes('\0')) return null;
  const base = path.resolve(root);
  const abs = path.resolve(base, target);
  const rel = path.relative(base, abs);
  if (rel === '' || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return null;
  const parts = rel.split(path.sep);
  if (parts.some(isHidden)) return null;
  // El ancestro más cercano que exista debe seguir dentro de la raíz una vez resueltos los enlaces.
  let realBase: string;
  try {
    realBase = await fs.realpath(base);
  } catch {
    return null;
  }
  let probe = abs;
  for (;;) {
    try {
      const real = await fs.realpath(probe);
      const back = path.relative(realBase, real);
      if (back === '..' || back.startsWith(`..${path.sep}`) || path.isAbsolute(back)) return null;
      break;
    } catch {
      const up = path.dirname(probe);
      if (up === probe) return null;
      probe = up;
    }
  }
  return { abs, rel: parts.join('/') };
}

export const READ_TOOLS = ['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch'] as const;
export const WRITE_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'] as const;
/** Herramientas que los agentes tienen cuando hay política de escritura [R31.11]. */
export const WORK_TOOLS = [...READ_TOOLS, ...WRITE_TOOLS, 'Bash', 'AskUserQuestion'] as const;
/** Las de Claude Code que además tiene cada paso de agente; `Skill` solo si se carga su configuración [R50.2]. */
export const agentTools = (claudeConfig: boolean): string[] => [...WORK_TOOLS, 'Agent', 'TodoWrite', ...(claudeConfig ? ['Skill'] : [])];

export const ALLOW_ONCE = 'Permitir';
export const ALLOW_RUN = 'Permitir en esta ejecución';
export const DENY = 'Denegar';

export interface WritePolicyDeps {
  root: string;
  /**
   * Nivel de permisos del agente o, si no tiene, del proyecto [R47.8][R47.10]: solo lectura, preguntar,
   * automático (solo pregunta lo delicado) o sin preguntar nunca.
   */
  level: PermissionLevel;
  ask(question: AgentQuestion): Promise<string>;
  /** Guarda una copia del archivo antes de modificarlo [R31.6]. */
  backup(abs: string, rel: string): Promise<void>;
  /** Avisa de lo que se ha denegado o cambiado, para el registro [R31.5][R31.7]. */
  note?(event: { kind: 'created' | 'modified' | 'denied'; path: string; reason?: string }): void;
  /** El agente debe preguntar antes de escribir o ejecutar nada [R39.3]. */
  askFirst?: boolean;
  /** Avisa cuando el agente ha preguntado y tiene respuesta [R39.4]. */
  onAsked?(): void;
  /** Comandos permitidos para toda la ejecución, compartidos por sus pasos [R47.3]. */
  commandGrants?: Set<string>;
  /**
   * Carpetas `.orquestador` que nunca se escriben, tampoco con «Sin preguntar nunca» [R50.5]. Sin valor, la de `root`.
   */
  appDirs?: readonly string[];
}

/** Motivo al escribir en `.orquestador` [R50.5]. */
export const APP_DIR_DENY =
  'En .orquestador están los diagramas y las ejecuciones que la aplicación tiene abiertos: no se escribe ahí. Deja tus archivos en otra carpeta.';

const sameOrInside = (abs: string, dir: string) => {
  const n = (p: string) => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));
  const a = n(abs);
  const d = n(dir);
  return a === d || a.startsWith(d.endsWith(path.sep) ? d : `${d}${path.sep}`);
};

/** Motivo de la denegación para un agente de solo lectura [R47.9]. */
export const READONLY_DENY =
  'Este agente es de solo lectura: no puede crear, modificar ni borrar archivos ni ejecutar comandos que cambien algo. Propón los cambios en tu respuesta.';

/** Motivo de la denegación mientras un agente que debe preguntar no lo ha hecho [R39.3]. */
export const ASK_FIRST_DENY =
  'Antes de cambiar archivos o ejecutar comandos tienes que consultar al usuario: preséntale tu plan y las decisiones con la herramienta de preguntas (AskUserQuestion) y espera su respuesta.';

const allow = (input: Record<string, unknown>): PermissionResult => ({ behavior: 'allow', updatedInput: input });
const deny = (message: string): PermissionResult => ({ behavior: 'deny', message });

async function exists(abs: string): Promise<boolean> {
  try {
    await fs.stat(abs);
    return true;
  } catch {
    return false;
  }
}

function pathOf(input: Record<string, unknown>): string | undefined {
  for (const key of ['file_path', 'notebook_path', 'path']) if (typeof input[key] === 'string') return input[key] as string;
  return undefined;
}

/** Límites del paso: no escribe fuera de lo que declaró el Coordinador, y se le dice por qué [R60.16]. */
export function withScope(scope: readonly string[] | undefined, root: string, note: WritePolicyDeps['note'], inner: (tool: string, input: Record<string, unknown>) => Promise<PermissionResult>): (tool: string, input: Record<string, unknown>) => Promise<PermissionResult> {
  if (!scope) return inner;
  return async (tool, input) => {
    const target = (WRITE_TOOLS as readonly string[]).includes(tool) ? pathOf(input) : undefined;
    if (target !== undefined) {
      const rel = path.relative(root, path.resolve(root, target)).split(path.sep).join('/');
      if (!withinDeclared(rel, scope)) {
        const reason = `fuera de los archivos de este paso (${scope.join(', ')})`;
        note?.({ kind: 'denied', path: rel, reason });
        return deny(`El Supervisor ha bloqueado esta escritura: ${rel} está ${reason}. Sigue con lo tuyo, y si de verdad hace falta, dilo en tu respuesta.`);
      }
    }
    return inner(tool, input);
  };
}

/** Motivo al escribir en la carpeta de trabajo desde una rama en paralelo [R73.8]. */
export const ISOLATED_DENY =
  'Este paso trabaja en una copia aislada de la carpeta porque corre en paralelo con otros: escribe en tu carpeta actual, no en la original. Lo tuyo se junta con lo de las otras ramas al terminar.';

/**
 * Rama en paralelo [R73.8][R73.9]: nunca se escribe en la carpeta original (también con «Sin preguntar nunca») ni se
 * cambia git. Lo demás, como siempre.
 */
export function withIsolation(original: string | undefined, note: WritePolicyDeps['note'], inner: (tool: string, input: Record<string, unknown>) => Promise<PermissionResult>, root: string): (tool: string, input: Record<string, unknown>) => Promise<PermissionResult> {
  if (original === undefined) return inner;
  return async (tool, input) => {
    const target = (WRITE_TOOLS as readonly string[]).includes(tool) ? pathOf(input) : undefined;
    if (target !== undefined && sameOrInside(path.resolve(root, target), original)) {
      note?.({ kind: 'denied', path: target, reason: 'carpeta original de una rama en paralelo' });
      return deny(ISOLATED_DENY);
    }
    if (tool === 'Bash' && typeof input['command'] === 'string') {
      const command = input['command'] as string;
      if (writesGit(command)) {
        note?.({ kind: 'denied', path: command, reason: ISOLATED_GIT_DENY });
        return deny(ISOLATED_GIT_DENY);
      }
      // Un comando que nombra la carpeta original y no solo lee también rompería el aislamiento.
      if (command.includes(original) && !(await classifyCommand(command, original, original, { readOnly: true })).safe) {
        note?.({ kind: 'denied', path: command, reason: 'carpeta original de una rama en paralelo' });
        return deny(ISOLATED_DENY);
      }
    }
    return inner(tool, input);
  };
}

/**
 * Política de herramientas [R31.11][R47.9]: leer siempre; nada se escribe fuera de la carpeta [R31.5]; crear archivos
 * nuevos dentro, siempre. Lo demás depende del nivel: en solo lectura no se escribe ni se ejecuta más que lo sencillo
 * que solo lee; en «preguntar», modificar y los comandos que no son sencillos preguntan; en «automático», solo
 * preguntan los comandos delicados (borrar, salir de la carpeta, publicar fuera); en «sin preguntar», nada pregunta.
 */
export function createWritePolicy(deps: WritePolicyDeps): (tool: string, input: Record<string, unknown>) => Promise<PermissionResult> {
  let allowedThisRun = false;
  let asked = false;
  /** Lo que este agente ha creado en este intento: retocarlo no es modificar algo ajeno [R45.1]. */
  const createdHere = new Set<string>();

  const confirmModify = async (rel: string): Promise<boolean | string> => {
    if (deps.level === 'auto' || deps.level === 'full' || allowedThisRun) return true;
    const answer = (await deps.ask({ text: `¿Puedo modificar ${rel}?`, options: [ALLOW_ONCE, ALLOW_RUN, DENY], kind: 'permission', fallback: DENY })).trim();
    if (answer === ALLOW_ONCE) return true;
    if (answer === ALLOW_RUN) {
      allowedThisRun = true;
      return true;
    }
    return answer === DENY || answer === '' ? false : answer;
  };

  const appDirs = deps.appDirs ?? [path.join(deps.root, '.orquestador')];

  return async (tool, input) => {
    if ((READ_TOOLS as readonly string[]).includes(tool)) return allow(input);
    // Subagentes, lista de tareas y skills de Claude Code: no escriben por sí mismos; lo que hagan pasa por aquí [R50.2].
    if ((AUTO_TOOLS as readonly string[]).includes(tool)) return allow(input);

    if (tool === 'AskUserQuestion') {
      const r = await askUser(deps, input);
      asked = true;
      deps.onAsked?.();
      return r;
    }

    // Un agente que pregunta antes de actuar no escribe ni ejecuta nada hasta tener respuesta [R39.3].
    if (deps.askFirst && !asked && ((WRITE_TOOLS as readonly string[]).includes(tool) || tool === 'Bash')) {
      deps.note?.({ kind: 'denied', path: pathOf(input) ?? (typeof input['command'] === 'string' ? (input['command'] as string) : tool), reason: 'aún no ha preguntado' });
      return deny(ASK_FIRST_DENY);
    }

    if (deps.level === 'readonly' && (WRITE_TOOLS as readonly string[]).includes(tool)) {
      deps.note?.({ kind: 'denied', path: pathOf(input) ?? '', reason: 'agente de solo lectura' });
      return deny(READONLY_DENY);
    }

    if ((WRITE_TOOLS as readonly string[]).includes(tool)) {
      const target = pathOf(input);
      const spot = target === undefined ? null : await confine(deps.root, target);
      // «Sin preguntar nunca» es como bypassPermissions de Claude Code: fuera de la carpeta, en .git y en
      // node_modules también se escribe, sin copia ni registro; solo .orquestador queda fuera [R50.5].
      if (!spot && deps.level === 'full' && target !== undefined && target.length > 0 && !target.includes('\0')) {
        const abs = path.resolve(deps.root, target);
        if (appDirs.some((d) => sameOrInside(abs, d))) {
          deps.note?.({ kind: 'denied', path: target, reason: APP_DIR_DENY });
          return deny(APP_DIR_DENY);
        }
        return allow(input);
      }
      if (!spot) {
        const reason = 'Solo puedes escribir dentro de la carpeta de trabajo, y no en .git, node_modules ni .orquestador.';
        deps.note?.({ kind: 'denied', path: target ?? '', reason });
        return deny(reason);
      }
      if (!(await exists(spot.abs))) {
        createdHere.add(spot.rel);
        deps.note?.({ kind: 'created', path: spot.rel });
        return allow(input);
      }
      if (createdHere.has(spot.rel)) {
        deps.note?.({ kind: 'modified', path: spot.rel });
        return allow(input);
      }
      const verdict = await confirmModify(spot.rel);
      if (verdict !== true) {
        const reason = typeof verdict === 'string' ? `El usuario no permite modificar ${spot.rel} y dice: ${verdict}` : `El usuario no permite modificar ${spot.rel}. Crea un archivo nuevo o propón el cambio en tu respuesta.`;
        deps.note?.({ kind: 'denied', path: spot.rel, reason });
        return deny(reason);
      }
      await deps.backup(spot.abs, spot.rel);
      deps.note?.({ kind: 'modified', path: spot.rel });
      return allow(input);
    }

    if (tool === 'Bash') {
      const command = typeof input['command'] === 'string' ? (input['command'] as string) : '';
      if (deps.level === 'full') return allow(input);
      // Solo lectura: solo lo sencillo que no crea nada, y sin preguntar [R47.9].
      if (deps.level === 'readonly') {
        if ((await classifyCommand(command, deps.root, deps.root, { readOnly: true })).safe) return allow(input);
        deps.note?.({ kind: 'denied', path: command, reason: 'agente de solo lectura' });
        return deny(READONLY_DENY);
      }
      // Comandos sencillos (mkdir, ls, git status…) dentro de la carpeta: sin preguntar [R47.2].
      if ((await classifyCommand(command, deps.root)).safe) return allow(input);
      const danger = sensitiveCommand(command, deps.root);
      // En automático solo preguntan los delicados [R47.9].
      if (deps.level === 'auto' && danger === null) return allow(input);
      const key = danger === null ? grantKey(command) : null;
      if (key !== null && deps.commandGrants?.has(key)) return allow(input);
      const forRun = key !== null && deps.commandGrants ? allowCommandForRun(key) : undefined;
      const text = danger === null ? `¿Puedo ejecutar este comando?\n${command}` : `¿Puedo ejecutar este comando? (${danger})\n${command}`;
      const answer = (await deps.ask({ text, options: [ALLOW_ONCE, ...(forRun ? [forRun] : []), DENY], kind: 'permission', fallback: DENY })).trim();
      if (answer === ALLOW_ONCE) return allow(input);
      if (forRun && answer === forRun) {
        deps.commandGrants!.add(key!);
        return allow(input);
      }
      deps.note?.({ kind: 'denied', path: command, reason: 'comando no permitido' });
      return deny(answer && answer !== DENY ? `El usuario no permite el comando y dice: ${answer}` : 'El usuario no permite ejecutar comandos.');
    }

    return deny(`La herramienta ${tool} no está permitida.`);
  };
}

/** Las preguntas de Claude llegan al chat del nodo y la respuesta vuelve al agente [R31.9]. */
async function askUser(deps: WritePolicyDeps, input: Record<string, unknown>): Promise<PermissionResult> {
  const questions = Array.isArray(input['questions']) ? (input['questions'] as Array<Record<string, unknown>>) : [];
  const answers: Record<string, string> = {};
  for (const q of questions) {
    const text = typeof q['question'] === 'string' ? (q['question'] as string) : '';
    if (!text) continue;
    const options = Array.isArray(q['options'])
      ? (q['options'] as unknown[]).map((o) => (typeof o === 'string' ? o : o && typeof o === 'object' && typeof (o as { label?: unknown }).label === 'string' ? (o as { label: string }).label : '')).filter(Boolean)
      : [];
    answers[text] = await deps.ask({ text, ...(options.length > 0 ? { options } : {}), kind: 'question' });
  }
  return allow({ ...input, answers });
}

/** Herramientas que el gancho deja a `canUseTool`: lecturas, preguntas (necesitan `updatedInput`) y las automáticas [R50.4]. */
const HOOK_SKIP = new Set<string>([...READ_TOOLS, 'AskUserQuestion', ...AUTO_TOOLS]);

/**
 * La misma política en `canUseTool` y en un gancho `PreToolUse`, con la decisión guardada por llamada: una regla
 * `allow` de `.claude` no se salta la copia ni el registro, y nada pregunta ni se copia dos veces [R50.4].
 */
export function guardedPolicy(policy: (tool: string, input: Record<string, unknown>, id?: string) => Promise<PermissionResult>): { canUseTool: CanUseTool; hook: PreToolUseHook } {
  const decided = new Map<string, Promise<PermissionResult>>();
  const decide = (tool: string, input: Record<string, unknown>, id: string | undefined): Promise<PermissionResult> => {
    if (!id) return policy(tool, input);
    let d = decided.get(id);
    if (!d) {
      d = policy(tool, input, id);
      decided.set(id, d);
      if (decided.size > 500) decided.delete(decided.keys().next().value!);
    }
    return d;
  };
  return {
    canUseTool: (tool, input, opts) => decide(tool, input, opts?.toolUseID),
    hook: async (raw, toolUseId) => {
      const i = (raw ?? {}) as { tool_name?: unknown; tool_input?: unknown; tool_use_id?: unknown };
      const tool = typeof i.tool_name === 'string' ? i.tool_name : '';
      if (!tool || HOOK_SKIP.has(tool)) return {};
      const id = toolUseId ?? (typeof i.tool_use_id === 'string' ? i.tool_use_id : undefined);
      const r = await decide(tool, (i.tool_input ?? {}) as Record<string, unknown>, id);
      return r.behavior === 'allow'
        ? { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' } }
        : { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: r.message } };
    },
  };
}
