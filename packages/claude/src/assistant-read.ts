import path from 'node:path';
import { APP_KILL_DENY, killsAppProcess } from './commands';
import type { PermissionResult } from './sdk-types';

/** Herramientas de lectura del asistente: archivos y carpetas en cualquier sitio, y la web [R29.7]. */
export const ASSISTANT_READ_TOOLS = ['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch'] as const;
export type AssistantReadTool = (typeof ASSISTANT_READ_TOOLS)[number];

export const isAssistantReadTool = (tool: string): tool is AssistantReadTool => (ASSISTANT_READ_TOOLS as readonly string[]).includes(tool);


/** Carpetas cuyo contenido son credenciales [R29.8]. */
const SENSITIVE_DIRS = new Set(['.ssh', '.aws', '.gnupg', '.azure', '.kube', '.docker']);
/** Nombres de archivo con secretos [R29.8]. */
const SENSITIVE_FILES: RegExp[] = [
  /^\.env(\..*)?$/i,
  /^\.envrc$/i,
  /\.(pem|key|pfx|p12|jks|keystore|ppk|kdbx|asc|gpg)$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)(\..*)?$/i,
  /^\.(npmrc|pypirc|netrc|git-credentials|pgpass)$/i,
  /^_netrc$/i,
  /^(credentials|secrets?)(\.(json|ya?ml|toml|ini|txt|env|cfg|conf|xml))?$/i,
  // La sesión de Claude Code [R87.7].
  /^\.credentials\.json$/i,
];

const parts = (p: string) => p.split(/[\\/]+/).filter((s) => s.length > 0);
/** Comparación sin mayúsculas y con barras unificadas, porque en Windows `C:\Users` y `c:/users` son lo mismo. */
const norm = (p: string) => path.resolve(p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

/** ¿Es un patrón o ruta que apunta a un archivo o carpeta de secretos? Vale para rutas y para patrones de Glob [R29.8]. */
export function isSensitivePath(target: string, protectedDirs: readonly string[] = [], cwd?: string): boolean {
  if (typeof target !== 'string' || target.length === 0) return false;
  const segs = parts(target);
  if (segs.some((s) => SENSITIVE_DIRS.has(s.toLowerCase()))) return true;
  // En los patrones de Glob se quitan los comodines: «**/.env*» busca «.env» y «*.pem» busca «.pem».
  const named = (s: string) => [s, s.replace(/[*?]/g, '')].filter((x) => x.length > 0);
  if (segs.some((s) => named(s).some((n) => SENSITIVE_FILES.some((re) => re.test(n))))) return true;
  if (protectedDirs.length > 0 && !/[*?[]/.test(target)) {
    const abs = norm(cwd && !path.isAbsolute(target) ? path.join(cwd, target) : target);
    for (const dir of protectedDirs) {
      const d = norm(dir);
      if (abs === d || abs.startsWith(`${d}/`)) return true;
    }
  }
  return false;
}

/** Rutas y patrones de una llamada de lectura que hay que comprobar [R29.8]. */
function targetsOf(input: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const k of ['file_path', 'notebook_path', 'path', 'pattern', 'glob']) {
    const v = input[k];
    if (typeof v === 'string' && v.length > 0) out.push(v);
  }
  return out;
}

/** Herramientas de archivos que escriben [R50.8]. */
export const ASSISTANT_WRITE_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'] as const;
/** Herramientas del sistema que se ven en el chat [R29.9][R50.9]. */
export const ASSISTANT_SHOWN_TOOLS = [...ASSISTANT_READ_TOOLS, ...ASSISTANT_WRITE_TOOLS, 'Bash', 'Agent'] as const;
export const isAssistantShownTool = (tool: string): boolean => (ASSISTANT_SHOWN_TOOLS as readonly string[]).includes(tool);

export const APP_DATA_MESSAGE = 'Esa es la carpeta de datos de la aplicación, con la clave y los secretos cifrados: el asistente no la lee ni la escribe. Si necesitas un secreto, usa request_secret.';
export const APP_STATE_MESSAGE =
  'En .orquestador están los agentes, diagramas y ejecuciones que la aplicación tiene abiertos: no los escribas a mano. Usa las herramientas mcp__orquestador__*, que mantienen la interfaz al día.';

const inside = (target: string, dirs: readonly string[], cwd?: string) => {
  if (dirs.length === 0 || /[*?[]/.test(target)) return false;
  const abs = norm(cwd && !path.isAbsolute(target) ? path.join(cwd, target) : target);
  return dirs.some((dir) => {
    const d = norm(dir);
    return abs === d || abs.startsWith(`${d}/`);
  });
};

/**
 * Decide una llamada a herramienta del asistente: todo se permite sin preguntar, como en Claude Code, salvo leer o
 * escribir la carpeta de datos de la app y escribir en `.orquestador` del proyecto [R50.8].
 */
export function assistantToolPolicy(opts: { appTools?: readonly string[]; protectedDirs?: readonly string[]; cwd?: string; appStateDirs?: readonly string[] }) {
  const protectedDirs = opts.protectedDirs ?? [];
  const stateDirs = opts.appStateDirs ?? (opts.cwd ? [path.join(opts.cwd, '.orquestador')] : []);
  return (tool: string, input: Record<string, unknown>): PermissionResult => {
    const allow: PermissionResult = { behavior: 'allow', updatedInput: input };
    // El asistente tampoco cierra el orquestador por nombre ni por PID [R90.10].
    if (tool === 'Bash' && typeof input['command'] === 'string' && killsAppProcess(input['command'] as string, [process.pid])) return { behavior: 'deny', message: APP_KILL_DENY };
    const writes = (ASSISTANT_WRITE_TOOLS as readonly string[]).includes(tool);
    if (!writes && tool !== 'Read' && tool !== 'Glob' && tool !== 'Grep') return allow;
    // En `Grep`, `pattern` es una expresión regular, no una ruta: solo cuentan `path` y `glob`.
    const targets = tool === 'Grep' ? targetsOf({ path: input['path'], glob: input['glob'] }) : targetsOf({ ...input, notebook_path: input['notebook_path'] });
    if (targets.some((t) => inside(t, protectedDirs, opts.cwd))) return { behavior: 'deny', message: APP_DATA_MESSAGE };
    if (writes && targets.some((t) => inside(t, stateDirs, opts.cwd))) return { behavior: 'deny', message: APP_STATE_MESSAGE };
    return allow;
  };
}

/** Gancho `PreToolUse` del SDK: corre antes de cualquier permiso automático, así que es donde de verdad se bloquea [R50.8]. */
export function assistantGuardHook(policy: (tool: string, input: Record<string, unknown>) => PermissionResult) {
  return async (input: unknown): Promise<Record<string, unknown>> => {
    const i = (input ?? {}) as { tool_name?: unknown; tool_input?: unknown };
    const tool = typeof i.tool_name === 'string' ? i.tool_name : '';
    if (!tool) return {};
    const decision = policy(tool, (i.tool_input ?? {}) as Record<string, unknown>);
    if (decision.behavior === 'allow') return {};
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: decision.message } };
  };
}

/** Herramientas de archivos que comprueba el gancho [R50.8]. */
export const ASSISTANT_GUARD_MATCHER = ['Read', 'Glob', 'Grep', 'Bash', ...ASSISTANT_WRITE_TOOLS].join('|');

const MAX_TARGET = 80;
const short = (s: string) => (s.length > MAX_TARGET ? `${s.slice(0, MAX_TARGET - 1)}…` : s);

/**
 * Lo que la interfaz ve de una lectura: el nombre del archivo, el patrón o el dominio, nunca la ruta completa
 * (la interfaz no ve rutas) [R29.9].
 */
export function readTargetOf(tool: string, input: unknown): string {
  const i = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const str = (k: string) => (typeof i[k] === 'string' ? (i[k] as string) : '');
  const base = (p: string) => {
    const segs = parts(p);
    return segs[segs.length - 1] ?? '';
  };
  switch (tool) {
    case 'Read':
      return short(base(str('file_path')));
    case 'Glob':
      return short(base(str('pattern')) || str('pattern'));
    case 'Grep':
      return short(str('pattern'));
    case 'WebFetch': {
      try {
        return new URL(str('url')).hostname;
      } catch {
        return '';
      }
    }
    case 'WebSearch':
      return short(str('query'));
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
      return short(base(str('file_path')));
    case 'NotebookEdit':
      return short(base(str('notebook_path')));
    case 'Bash':
      return short(commandLabel(str('command')));
    case 'Agent':
      return short(str('description') || str('subagent_type'));
    default:
      return '';
  }
}

/** Programas cuyo subcomando dice lo que hacen (`npm install`, `git status`) [R50.9]. */
const WITH_SUB = new Set(['npm', 'npx', 'pnpm', 'yarn', 'git', 'pip', 'pip3', 'cargo', 'dotnet', 'go', 'uv', 'bun', 'deno', 'docker']);

/**
 * Lo que la interfaz ve de un comando: cada programa y, si lo tiene, su subcomando, sin argumentos ni rutas
 * (`cd C:\mcp && npm install --no-audit` → `npm install`) [R50.9].
 */
export function commandLabel(command: string): string {
  const words = (seg: string) => seg.trim().split(/\s+/).filter(Boolean);
  const name = (w: string) => w.replace(/^["']|["']$/g, '').split(/[\\/]/).pop() ?? '';
  const plain = (w: string) => /^[A-Za-z][\w:.-]*$/.test(w);
  const out = command
    .split(/&&|\|\||[;|\n]/)
    .map(words)
    .filter((w) => w.length > 0 && name(w[0]!) !== 'cd' && !w[0]!.startsWith('-'))
    .map((w) => {
      const prog = name(w[0]!);
      const sub = w[1];
      return WITH_SUB.has(prog.toLowerCase().replace(/\.(exe|cmd)$/, '')) && sub && plain(sub) ? `${prog} ${sub}` : prog;
    })
    .filter((x) => x.length > 0);
  return out.join(' && ');
}
