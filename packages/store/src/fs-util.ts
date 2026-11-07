import { promises as fs, renameSync, writeFileSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';

export interface FsOps {
  writeFile(path: string, data: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  rm(path: string): Promise<void>;
}

/** Códigos con los que Windows rechaza sustituir un archivo que alguien tiene abierto [R56.21]. */
const BUSY_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);
const isBusy = (err: unknown): boolean => BUSY_CODES.has((err as NodeJS.ErrnoException).code ?? '');
const RENAME_TRIES = 5;
const RENAME_WAIT_MS = 2;

const tmpName = (file: string) => `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;

const defaultOps: FsOps = {
  async writeFile(path, data) {
    const fh = await fs.open(path, 'w');
    try {
      await fh.writeFile(data, 'utf8');
      await fh.sync();
    } finally {
      await fh.close();
    }
  },
  rename: (from, to) => fs.rename(from, to),
  rm: (path) => fs.rm(path, { force: true }),
};

/** Escribe un archivo de forma atómica: temporal + renombrado. Si falla, el original queda intacto. */
export async function atomicWrite(file: string, data: string, ops: Partial<FsOps> = {}): Promise<void> {
  const o = { ...defaultOps, ...ops };
  await fs.mkdir(dirname(file), { recursive: true });
  const tmp = tmpName(file);
  try {
    await o.writeFile(tmp, data);
    for (let attempt = 1; ; attempt++) {
      try {
        await o.rename(tmp, file);
        return;
      } catch (err) {
        if (!isBusy(err)) throw err;
        if (attempt >= RENAME_TRIES) break;
        await new Promise((r) => setTimeout(r, RENAME_WAIT_MS));
      }
    }
    // Sigue ocupado: se escribe encima, porque perder el dato es peor que perder la atomicidad [R56.21].
    await o.writeFile(file, data);
    await o.rm(tmp);
  } catch (err) {
    await o.rm(tmp).catch(() => undefined);
    throw err;
  }
}

/** Variante síncrona (usada por el escritor de logs, que necesita orden estricto). */
export function atomicWriteSync(file: string, data: string): void {
  const tmp = tmpName(file);
  try {
    writeFileSync(tmp, data, 'utf8');
    for (let attempt = 1; ; attempt++) {
      try {
        renameSync(tmp, file);
        return;
      } catch (err) {
        if (!isBusy(err)) throw err;
        if (attempt >= RENAME_TRIES) break;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, RENAME_WAIT_MS);
      }
    }
    // Sigue ocupado: se escribe encima, porque perder el dato es peor que perder la atomicidad [R56.21].
    writeFileSync(file, data, 'utf8');
    rmSync(tmp, { force: true });
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}
