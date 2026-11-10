import { afterEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { platformPackages, resolveClaudeExecutable, setClaudeExecutable, unpacked, withExecutable, type ExecutableEnv } from '../src';

const SDK = '@anthropic-ai/claude-agent-sdk';

function env(over: Partial<ExecutableEnv> & { files?: string[]; modules?: Record<string, string> }): ExecutableEnv {
  const files = new Set(over.files ?? []);
  const modules = over.modules ?? {};
  return {
    platform: 'win32',
    arch: 'x64',
    packaged: false,
    resolve: (id) => {
      if (!(id in modules)) throw new Error(`Cannot find module ${id}`);
      return modules[id]!;
    },
    exists: (f) => files.has(f),
    ...over,
  };
}

describe('SPEC-091 · binario de Claude', () => {
  afterEach(() => setClaudeExecutable(undefined));

  it('[R91.6] usa el binario del paquete de plataforma del SDK', () => {
    const file = 'C:\\repo\\node_modules\\@anthropic-ai\\claude-agent-sdk-win32-x64\\claude.exe';
    expect(resolveClaudeExecutable(env({ modules: { [`${SDK}-win32-x64/claude.exe`]: file }, files: [file] }))).toBe(file);
  });

  it('[R91.6] empaquetada, lo busca en app.asar.unpacked y no dentro del asar', () => {
    const inside = '/opt/Orquestador/resources/app.asar/node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude';
    const outside = '/opt/Orquestador/resources/app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude';
    expect(unpacked(inside)).toBe(outside);
    expect(unpacked('C:\\App\\resources\\app.asar\\node_modules\\x\\claude.exe')).toBe('C:\\App\\resources\\app.asar.unpacked\\node_modules\\x\\claude.exe');
    const e = env({ platform: 'linux', packaged: true, modules: { [`${SDK}-linux-x64/claude`]: inside }, files: [outside] });
    expect(resolveClaudeExecutable(e)).toBe(outside);
    expect(resolveClaudeExecutable({ ...e, packaged: false })).toBeUndefined();
  });

  it('[R91.6] en Linux prueba también la variante musl, primero la que toca', () => {
    expect(platformPackages('linux', 'x64')).toEqual([`${SDK}-linux-x64`, `${SDK}-linux-x64-musl`]);
    expect(platformPackages('linux', 'arm64', true)).toEqual([`${SDK}-linux-arm64-musl`, `${SDK}-linux-arm64`]);
    expect(platformPackages('darwin', 'arm64')).toEqual([`${SDK}-darwin-arm64`]);
    const musl = '/n/@anthropic-ai/claude-agent-sdk-linux-x64-musl/claude';
    expect(resolveClaudeExecutable(env({ platform: 'linux', modules: { [`${SDK}-linux-x64-musl/claude`]: musl }, files: [musl] }))).toBe(musl);
  });

  it('[R91.6] sin el paquete, el claude del PATH (con PATHEXT en Windows); si no hay ninguno, sin ruta', () => {
    const win = path.join('C:\\Users\\u\\.local\\bin', 'claude.exe');
    expect(resolveClaudeExecutable(env({ envPath: 'C:\\Windows;C:\\Users\\u\\.local\\bin', pathExt: '.COM;.EXE', files: [win] }))).toBe(win);
    const nix = path.join('/home/u/.local/bin', 'claude');
    expect(resolveClaudeExecutable(env({ platform: 'darwin', arch: 'arm64', envPath: '/usr/bin:/home/u/.local/bin', files: [nix] }))).toBe(nix);
    expect(resolveClaudeExecutable(env({ envPath: 'C:\\Windows' }))).toBeUndefined();
  });

  it('[R91.7] las consultas llevan esa ruta salvo que se pase otra', () => {
    expect(withExecutable({ cwd: '/p' })).toEqual({ cwd: '/p' });
    setClaudeExecutable('/opt/claude');
    expect(withExecutable({ cwd: '/p' })).toEqual({ cwd: '/p', pathToClaudeCodeExecutable: '/opt/claude' });
    expect(withExecutable({ cwd: '/p', pathToClaudeCodeExecutable: '/otro' })).toEqual({ cwd: '/p', pathToClaudeCodeExecutable: '/otro' });
  });
});
