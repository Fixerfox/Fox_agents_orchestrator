import { describe, expect, it, vi } from 'vitest';
import type { TerminalEvent } from '@orquestador/editor';
import { cmdSafe, commandFor, TerminalService, type PtyLike, type SpawnPty } from '../src/main/terminal';

function fakePty() {
  let data: (d: string) => void = () => {};
  let exit: (e: { exitCode: number }) => void = () => {};
  const pty: PtyLike & { emit(d: string): void; end(code: number): void; written: string[]; killed: boolean } = {
    written: [],
    killed: false,
    onData: (cb) => void (data = cb),
    onExit: (cb) => void (exit = cb),
    write(d) {
      this.written.push(d);
    },
    resize: vi.fn(),
    kill() {
      this.killed = true;
    },
    emit: (d) => data(d),
    end: (code) => exit({ exitCode: code }),
  };
  return pty;
}

describe('SPEC-030 · terminal integrada (proceso principal)', () => {
  it('[R30.13] solo lanza `claude` o la consola; la petición va como argumento, nunca por una consola intermedia en Linux', () => {
    expect(commandFor({ program: 'claude', prompt: 'Da de alta el MCP de GitHub' }, 'linux', {})).toEqual({ file: 'claude', args: ['Da de alta el MCP de GitHub'], env: {} });
    expect(commandFor({ program: 'claude' }, 'linux', {})).toEqual({ file: 'claude', args: [], env: {} });
    expect(commandFor({ program: 'shell' }, 'linux', { SHELL: '/bin/zsh' }).file).toBe('/bin/zsh');
    // En Windows la petición viaja en una variable y se limpia de comillas, % y saltos de línea
    const win = commandFor({ program: 'claude', prompt: 'hola "x" & %PATH%\ndel *' }, 'win32', {});
    expect(win.file).toBe('cmd.exe');
    expect(win.args).toEqual(['/d', '/k', 'claude "%ORQ_PROMPT%"']);
    expect(win.env.ORQ_PROMPT).toBe('hola  x  &  PATH del *');
    expect(cmdSafe('a"b%c\r\nd')).toBe('a b c d');
    expect(commandFor({ program: 'shell' }, 'win32', {}).file).toBe('powershell.exe');
  });

  it('[R30.13] arranca en la carpeta dada, agrupa la salida, escribe, cambia tamaño y se cierra; como mucho 3', async () => {
    const ptys: ReturnType<typeof fakePty>[] = [];
    const spawned: { file: string; cwd: string; env: Record<string, string> }[] = [];
    const spawn: SpawnPty = (file, _args, opts) => {
      spawned.push({ file, cwd: opts.cwd, env: opts.env });
      const p = fakePty();
      ptys.push(p);
      return p;
    };
    const events: { id: string; e: TerminalEvent }[] = [];
    const svc = new TerminalService({ loadPty: async () => spawn, openExternal: async () => undefined, push: (id, e) => events.push({ id, e }), platform: 'linux', env: { PATH: '/usr/bin' }, flushMs: 1 });
    const t1 = await svc.start('/proyecto', { program: 'claude', cols: 80, rows: 24 });
    expect(t1.external).toBe(false);
    expect(spawned[0]).toMatchObject({ file: 'claude', cwd: '/proyecto' });
    expect(spawned[0]!.env).toMatchObject({ PATH: '/usr/bin', TERM: 'xterm-256color' });
    ptys[0]!.emit('ho');
    ptys[0]!.emit('la');
    await new Promise((r) => setTimeout(r, 10));
    expect(events).toEqual([{ id: t1.id, e: { type: 'data', data: 'hola' } }]);
    expect(svc.write(t1.id, 'ls\r')).toBe(true);
    expect(ptys[0]!.written).toEqual(['ls\r']);
    expect(svc.resize(t1.id, 100, 30)).toBe(true);
    expect(ptys[0]!.resize).toHaveBeenCalledWith(100, 30);
    await svc.start('/proyecto', { program: 'shell', cols: 80, rows: 24 });
    await svc.start('/proyecto', { program: 'shell', cols: 80, rows: 24 });
    await expect(svc.start('/proyecto', { program: 'shell', cols: 80, rows: 24 })).rejects.toMatchObject({ code: 'limit' });
    // al terminar el proceso se avisa
    ptys[1]!.end(0);
    expect(events.at(-1)).toMatchObject({ e: { type: 'exit', code: 0 } });
    expect(svc.count).toBe(2);
    svc.killAll();
    expect(ptys[0]!.killed && ptys[2]!.killed).toBe(true);
    expect(svc.count).toBe(0);
    expect(svc.write(t1.id, 'x')).toBe(false);
  });

  it('[R30.14] si no hay pseudoterminal se abre la terminal del sistema con el mismo programa en la carpeta del proyecto', async () => {
    const opened: { file: string; args: string[]; cwd: string; verbatim?: boolean }[] = [];
    const svc = new TerminalService({ loadPty: async () => Promise.reject(new Error('sin node-pty')), openExternal: async (c) => void opened.push(c), push: () => {}, platform: 'linux', env: {} });
    expect((await svc.start('/proyecto', { program: 'claude', prompt: 'hola', cols: 80, rows: 24 })).external).toBe(true);
    expect(opened[0]).toMatchObject({ file: 'x-terminal-emulator', args: ['-e', 'claude', 'hola'], cwd: '/proyecto' });
    const win = new TerminalService({ loadPty: async () => () => { throw new Error('falla'); }, openExternal: async (c) => void opened.push(c), push: () => {}, platform: 'win32', env: {} });
    expect((await win.start('C:\\p', { program: 'claude', prompt: 'hola', cols: 80, rows: 24 })).external).toBe(true);
    expect(opened[1]).toMatchObject({ file: 'cmd.exe', args: ['/d /c start "Orquestador" cmd.exe /d /k claude "%ORQ_PROMPT%"'], verbatim: true });
    const none = new TerminalService({ loadPty: async () => Promise.reject(new Error('x')), openExternal: async () => Promise.reject(new Error('x')), push: () => {}, platform: 'linux', env: {} });
    await expect(none.start('/p', { program: 'shell', cols: 80, rows: 24 })).rejects.toMatchObject({ code: 'unavailable' });
  });
});
