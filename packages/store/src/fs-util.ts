import { promises as fs, renameSync, writeFileSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';

export interface FsOps {
  writeFile(path: string, data: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  rm(path: string): Promise<void>;
}

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
    await o.rename(tmp, file);
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
    renameSync(tmp, file);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}
