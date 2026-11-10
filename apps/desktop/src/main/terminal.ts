import { TERMINAL_LIMITS, type TerminalEvent, type TerminalStartRequest } from '@orquestador/editor';

/** Lo mínimo de un pseudoterminal (node-pty) que usa la app. */
export interface PtyLike {
  onData(cb: (data: string) => void): unknown;
  onExit(cb: (e: { exitCode: number }) => void): unknown;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}
export type SpawnPty = (file: string, args: string[], opts: { name: string; cwd: string; cols: number; rows: number; env: Record<string, string> }) => PtyLike;
/** Abre la terminal del sistema con un programa (alternativa si no hay pseudoterminal) [R30.14]. */
export type OpenExternal = (cmd: { file: string; args: string[]; cwd: string; env: Record<string, string>; verbatim?: boolean }) => Promise<void>;

export interface TerminalDeps {
  /** Carga node-pty; si falla, se usa la terminal del sistema [R30.14]. */
  loadPty(): Promise<SpawnPty>;
  openExternal: OpenExternal;
  push(id: string, event: TerminalEvent): void;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  /** Agrupa la salida para no saturar el IPC (ms). */
  flushMs?: number;
}

/** Texto seguro para pasarlo dentro de comillas en `cmd.exe`: sin comillas, `%` ni saltos de línea. */
export const cmdSafe = (s: string) => s.replace(/["%\r\n]+/g, ' ').trim();

/**
 * El entorno con la carpeta del `claude` del paquete al final del `PATH`: el que tenga instalado el usuario sigue
 * teniendo preferencia [R91.17]. En Windows la variable puede llamarse `Path`.
 */
export function withClaudeOnPath(env: NodeJS.ProcessEnv, claudeDir: string | undefined, platform: NodeJS.Platform): NodeJS.ProcessEnv {
  if (!claudeDir) return env;
  const key = Object.keys(env).find((k) => (platform === 'win32' ? k.toUpperCase() === 'PATH' : k === 'PATH')) ?? 'PATH';
  const sep = platform === 'win32' ? ';' : ':';
  const parts = (env[key] ?? '').split(sep).filter(Boolean);
  if (parts.includes(claudeDir)) return env;
  return { ...env, [key]: [...parts, claudeDir].join(sep) };
}

/** Terminales de Linux, en el orden en que se prueban, con cómo recibe cada una el programa [R91.12]. */
export function linuxTerminals(cmd: { file: string; args: string[] }, env: NodeJS.ProcessEnv): { file: string; args: string[] }[] {
  const run = [cmd.file, ...cmd.args];
  const custom = env.TERMINAL?.trim();
  return [
    ...(custom ? [{ file: custom, args: ['-e', ...run] }] : []),
    { file: 'x-terminal-emulator', args: ['-e', ...run] },
    { file: 'gnome-terminal', args: ['--', ...run] },
    { file: 'konsole', args: ['-e', ...run] },
    { file: 'xfce4-terminal', args: ['-x', ...run] },
    { file: 'xterm', args: ['-e', ...run] },
  ];
}

/** La primera que arranca; si ninguna, el último error [R91.12]. */
export async function firstThatStarts<T>(candidates: readonly T[], start: (c: T) => Promise<void>): Promise<void> {
  let last: unknown = new Error('Sin terminales');
  for (const c of candidates) {
    try {
      return await start(c);
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

/** Texto entre comillas simples para la shell. */
const shQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** En macOS, Terminal.app ejecuta la orden en la carpeta del proyecto [R91.12]. */
export function macTerminal(cmd: { file: string; args: string[] }, cwd: string, env: Record<string, string>) {
  const line = `cd ${shQuote(cwd)} && ${[cmd.file, ...cmd.args].map(shQuote).join(' ')}`;
  const script = line.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return { file: 'osascript', args: ['-e', `tell application "Terminal" to do script "${script}"`, '-e', 'tell application "Terminal" to activate'], cwd, env };
}

/**
 * Programa y argumentos de cada terminal. Solo `claude` o la consola: la interfaz nunca da comandos ni rutas [R30.13].
 * En Windows `claude` se lanza desde `cmd.exe` (para encontrar `claude.cmd` o `claude.exe`) con la petición en una
 * variable de entorno; en Linux se lanza directamente con la petición como argumento (sin consola de por medio).
 */
export function commandFor(req: Pick<TerminalStartRequest, 'program' | 'prompt'>, platform: NodeJS.Platform, env: NodeJS.ProcessEnv): { file: string; args: string[]; env: Record<string, string> } {
  const prompt = req.prompt?.trim() ?? '';
  const win = platform === 'win32';
  if (req.program === 'shell') return win ? { file: 'powershell.exe', args: ['-NoLogo'], env: {} } : { file: env.SHELL || 'bash', args: ['-l'], env: {} };
  if (win) return { file: 'cmd.exe', args: ['/d', '/k', prompt ? 'claude "%ORQ_PROMPT%"' : 'claude'], env: prompt ? { ORQ_PROMPT: cmdSafe(prompt) } : {} };
  return { file: 'claude', args: prompt ? [prompt] : [], env: {} };
}

/** Terminales integradas del proyecto abierto [R30.13][R30.14]. */
export class TerminalService {
  private readonly terms = new Map<string, { pty: PtyLike; buf: string; timer: ReturnType<typeof setTimeout> | undefined }>();
  private seq = 0;
  private spawn: Promise<SpawnPty | undefined> | undefined;

  constructor(private readonly deps: TerminalDeps) {}

  get count(): number {
    return this.terms.size;
  }

  async start(cwd: string, req: TerminalStartRequest): Promise<{ id: string; external: boolean }> {
    if (this.terms.size >= TERMINAL_LIMITS.max) throw new TerminalError('limit', `Como mucho ${TERMINAL_LIMITS.max} terminales abiertas: cierra alguna`);
    const platform = this.deps.platform ?? process.platform;
    const baseEnv = this.deps.env ?? process.env;
    const cmd = commandFor(req, platform, baseEnv);
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(baseEnv)) if (typeof v === 'string') env[k] = v;
    Object.assign(env, { TERM: 'xterm-256color', COLORTERM: 'truecolor' }, cmd.env);
    this.spawn ??= this.deps.loadPty().catch(() => undefined);
    const spawn = await this.spawn;
    let pty: PtyLike | undefined;
    if (spawn) {
      try {
        pty = spawn(cmd.file, cmd.args, { name: 'xterm-256color', cwd, cols: req.cols, rows: req.rows, env });
      } catch {
        pty = undefined;
      }
    }
    const id = `term-${++this.seq}`;
    if (!pty) {
      await this.openExternal(cmd, cwd, env, platform);
      return { id, external: true };
    }
    const entry = { pty, buf: '', timer: undefined as ReturnType<typeof setTimeout> | undefined };
    this.terms.set(id, entry);
    const flush = () => {
      entry.timer = undefined;
      if (entry.buf) this.deps.push(id, { type: 'data', data: entry.buf });
      entry.buf = '';
    };
    pty.onData((d) => {
      entry.buf += d;
      entry.timer ??= setTimeout(flush, this.deps.flushMs ?? 12);
    });
    pty.onExit(({ exitCode }) => {
      if (entry.timer) clearTimeout(entry.timer);
      flush();
      this.terms.delete(id);
      this.deps.push(id, { type: 'exit', code: exitCode });
    });
    return { id, external: false };
  }

  private async openExternal(cmd: { file: string; args: string[] }, cwd: string, env: Record<string, string>, platform: NodeJS.Platform): Promise<void> {
    try {
      if (platform === 'win32') {
        // `start` abre una ventana nueva de consola con el mismo programa [R30.14]
        const inner = cmd.file === 'cmd.exe' ? `cmd.exe /d /k ${cmd.args[2]}` : `${cmd.file} ${cmd.args.join(' ')}`;
        await this.deps.openExternal({ file: 'cmd.exe', args: [`/d /c start "Orquestador" ${inner}`], cwd, env, verbatim: true });
      } else if (platform === 'darwin') {
        await this.deps.openExternal(macTerminal(cmd, cwd, env));
      } else {
        await firstThatStarts(linuxTerminals(cmd, this.deps.env ?? process.env), (c) => this.deps.openExternal({ ...c, cwd, env }));
      }
    } catch {
      throw new TerminalError('unavailable', 'No se pudo abrir ninguna terminal en este equipo');
    }
  }

  write(id: string, data: string): boolean {
    const t = this.terms.get(id);
    if (!t) return false;
    t.pty.write(data);
    return true;
  }

  resize(id: string, cols: number, rows: number): boolean {
    const t = this.terms.get(id);
    if (!t) return false;
    try {
      t.pty.resize(cols, rows);
    } catch {
      // el proceso pudo terminar justo ahora
    }
    return true;
  }

  kill(id: string): boolean {
    const t = this.terms.get(id);
    if (!t) return false;
    if (t.timer) clearTimeout(t.timer);
    this.terms.delete(id);
    try {
      t.pty.kill();
    } catch {
      // ya había terminado
    }
    return true;
  }

  /** Al cambiar de proyecto o salir se cierran todas [R30.13]. */
  killAll(): void {
    for (const id of [...this.terms.keys()]) this.kill(id);
  }
}

export class TerminalError extends Error {
  constructor(
    readonly code: 'limit' | 'unavailable',
    message: string,
  ) {
    super(message);
  }
}
