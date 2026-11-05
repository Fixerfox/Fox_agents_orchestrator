import { promises as fs } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { StoreError, assertSafeId, atomicWrite, resolveInside, toPosixRelative } from '../src';
import { cleanupTmp, tmp } from './helpers';

cleanupTmp();

describe('SPEC-010 · escritura atómica y rutas', () => {
  it('[R10.2] escribe de forma atómica y no deja temporales', async () => {
    const dir = await tmp();
    const file = path.join(dir, 'sub', 'a.json');
    await atomicWrite(file, 'uno');
    await atomicWrite(file, 'dos');
    expect(await fs.readFile(file, 'utf8')).toBe('dos');
    expect(await fs.readdir(path.dirname(file))).toEqual(['a.json']);
  });

  it('[R10.2] si falla el renombrado, el original queda intacto y se limpia el temporal', async () => {
    const dir = await tmp();
    const file = path.join(dir, 'a.json');
    await atomicWrite(file, 'viejo');
    await expect(
      atomicWrite(file, 'nuevo', {
        rename: async () => {
          throw new Error('disco lleno');
        },
      }),
    ).rejects.toThrow('disco lleno');
    expect(await fs.readFile(file, 'utf8')).toBe('viejo');
    expect(await fs.readdir(dir)).toEqual(['a.json']);
  });

  it('[R10.3] las rutas guardadas son relativas y con "/" en Windows y en Linux', () => {
    expect(
      toPosixRelative('D:\\Juego', 'D:\\Juego\\.orquestador\\runs\\r1\\events.jsonl', path.win32),
    ).toBe('.orquestador/runs/r1/events.jsonl');
    expect(toPosixRelative('/home/u/juego', '/home/u/juego/.orquestador/x.json', path.posix)).toBe(
      '.orquestador/x.json',
    );
    expect(resolveInside('D:\\Juego', 'output/a/b.txt', path.win32)).toBe('D:\\Juego\\output\\a\\b.txt');
    expect(resolveInside('/home/u/juego', 'output/a/b.txt', path.posix)).toBe('/home/u/juego/output/a/b.txt');
  });

  it('[R10.3] rechaza rutas que salen de la raíz o que son absolutas', () => {
    const code = (fn: () => unknown) => {
      try {
        fn();
      } catch (e) {
        return (e as StoreError).code;
      }
      return 'sin error';
    };
    expect(code(() => toPosixRelative('/p', '/otra/cosa', path.posix))).toBe('outside-root');
    expect(code(() => toPosixRelative('D:\\Juego', 'E:\\Otro\\a.txt', path.win32))).toBe('outside-root');
    expect(code(() => resolveInside('/p', '../fuera.txt', path.posix))).toBe('outside-root');
    expect(code(() => resolveInside('/p', 'a/../../fuera.txt', path.posix))).toBe('outside-root');
    expect(code(() => resolveInside('/p', '/etc/passwd', path.posix))).toBe('outside-root');
    expect(code(() => resolveInside('D:\\Juego', 'C:\\Windows\\x', path.win32))).toBe('outside-root');
  });

  it('[R10.8] solo acepta ids seguros para nombres de archivo', () => {
    for (const ok of ['diagrama-1', 'a.b_c', '3f2b1c0e-9a7d-4c1e-8b5a-0123456789ab', 'X']) {
      expect(assertSafeId(ok)).toBe(ok);
    }
    for (const bad of ['', '../x', 'a/b', 'a\\b', '.oculto', 'con espacio', 'a..b', 'x'.repeat(129), 'ñandú']) {
      expect(() => assertSafeId(bad), bad).toThrow(StoreError);
    }
  });
});
