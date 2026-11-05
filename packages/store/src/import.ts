import { promises as fs } from 'node:fs';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { IMPORT_LIMITS, isSafePackagePath, type SourceFile, type SourceTree } from '@orquestador/core';
import { StoreError } from './errors';

const tooBig = () => new StoreError('invalid', `El paquete es demasiado grande: máximo ${IMPORT_LIMITS.files} archivos, ${IMPORT_LIMITS.total / 1024 / 1024} MB en total y ${IMPORT_LIMITS.file / 1024 / 1024} MB por archivo`);

/** Lee una carpeta como árbol de archivos; rechaza enlaces simbólicos y paquetes demasiado grandes [R25.3]. */
export async function readFolder(dir: string): Promise<SourceTree> {
  const files: SourceFile[] = [];
  let total = 0;
  const walk = async (abs: string, rel: string): Promise<void> => {
    for (const e of await fs.readdir(abs, { withFileTypes: true })) {
      const r = rel === '' ? e.name : `${rel}/${e.name}`;
      if (e.name === '.git' || e.name === 'node_modules') continue;
      if (e.isSymbolicLink()) throw new StoreError('invalid', `El paquete contiene un enlace simbólico («${r}») y no se puede instalar`);
      if (e.isDirectory()) await walk(path.join(abs, e.name), r);
      else if (e.isFile()) {
        const size = (await fs.stat(path.join(abs, e.name))).size;
        total += size;
        if (files.length + 1 > IMPORT_LIMITS.files || size > IMPORT_LIMITS.file || total > IMPORT_LIMITS.total) throw tooBig();
        files.push({ path: r, data: new Uint8Array(await fs.readFile(path.join(abs, e.name))) });
      }
    }
  };
  await walk(dir, '');
  return { files };
}

/** Lee un Zip en memoria sin escribir nada; rechaza rutas peligrosas y tamaños excesivos [R25.3]. */
export function readZip(bytes: Uint8Array): SourceTree {
  if (bytes.length > IMPORT_LIMITS.total) throw tooBig();
  let count = 0;
  let total = 0;
  let out: Record<string, Uint8Array>;
  try {
    out = unzipSync(bytes, {
      filter(file) {
        if (file.name.endsWith('/')) return false;
        if (!isSafePackagePath(file.name)) throw new StoreError('invalid', 'El Zip contiene rutas no permitidas (absolutas o que salen de la carpeta) y no se puede instalar');
        count++;
        total += file.originalSize;
        if (count > IMPORT_LIMITS.files || file.originalSize > IMPORT_LIMITS.file || total > IMPORT_LIMITS.total) throw tooBig();
        return true;
      },
    });
  } catch (err) {
    if (err instanceof StoreError) throw err;
    throw new StoreError('invalid', 'El archivo no es un Zip válido');
  }
  const files = Object.entries(out).map(([p, data]) => ({ path: p.replace(/\\/g, '/'), data }));
  if (files.some((f) => f.data.length > IMPORT_LIMITS.file) || files.reduce((n, f) => n + f.data.length, 0) > IMPORT_LIMITS.total) throw tooBig();
  return { files };
}

/** Lee un Zip del disco comprobando antes su tamaño [R25.3]. */
export async function readZipFile(file: string): Promise<SourceTree> {
  if ((await fs.stat(file)).size > IMPORT_LIMITS.total) throw tooBig();
  return readZip(new Uint8Array(await fs.readFile(file)));
}

/** Lee archivos sueltos elegidos con el diálogo del sistema; rechaza enlaces simbólicos y tamaños excesivos [R24.10]. */
export async function readFiles(paths: readonly string[]): Promise<SourceTree> {
  const files: SourceFile[] = [];
  let total = 0;
  for (const abs of paths) {
    const st = await fs.lstat(abs);
    if (st.isSymbolicLink()) throw new StoreError('invalid', `«${path.basename(abs)}» es un enlace simbólico y no se puede añadir`);
    if (!st.isFile()) continue;
    total += st.size;
    if (files.length + 1 > IMPORT_LIMITS.files || st.size > IMPORT_LIMITS.file || total > IMPORT_LIMITS.total) throw tooBig();
    files.push({ path: path.basename(abs), data: new Uint8Array(await fs.readFile(abs)) });
  }
  return { files };
}

/** Lee una carpeta elegida y conserva su nombre como primer nivel [R24.9]. */
export async function readFolderNamed(dir: string): Promise<SourceTree> {
  const tree = await readFolder(dir);
  const name = path.basename(dir) || 'carpeta';
  return { files: tree.files.map((f) => ({ path: `${name}/${f.path}`, data: f.data })) };
}
