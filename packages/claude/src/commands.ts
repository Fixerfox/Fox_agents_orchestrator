import { protectedName } from './protected';
import { promises as fs } from 'node:fs';
import path from 'node:path';

/** Caracteres que convierten un comando en algo más que un programa con argumentos [R47.1]. */
const SPECIAL = /[;|&><`$~%\\\n\r]/;

/** Carpetas internas que `mkdir` y `touch` no pueden tocar sin preguntar [R47.1]. */

/** Programas que solo leen: sus argumentos que no son opciones son rutas [R47.1]. */
const READ_PATHS = new Set(['ls', 'dir', 'cat', 'head', 'tail', 'wc', 'tree', 'stat', 'file']);
/** Programas cuyos argumentos no son rutas y no pueden cambiar nada [R47.1]. */
const NO_PATHS = new Set(['echo', 'pwd', 'which', 'where']);
const VERSION_ONLY = new Set(['node', 'npm', 'npx', 'python', 'python3', 'pip']);
const VERSION_FLAGS = new Set(['--version', '-v', '-V']);
const GIT_READ = new Set(['status', 'diff', 'log', 'show', 'rev-parse', 'ls-files', 'branch']);
const GIT_BRANCH_CHANGE = new Set(['-d', '-D', '-m', '-M', '-c', '-C', '--delete', '--move', '--copy', '-u', '-f', '--force']);
const FIND_FORBIDDEN = /^-(exec|execdir|ok|okdir|delete|fprint.*|fls)$/;
const GREP_PATTERN_FLAGS = new Set(['-e', '-f', '--regexp', '--file']);

/** Programas para los que «en esta ejecución» incluye el subcomando [R47.3]. */
const WITH_SUBCOMMAND = new Set(['npm', 'npx', 'pnpm', 'yarn', 'git', 'pip', 'cargo', 'dotnet', 'go']);
/** Nunca se permiten para toda la ejecución [R47.3]. */
const NEVER_GRANT = new Set(['rm', 'rmdir', 'del', 'rd', 'erase', 'mv', 'move', 'dd', 'chmod', 'chown', 'sudo', 'su', 'shred', 'format']);
const GIT_NEVER_GRANT = new Set(['push', 'reset', 'clean', 'checkout', 'restore', 'rebase', 'rm']);

/** Separa un comando en palabras respetando comillas simples y dobles; `null` si quedan comillas abiertas. */
export function tokenize(segment: string): string[] | null {
  const out: string[] = [];
  let cur = '';
  let has = false;
  let quote: '"' | "'" | null = null;
  for (const ch of segment) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
    } else if (/\s/.test(ch)) {
      if (has || cur) out.push(cur);
      cur = '';
      has = false;
    } else {
      cur += ch;
      has = true;
    }
  }
  if (quote) return null;
  if (has || cur) out.push(cur);
  return out;
}

const programOf = (word: string): string => path.basename(word).toLowerCase().replace(/\.(exe|cmd|bat)$/, '');

/**
 * En Windows la `Bash` de Claude Code es Git Bash, que escribe `D:\x` como `/d/x` (o `/cygdrive/d/x`): se pasa a la
 * forma de Windows antes de comprobar si sale de la carpeta. En los demás sistemas no se toca [R51.5].
 */
export function nativePath(arg: string, platform: NodeJS.Platform = process.platform): string {
  if (platform !== 'win32') return arg;
  const m = /^(?:\/cygdrive)?\/([a-zA-Z])(\/.*)?$/.exec(arg);
  return m ? `${m[1]!.toUpperCase()}:${m[2] ?? '/'}` : arg;
}

/** Ruta absoluta de `arg` si queda dentro de `root` (también tras enlaces simbólicos); si no, `null` [R47.1]. */
async function inside(root: string, cwd: string, arg: string): Promise<string | null> {
  const base = path.resolve(root);
  const abs = path.resolve(cwd, nativePath(arg));
  const rel = path.relative(base, abs);
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return null;
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
      return abs;
    } catch {
      const up = path.dirname(probe);
      if (up === probe) return null;
      probe = up;
    }
  }
}

/** Carpetas internas, como las ve el sistema (mayúsculas, puntos finales, flujos de NTFS) [R87.1]. */
export const isProtected = (root: string, abs: string): boolean => path.relative(path.resolve(root), abs).split(path.sep).some((p) => protectedName(p));

/** Comprueba un comando simple (sin `&&`) y devuelve la carpeta en la que queda, o `null` si no es sencillo. */
async function simple(words: string[], root: string, cwd: string, readOnly = false): Promise<string | null> {
  const [first, ...args] = words;
  if (!first) return null;
  const prog = programOf(first);
  const positional = args.filter((a) => !a.startsWith('-'));
  const allInside = async (paths: string[]): Promise<boolean> => {
    for (const p of paths) if ((await inside(root, cwd, p)) === null) return false;
    return true;
  };

  if (NO_PATHS.has(prog)) return cwd;
  if (READ_PATHS.has(prog)) return (await allInside(positional)) ? cwd : null;

  if (prog === 'mkdir' || prog === 'touch') {
    if (readOnly) return null;
    const flags = prog === 'mkdir' ? new Set(['-p', '-v', '--parents', '--verbose']) : new Set(['-c', '--no-create']);
    if (args.some((a) => a.startsWith('-') && !flags.has(a))) return null;
    if (positional.length === 0) return null;
    for (const p of positional) {
      const abs = await inside(root, cwd, p);
      if (abs === null || isProtected(root, abs)) return null;
    }
    return cwd;
  }

  if (prog === 'cd') {
    if (args.length !== 1 || args[0]!.startsWith('-')) return null;
    const abs = await inside(root, cwd, args[0]!);
    if (abs === null) return null;
    try {
      if (!(await fs.stat(abs)).isDirectory()) return null;
    } catch {
      return null;
    }
    return abs;
  }

  if (prog === 'grep' || prog === 'rg') {
    const paths = args.some((a) => GREP_PATTERN_FLAGS.has(a) || a.startsWith('--regexp=') || a.startsWith('--file=')) ? positional : positional.slice(1);
    return (await allInside(paths)) ? cwd : null;
  }

  if (prog === 'find') {
    if (args.some((a) => FIND_FORBIDDEN.test(a))) return null;
    const start = args.findIndex((a) => a.startsWith('-') || a === '(' || a === '!');
    const paths = start === -1 ? args : args.slice(0, start);
    return (await allInside(paths)) ? cwd : null;
  }

  if (prog === 'git') {
    const sub = args[0];
    if (!sub || !GIT_READ.has(sub)) return null;
    const rest = args.slice(1);
    if (rest.some((a) => a.startsWith('--output'))) return null;
    if (sub === 'branch' && rest.some((a) => GIT_BRANCH_CHANGE.has(a) || a.startsWith('--set-upstream') || !a.startsWith('-'))) return null;
    return cwd;
  }

  if (VERSION_ONLY.has(prog)) return args.length === 1 && VERSION_FLAGS.has(args[0]!) ? cwd : null;

  return null;
}

/**
 * ¿Es un comando «sencillo» que se puede ejecutar sin preguntar? Solo programas que leen o crean carpetas y
 * archivos vacíos, sin redirecciones ni sustituciones y con todas sus rutas dentro de la carpeta [R47.1].
 */
export async function classifyCommand(command: string, root: string, cwd: string = root, opts: { readOnly?: boolean } = {}): Promise<{ safe: boolean }> {
  const text = command.trim();
  if (!text) return { safe: false };
  const segments = text.split('&&');
  // `&` suelto o `&&&` dejan un `&` en algún tramo y SPECIAL lo rechaza.
  let at = path.resolve(cwd);
  for (const seg of segments) {
    if (SPECIAL.test(seg)) return { safe: false };
    const words = tokenize(seg.trim());
    if (!words || words.length === 0) return { safe: false };
    const next = await simple(words, root, at, opts.readOnly === true);
    if (next === null) return { safe: false };
    at = next;
  }
  return { safe: true };
}

/**
 * Clave con la que se puede permitir un comando para toda la ejecución, o `null` si no se ofrece:
 * el programa (y el subcomando en npm, git…), nunca para borrar, mover o cambiar permisos [R47.3].
 */
export function grantKey(command: string): string | null {
  const text = command.trim();
  if (!text || SPECIAL.test(text) || text.includes('&')) return null;
  const words = tokenize(text);
  if (!words || words.length === 0) return null;
  const prog = programOf(words[0]!);
  if (!prog || NEVER_GRANT.has(prog)) return null;
  const sub = words[1];
  if (prog === 'git' && (!sub || GIT_NEVER_GRANT.has(sub))) return null;
  if (WITH_SUBCOMMAND.has(prog) && sub && !sub.startsWith('-')) return `${prog} ${sub}`;
  return prog;
}

/** Texto de la opción «Permitir «npm test» en esta ejecución» [R47.3]. */
export const allowCommandForRun = (key: string): string => `Permitir «${key}» en esta ejecución`;

/** Programas que borran, cambian permisos o el sistema: siempre preguntan [R47.5]. */
/**
 * Los tres motivos por los que un comando delicado pregunta, también en modo automático [R47.5]: borrar,
 * salir de la carpeta del proyecto (o no poder comprobarlo) y publicar fuera.
 */
export const DANGER = {
  delete: 'borra o descarta cambios',
  outside: 'puede afectar a algo fuera de la carpeta del proyecto',
  publish: 'publica fuera del equipo',
  code: 'ejecuta código que no se puede revisar',
} as const;

/** Intérpretes y la opción que les pasa código en línea [R89.1]. */
const INLINE_CODE: Record<string, readonly string[]> = {
  node: ['-e', '--eval', '-p', '--print'],
  bun: ['-e', '--eval', '-p', '--print'],
  python: ['-c'],
  python3: ['-c'],
  py: ['-c'],
  perl: ['-e', '-E'],
  ruby: ['-e'],
  php: ['-r'],
};
/** Programas que mandan datos a otro equipo [R89.2]. */
const UPLOADERS = new Set(['scp', 'sftp', 'ftp', 'nc', 'ncat', 'netcat']);
const CURL_UPLOAD = /^(-T|--upload-file|-d|--data(-[a-z]+)?|-F|--form(-string)?)(=|$)/;
const WGET_UPLOAD = /^--(post-data|post-file|body-data|body-file|method)(=|$)/;

/** ¿Sube datos fuera del equipo? [R89.2] */
function uploads(prog: string, args: readonly string[]): boolean {
  if (UPLOADERS.has(prog)) return true;
  if (prog === 'curl') {
    if (args.some((a) => CURL_UPLOAD.test(a) || /^-[a-zA-Z]*[TdF]$/.test(a))) return true;
    const i = args.findIndex((a) => a === '-X' || a === '--request' || a.startsWith('--request=') || /^-X./.test(a));
    if (i >= 0) {
      const a = args[i]!;
      const method = (a.startsWith('--request=') ? a.slice(10) : a.length > 2 && a.startsWith('-X') ? a.slice(2) : (args[i + 1] ?? '')).toUpperCase();
      if (method !== 'GET' && method !== 'HEAD') return true;
    }
  }
  if (prog === 'wget' && args.some((a) => WGET_UPLOAD.test(a))) return true;
  // rsync a otro equipo: `host:ruta` o `usuario@host:ruta` (no `C:\…`).
  if (prog === 'rsync' && args.some((a) => !a.startsWith('-') && /^[^/\\\s]{2,}:/.test(a))) return true;
  return false;
}
export type Danger = (typeof DANGER)[keyof typeof DANGER];

const SENSITIVE_PROGRAMS: Record<string, Danger> = {
  rm: DANGER.delete, rmdir: DANGER.delete, del: DANGER.delete, erase: DANGER.delete, rd: DANGER.delete, shred: DANGER.delete,
  'remove-item': DANGER.delete, ri: DANGER.delete, unlink: DANGER.delete,
  dd: DANGER.outside, mkfs: DANGER.outside, format: DANGER.outside, diskpart: DANGER.outside, fdisk: DANGER.outside,
  chown: DANGER.outside, icacls: DANGER.outside, takeown: DANGER.outside,
  sudo: DANGER.outside, su: DANGER.outside, runas: DANGER.outside, doas: DANGER.outside,
  shutdown: DANGER.outside, reboot: DANGER.outside, halt: DANGER.outside, poweroff: DANGER.outside,
  kill: DANGER.outside, killall: DANGER.outside, pkill: DANGER.outside, taskkill: DANGER.outside, 'stop-process': DANGER.outside,
  reg: DANGER.outside, regedit: DANGER.outside, setx: DANGER.outside, crontab: DANGER.outside, schtasks: DANGER.outside,
  systemctl: DANGER.outside, service: DANGER.outside, sc: DANGER.outside,
  eval: DANGER.outside, iex: DANGER.outside, 'invoke-expression': DANGER.outside,
};
const SHELLS = new Set(['sh', 'bash', 'zsh', 'fish', 'dash', 'cmd', 'pwsh', 'powershell']);
const SHELL_INLINE = new Set(['-c', '/c', '/k', '-command']);
const GIT_SENSITIVE = new Set(['push', 'clean', 'rebase', 'filter-branch', 'filter-repo', 'update-ref', 'rm', 'restore', 'reflog']);
const PUBLISH = new Set(['publish', 'unpublish', 'login', 'adduser', 'logout', 'token', 'owner', 'deprecate']);
const PACKAGE_MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'bun', 'cargo', 'twine', 'gem', 'dotnet']);

/** ¿Sale de la carpeta? Rutas absolutas ajenas, `..` que escapa, `~`, `$HOME` y variables de Windows [R47.5]. */
function escapes(root: string, cwd: string, arg: string): boolean {
  let a = nativePath(arg.replace(/^['"]|['"]$/g, ''));
  // Opciones con valor (`--outDir=../x`): se mira el valor.
  if (a.startsWith('-')) {
    const eq = a.indexOf('=');
    if (eq < 0) return false;
    a = nativePath(a.slice(eq + 1).replace(/^['"]|['"]$/g, ''));
  }
  if (!a || a === '/dev/null' || a.toLowerCase() === 'nul') return false;
  if (/^~|^\$\{?(home|userprofile|appdata|localappdata|programfiles|tmp|temp)\b|^%[a-z_]+%/i.test(a)) return true;
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  if (/^[a-z]:[\\/]/i.test(a) || a.startsWith('\\\\')) {
    const r = norm(path.resolve(root));
    const t = norm(a);
    return !(t === r || t.startsWith(`${r}/`));
  }
  if (!a.includes('/') && !a.includes('\\') && a !== '..') return false;
  const abs = path.resolve(cwd, a.replace(/\\/g, '/'));
  const rel = path.relative(path.resolve(root), abs);
  return rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel);
}

/** Separa un comando en tramos: `&&`, `||`, `;`, `|`, `&`, saltos de línea y sustituciones `$(…)` y `` `…` ``. */
function segmentsOf(command: string): { text: string; piped: boolean }[] {
  const out: { text: string; piped: boolean }[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;
  let piped = false;
  const flush = (nextPiped: boolean) => {
    if (cur.trim()) out.push({ text: cur.trim(), piped });
    cur = '';
    piped = nextPiped;
  };
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!;
    const two = command.slice(i, i + 2);
    if (quote === "'") {
      if (ch === "'") quote = null;
      cur += ch;
      continue;
    }
    // Dentro de comillas dobles las sustituciones siguen ejecutándose.
    if (two === '$(' || ch === '`') {
      flush(false);
      if (two === '$(') i++;
      continue;
    }
    if (quote === '"') {
      if (ch === '"') quote = null;
      cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
    } else if (two === '&&' || two === '||') {
      flush(false);
      i++;
    } else if (ch === '|') flush(true);
    else if (ch === ';' || ch === '&' || ch === '\n' || ch === '\r' || ch === ')') flush(false);
    else cur += ch;
  }
  flush(false);
  return out;
}

/** Destinos de `>` y `>>` en un tramo (sin `2>&1`). */
function redirectTargets(text: string): string[] {
  const out: string[] = [];
  const re = /\d?>>?\s*(&?)("[^"]*"|'[^']*'|[^\s]+)/g;
  for (let m = re.exec(text); m; m = re.exec(text)) if (!m[1]) out.push(m[2]!.replace(/^['"]|['"]$/g, ''));
  return out;
}

/**
 * Motivo por el que un comando es delicado, o `null` [R47.5]. Por dentro reconoce muchas formas de lo mismo
 * (`rm`, `Remove-Item`, `find -delete`, `$(rm …)`, `bash -c "rm …"`), pero solo hay tres motivos: borrar, salir de
 * la carpeta del proyecto (administrador, sistema, otros procesos, código que no se puede revisar) y publicar
 * fuera. En la duda, es delicado.
 */
export function sensitiveCommand(command: string, root: string, cwd: string = root, depth = 0): Danger | null {
  if (depth > 3) return DANGER.outside;
  const text = command.trim();
  if (!text) return null;
  let at = path.resolve(cwd);
  for (const seg of segmentsOf(text)) {
    for (const target of redirectTargets(seg.text)) {
      if (escapes(root, at, target)) return DANGER.outside;
      if (target.replace(/\\/g, '/').split('/').some((p) => protectedName(p))) return DANGER.outside;
    }
    const plain = seg.text.replace(/\d?>>?\s*&?("[^"]*"|'[^']*'|[^\s]+)/g, ' ').replace(/</g, ' ');
    const words = tokenize(plain) ?? plain.split(/\s+/).filter(Boolean);
    // Saltar asignaciones de entorno (`FOO=1 npm test`).
    while (words.length > 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0]!)) words.shift();
    if (words.length === 0) continue;
    const prog = programOf(words[0]!);
    const args = words.slice(1);
    const reason = SENSITIVE_PROGRAMS[prog];
    if (reason) return reason;
    // Código en línea y subidas: también en automático [R89.1][R89.2].
    if ((INLINE_CODE[prog] ?? []).some((flag) => args.some((a) => a === flag || a.startsWith(`${flag}=`)))) return DANGER.code;
    if (prog === 'deno' && args[0] === 'eval') return DANGER.code;
    if (uploads(prog, args)) return DANGER.publish;
    // Nada que nombre .orquestador, el estado de la app [R89.3].
    if (args.some((a) => a.replace(/\\/g, '/').split('/').some((s) => protectedName(s) && s.toLowerCase().startsWith('.orq')))) return DANGER.outside;
    if (seg.piped && (SHELLS.has(prog) || ['python', 'python3', 'node', 'perl', 'ruby'].includes(prog))) return DANGER.outside;
    if (SHELLS.has(prog) && args.some((a) => /^-(e|enc|encodedcommand)$/i.test(a) && prog !== 'bash' && prog !== 'sh')) return DANGER.outside;
    if (SHELLS.has(prog)) {
      const i = args.findIndex((a) => SHELL_INLINE.has(a.toLowerCase()));
      if (i >= 0) {
        const inner = sensitiveCommand(args.slice(i + 1).join(' '), root, at, depth + 1);
        if (inner) return inner;
        continue;
      }
    }
    if (prog === 'xargs') {
      const inner = args.findIndex((a) => !a.startsWith('-'));
      if (inner >= 0) {
        const r = sensitiveCommand(args.slice(inner).join(' '), root, at, depth + 1);
        if (r) return r;
      }
      continue;
    }
    if (prog === 'find') {
      if (args.some((a) => /^-(delete|fprint.*|fls)$/.test(a))) return DANGER.delete;
      const i = args.findIndex((a) => /^-(exec|execdir|ok|okdir)$/.test(a));
      if (i >= 0) {
        const r = sensitiveCommand(args.slice(i + 1).filter((a) => a !== '{}' && a !== '+').join(' '), root, at, depth + 1);
        if (r) return r;
      }
    }
    if (prog === 'git') {
      const sub = args.find((a) => !a.startsWith('-'));
      if (args.some((a) => a === '-C' || a.startsWith('--git-dir') || a.startsWith('--work-tree'))) return DANGER.outside;
      if (sub && GIT_SENSITIVE.has(sub)) return sub === 'push' ? DANGER.publish : DANGER.delete;
      if (sub === 'reset' && args.includes('--hard')) return DANGER.delete;
      if (sub === 'checkout' && (args.includes('--') || args.includes('.') || args.includes('-f') || args.includes('--force'))) return DANGER.delete;
      if ((sub === 'branch' || sub === 'tag') && args.some((a) => ['-d', '-D', '--delete'].includes(a))) return DANGER.delete;
      if (sub === 'stash' && args.some((a) => a === 'drop' || a === 'clear')) return DANGER.delete;
      if (sub === 'config' && args.includes('--global')) return DANGER.outside;
    }
    if (PACKAGE_MANAGERS.has(prog) && args.some((a) => PUBLISH.has(a))) return DANGER.publish;
    if (PACKAGE_MANAGERS.has(prog) && args.some((a) => a === '-g' || a === '--global')) return DANGER.outside;
    if ((prog === 'pip' || prog === 'pip3') && args.includes('uninstall')) return DANGER.outside;
    if (prog === 'cd' && args[0]) {
      if (escapes(root, at, args[0]) || args[0] === '..' && path.relative(path.resolve(root), path.resolve(at, '..')).startsWith('..')) return DANGER.outside;
      at = path.resolve(at, nativePath(args[0]));
      continue;
    }
    if (args.some((a) => escapes(root, at, a))) return DANGER.outside;
  }
  return null;
}

/** Subcomandos de git que cambian el historial, las ramas o el remoto [R73.9]. */
const GIT_WRITES = new Set(['commit', 'checkout', 'switch', 'merge', 'rebase', 'reset', 'stash', 'push', 'pull', 'tag', 'cherry-pick', 'revert', 'am', 'apply', 'restore', 'worktree', 'clean', 'rm', 'mv', 'add']);
/** Opciones globales de git que llevan un valor detrás. */
const GIT_GLOBAL_WITH_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace']);
const WRAPPERS = new Set(['sudo', 'env', 'time', 'nice', 'command', 'nohup', 'xargs']);

/**
 * ¿Escribe en git este comando? Busca `git` en cada tramo (también tras `;`, `|`, `&&` o en `$(...)`), salta sus
 * opciones globales y mira el subcomando; `branch` solo cuenta si crea, borra o mueve [R73.9].
 */
export function writesGit(command: string): boolean {
  const pieces = command.split(/&&|\|\||[;|&\n`]|\$\(|\)/);
  for (const piece of pieces) {
    const words = tokenize(piece.trim()) ?? piece.trim().split(/\s+/);
    // El programa del tramo: tras las variables (A=1) y los envoltorios (sudo, env, time…).
    let i = 0;
    while (i < words.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i]!) || WRAPPERS.has(programOf(words[i]!)))) i++;
    {
      if (i >= words.length || programOf(words[i]!) !== 'git') continue;
      let j = i + 1;
      while (j < words.length && words[j]!.startsWith('-')) j += GIT_GLOBAL_WITH_VALUE.has(words[j]!) ? 2 : 1;
      const sub = words[j];
      if (!sub) continue;
      if (GIT_WRITES.has(sub)) return true;
      if (sub === 'branch') {
        const rest = words.slice(j + 1);
        if (rest.some((a) => GIT_BRANCH_CHANGE.has(a) || a.startsWith('--set-upstream') || !a.startsWith('-'))) return true;
      }
    }
  }
  return false;
}

/** Motivo al denegar git en una rama en paralelo [R73.9]. */
export const ISOLATED_GIT_DENY = 'En una rama en paralelo no se cambia git: el commit se hace después de juntar las ramas.';

/** Procesos de los que depende la app: matarlos por nombre la cierra [R79.1]. */
const APP_PROCESS = /^(electron|node|claude|orquestador)(\.exe)?$/i;

/**
 * ¿Mata por nombre un proceso de la app? `taskkill /IM`, `killall`, `pkill`, `Stop-Process -Name`,
 * `Get-Process <nombre> | Stop-Process` y `wmic … delete`, en cualquier tramo del comando [R79.1].
 */
export function killsAppProcess(command: string): boolean {
  const unquote = (s: string) => s.replace(/^['"]|['"]$/g, '');
  const names = (s: string) => unquote(s).split(',').some((n) => APP_PROCESS.test(n.trim()));
  // Get-Process electron | Stop-Process: el nombre va en el tramo de antes.
  if (/stop-process/i.test(command)) {
    const get = /get-process\s+(?:-name\s+)?(['"]?[\w.,-]+['"]?)/i.exec(command);
    if (get && names(get[1]!)) return true;
  }
  if (/wmic\b[^;&|]*process\b[^;&|]*name\s*=\s*['"]?([\w.-]+)['"]?[^;&|]*\b(delete|terminate)\b/i.test(command)) {
    const m = /name\s*=\s*['"]?([\w.-]+)/i.exec(command);
    if (m && names(m[1]!)) return true;
  }
  for (const piece of command.split(/&&|\|\||[;|&\n`]|\$\(|\)/)) {
    const words = tokenize(piece.trim()) ?? piece.trim().split(/\s+/);
    // Un comando entre comillas (powershell -Command "…", bash -c '…') se mira por dentro.
    if (words.some((w) => /\s/.test(w) && killsAppProcess(w))) return true;
    let i = 0;
    while (i < words.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i]!) || WRAPPERS.has(programOf(words[i]!)) || words[i] === 'timeout' || /^\d+$/.test(words[i]!))) i++;
    const prog = words[i] ? programOf(words[i]!).toLowerCase() : '';
    const args = words.slice(i + 1);
    if (prog === 'taskkill' || prog === 'taskkill.exe') {
      for (let j = 0; j < args.length - 1; j++) if (/^(\/\/?|-)im$/i.test(args[j]!) && names(args[j + 1]!)) return true;
    }
    if (prog === 'killall' || prog === 'pkill') {
      if (args.filter((a) => !a.startsWith('-')).some((a) => names(a) || (prog === 'pkill' && /(^|[/\s])(electron|claude|orquestador)/i.test(unquote(a))))) return true;
    }
    if (prog === 'stop-process' || prog === 'spps') {
      for (let j = 0; j < args.length - 1; j++) if (/^-(name|processname)$/i.test(args[j]!) && names(args[j + 1]!)) return true;
    }
  }
  return false;
}

/** Motivo al denegarlo [R79.2]. */
export const APP_KILL_DENY = 'Ese comando cerraría todos los procesos con ese nombre, y con ellos el Orquestador y esta ejecución. Cierra solo lo que lanzaste, por su PID (taskkill /PID <pid> /T /F o kill <pid>).';
