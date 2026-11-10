/**
 * Comandos que preguntan también en «Automático» por lo que hacen sus argumentos: código en línea de intérpretes y
 * subidas a otro equipo [R89.1][R89.2].
 */

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
