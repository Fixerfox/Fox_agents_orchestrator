import { constants, promises as fs } from 'node:fs';
import { containsSecrets } from '@orquestador/core';
import { StoreError } from './errors';
import { atomicWrite } from './fs-util';
import { assertSafeId } from './paths';

type Doc = Record<string, unknown>;

export interface VersionedSpec {
  /** Qué tipo de documento es (para los mensajes de error). */
  kind: string;
  current: number;
  /** `migrations[n]` convierte un documento de la versión n a la n+1. */
  migrations?: Record<number, (doc: Doc) => Doc>;
}

export async function readVersioned<T>(
  file: string,
  spec: VersionedSpec,
): Promise<{ data: T; migratedFrom?: number }> {
  let text: string;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new StoreError('not-found', `No existe ${spec.kind}: ${file}`);
    }
    throw err;
  }
  let doc: Doc;
  try {
    doc = JSON.parse(text) as Doc;
  } catch {
    throw new StoreError('corrupt', `${spec.kind} corrupto (JSON inválido): ${file}`);
  }
  const from = doc && typeof doc === 'object' ? doc['schemaVersion'] : undefined;
  if (typeof from !== 'number' || !Number.isInteger(from) || from < 1) {
    throw new StoreError('corrupt', `${spec.kind} sin schemaVersion válida: ${file}`);
  }
  if (from > spec.current) {
    throw new StoreError(
      'future-version',
      `${spec.kind} creado con una versión más nueva (v${from}); esta app entiende hasta v${spec.current}: ${file}`,
    );
  }
  if (from === spec.current) return { data: doc as T };

  let migrated = doc;
  for (let v = from; v < spec.current; v++) {
    const step = spec.migrations?.[v];
    if (!step) throw new StoreError('corrupt', `No hay migración de v${v} a v${v + 1} para ${spec.kind}`);
    migrated = { ...step(migrated), schemaVersion: v + 1 };
  }
  try {
    await fs.copyFile(file, `${file}.v${from}.bak`, constants.COPYFILE_EXCL);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
  }
  await atomicWrite(file, `${JSON.stringify(migrated, null, 2)}\n`);
  return { data: migrated as T, migratedFrom: from };
}

export async function writeVersioned(file: string, doc: Doc, spec: VersionedSpec): Promise<void> {
  if (doc['schemaVersion'] !== spec.current) {
    throw new StoreError('corrupt', `${spec.kind}: schemaVersion debe ser ${spec.current} al guardar`);
  }
  if (containsSecrets(doc)) {
    throw new StoreError('secrets', `${spec.kind} contiene secretos (claves o tokens); no se guarda en disco`);
  }
  await atomicWrite(file, `${JSON.stringify(doc, null, 2)}\n`);
}

/** Colección de documentos `<dir>/<id>.json` con versión de esquema. */
export class JsonCollection<T extends { id: string; schemaVersion: number }> {
  constructor(
    readonly dir: string,
    readonly spec: VersionedSpec,
  ) {}

  file(id: string): string {
    return `${this.dir}/${assertSafeId(id)}.json`;
  }

  async save(item: T): Promise<void> {
    await writeVersioned(this.file(item.id), item as unknown as Doc, this.spec);
  }

  async load(id: string): Promise<T> {
    return (await readVersioned<T>(this.file(id), this.spec)).data;
  }

  async delete(id: string): Promise<boolean> {
    try {
      await fs.rm(this.file(id));
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw err;
    }
  }

  async exists(id: string): Promise<boolean> {
    try {
      await fs.access(this.file(id));
      return true;
    } catch {
      return false;
    }
  }

  async list(): Promise<string[]> {
    try {
      return (await fs.readdir(this.dir))
        .filter((f) => f.endsWith('.json'))
        .map((f) => f.slice(0, -'.json'.length))
        .sort();
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
  }
}
