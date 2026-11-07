import { promises as fs, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { atomicWrite, atomicWriteSync } from '../src';

const busy = (code: string) => Object.assign(new Error(code), { code });

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'orq-busy-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('SPEC-056 · escrituras con lectores a la vez', () => {
  it('[R56.21] la escritura síncrona no se pierde aunque se lea el archivo sin parar', async () => {
    const file = join(dir, 'meta.json');
    writeFileSync(file, '0');
    let stop = false;
    const readers = Array.from({ length: 4 }, async () => {
      while (!stop) await fs.readFile(file, 'utf8').catch(() => '');
    });
    for (let i = 1; i <= 50; i++) {
      atomicWriteSync(file, String(i));
      await new Promise((r) => setImmediate(r));
    }
    stop = true;
    await Promise.all(readers);
    expect(readFileSync(file, 'utf8')).toBe('50');
    expect((await fs.readdir(dir)).filter((n) => n.includes('.tmp-'))).toEqual([]);
  });

  it('[R56.21] la escritura asíncrona reintenta si el archivo está ocupado', async () => {
    const file = join(dir, 'a.json');
    let calls = 0;
    await atomicWrite(file, 'x', {
      rename: async (from, to) => {
        if (++calls < 3) throw busy('EPERM');
        await fs.rename(from, to);
      },
    });
    expect(calls).toBe(3);
    expect(readFileSync(file, 'utf8')).toBe('x');
  });

  it('[R56.21] si sigue ocupado, escribe encima y no deja temporales', async () => {
    const file = join(dir, 'a.json');
    writeFileSync(file, 'viejo');
    await atomicWrite(file, 'nuevo', {
      rename: async () => {
        throw busy('EBUSY');
      },
    });
    expect(readFileSync(file, 'utf8')).toBe('nuevo');
    expect(await fs.readdir(dir)).toEqual(['a.json']);
  });

  it('[R56.21] cualquier otro error sigue fallando y el original queda intacto', async () => {
    const file = join(dir, 'a.json');
    writeFileSync(file, 'viejo');
    const failing = atomicWrite(file, 'nuevo', {
      rename: async () => {
        throw busy('ENOSPC');
      },
    });
    await expect(failing).rejects.toThrow('ENOSPC');
    expect(readFileSync(file, 'utf8')).toBe('viejo');
    expect(await fs.readdir(dir)).toEqual(['a.json']);
  });
});
