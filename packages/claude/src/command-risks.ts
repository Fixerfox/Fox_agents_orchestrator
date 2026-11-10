/**
 * Comandos que preguntan también en «Automático» por lo que hacen sus argumentos: código en línea de intérpretes y
 * subidas a otro equipo [R89.1][R89.2].
 */
import { programOf, segmentsOf, tokenize } from './shell-words';

/** Intérpretes y la opción que les pasa código en línea [R89.1]. */
export const INLINE_CODE: Record<string, readonly string[]> = {
  node: ['-e', '--eval', '-p', '--print'],
  bun: ['-e', '--eval', '-p', '--print'],
  python: ['-c'],
  python3: ['-c'],
  py: ['-c'],
  perl: ['-e', '-E'],
  ruby: ['-e'],
  php: ['-r'],
};

/** ¿Pasa el comando código en línea a su intérprete? [R89.1] */
export function runsInlineCode(prog: string, args: readonly string[]): boolean {
  if (prog === 'deno' && args[0] === 'eval') return true;
  return (INLINE_CODE[prog] ?? []).some((flag) => args.some((a) => a === flag || a.startsWith(`${flag}=`)));
}

/** Programas que mandan datos a otro equipo [R89.2]. */
const UPLOADERS = new Set(['scp', 'sftp', 'ftp', 'nc', 'ncat', 'netcat']);
const CURL_UPLOAD = /^(-T|--upload-file|-d|--data(-[a-z]+)?|-F|--form(-string)?)(=|$)/;
const WGET_UPLOAD = /^--(post-data|post-file|body-data|body-file|method)(=|$)/;

/** ¿Sube datos fuera del equipo? [R89.2] */
export function uploads(prog: string, args: readonly string[]): boolean {
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

/**
 * Intérprete al que el comando pasa código en línea, para «Permitir código en línea de «node» en esta ejecución»:
 * así no se pregunta cada comprobación rápida [R89.11].
 */
export function inlineInterpreter(command: string): string | null {
  for (const seg of segmentsOf(command.trim())) {
    const words = tokenize(seg.text) ?? seg.text.split(/\s+/).filter(Boolean);
    while (words.length > 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0]!)) words.shift();
    if (words.length === 0) continue;
    const prog = programOf(words[0]!);
    const args = words.slice(1);
    if (runsInlineCode(prog, args)) return prog;
  }
  return null;
}

/** Subcomandos de git que pueden ejecutar `textconv` o un `diff.external` del repositorio [R90.2]. */
const GIT_DIFFING = /(^|[\s;&|(`])(git(?:\.exe)?)(\s+)(diff|show|log|blame)\b(?!\s+--no-textconv --no-ext-diff)/gi;

/**
 * En «Solo lectura», git sin programas del repositorio [R90.2]: cada `git diff|show|log|blame` del comando, también
 * encadenado, lleva `--no-textconv --no-ext-diff` justo tras el subcomando.
 */
export function hardenReadOnlyGit(command: string): string {
  return command.replace(GIT_DIFFING, (_m, pre: string, git: string, sp: string, sub: string) => `${pre}${git}${sp}${sub} --no-textconv --no-ext-diff`);
}
