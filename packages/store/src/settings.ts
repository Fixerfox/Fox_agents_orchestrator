import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  SETTINGS_SCHEMA_VERSION,
  defaultSettings,
  normalizeSettings,
  validateSettings,
  type AppSettings,
} from '@orquestador/core';
import { StoreError } from './errors';
import { atomicWrite } from './fs-util';
import { readVersioned, writeVersioned, type VersionedSpec } from './versioned-json';

/**
 * v1 → v2: el nivel guardado pasa a «Sin preguntar nunca», que es el nuevo por defecto; desde v2 se respeta lo que
 * se elija [R51.1].
 */
export const settingsSpec: VersionedSpec = {
  kind: 'ajustes',
  current: SETTINGS_SCHEMA_VERSION,
  migrations: {
    1: (doc) => {
      const rest = { ...(doc as Record<string, unknown>) };
      delete rest['askCommands'];
      delete rest['autoWrite'];
      return { ...rest, permissions: 'full' };
    },
  },
};

/** Cifrado del sistema (Electron `safeStorage` en la app; un doble en los tests) [R23.3]. */
export interface SecretCipher {
  available(): boolean;
  encrypt(plain: string): Buffer;
  decrypt(data: Buffer): string;
}

export const MAX_API_KEY = 500;

/** Ajustes globales de la app [R23.1][R23.2]. */
export class SettingsStore {
  /** Se cargó desde un archivo dañado: «Preguntar» hasta que se guarden los ajustes [R89.5]. */
  recovered = false;

  constructor(readonly dir: string) {}

  get file(): string {
    return path.join(this.dir, 'settings.json');
  }

  /**
   * Lee los ajustes; si no existen, los de por defecto [R23.1]. Si están dañados, guarda una copia del archivo y usa los
   * de por defecto con «Preguntar»: un archivo roto no da más permisos de los elegidos [R89.5].
   */
  async load(): Promise<AppSettings> {
    try {
      return normalizeSettings((await readVersioned<AppSettings>(this.file, settingsSpec)).data);
    } catch (err) {
      if (err instanceof StoreError && err.code === 'not-found') return defaultSettings();
      if (err instanceof StoreError && err.code === 'corrupt') {
        // El archivo dañado se queda donde está hasta que se guarden los ajustes: cada arranque vuelve a «Preguntar».
        if (!this.recovered) await fs.copyFile(this.file, `${this.file}.danado`).catch(() => undefined);
        this.recovered = true;
        return { ...defaultSettings(), permissions: 'ask' };
      }
      throw err;
    }
  }

  async save(settings: AppSettings): Promise<AppSettings> {
    const problems = validateSettings(settings);
    if (problems.length > 0) throw new StoreError('invalid', problems[0]!.message, problems);
    const clean = normalizeSettings(settings);
    await writeVersioned(this.file, clean as unknown as Record<string, unknown>, settingsSpec);
    this.recovered = false;
    return clean;
  }
}

/** Clave API cifrada en un archivo propio; nunca se lee fuera de este módulo [R23.3]. */
export class ApiKeyVault {
  constructor(
    readonly dir: string,
    private readonly cipher: SecretCipher,
  ) {}

  get file(): string {
    return path.join(this.dir, 'api-key.bin');
  }

  async has(): Promise<boolean> {
    try {
      await fs.access(this.file);
      return true;
    } catch {
      return false;
    }
  }

  async set(key: string): Promise<void> {
    const text = typeof key === 'string' ? key : '';
    if (text.length === 0) throw new StoreError('invalid', 'Escribe la clave', [{ field: 'apiKey', message: 'Escribe la clave' }]);
    if (/\s/.test(text)) throw new StoreError('invalid', 'La clave no puede llevar espacios', [{ field: 'apiKey', message: 'La clave no puede llevar espacios' }]);
    if (text.length > MAX_API_KEY) throw new StoreError('invalid', `La clave es demasiado larga (máximo ${MAX_API_KEY})`, [{ field: 'apiKey', message: `La clave es demasiado larga (máximo ${MAX_API_KEY})` }]);
    if (!this.cipher.available()) throw new StoreError('unavailable', 'Este sistema no ofrece almacenamiento cifrado: la clave no se guarda');
    await atomicWrite(this.file, this.cipher.encrypt(text).toString('base64'));
  }

  async clear(): Promise<boolean> {
    try {
      await fs.rm(this.file);
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw err;
    }
  }

  /** Solo para el proceso principal, al crear el adaptador de Claude. Nunca se envía al renderer. */
  async read(): Promise<string | undefined> {
    if (!(await this.has())) return undefined;
    if (!this.cipher.available()) throw new StoreError('unavailable', 'No se puede descifrar la clave en este sistema');
    return this.cipher.decrypt(Buffer.from(await fs.readFile(this.file, 'utf8'), 'base64'));
  }
}

/**
 * Secretos de los servidores MCP (variables de entorno o cabeceras), cifrados con el almacén del sistema en un solo
 * archivo de la configuración de la app. La clave de cada servidor es `<proyecto>:<id>`. Los valores solo los lee
 * el proceso principal al lanzar un agente; la interfaz solo ve qué nombres tienen valor [R30.1][R30.8].
 */
/** Motivo al guardar o quitar un secreto cuando los guardados no se pueden leer [R89.7]. */
export const MCP_SECRETS_UNREADABLE =
  'No se pueden leer los secretos guardados (quizá cambió el llavero del sistema): no se cambia nada para no perder los demás. Restaura mcp-secrets.bin.bak o borra el archivo para empezar de cero.';

export class McpSecretVault {
  /** Las escrituras van una detrás de otra para no perder ninguna [R89.8]. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    readonly dir: string,
    private readonly cipher: SecretCipher,
  ) {}

  /** Lectura que no falla: con secretos ilegibles, vacía [R89.7]. */
  private async lenient(): Promise<Record<string, Record<string, string>>> {
    try {
      return await this.all();
    } catch (err) {
      if (err instanceof StoreError && err.code === 'corrupt') return {};
      throw err;
    }
  }

  /** Cambia los secretos en fila, sobre lo guardado de verdad [R89.7][R89.8]. */
  private change(fn: (data: Record<string, Record<string, string>>) => boolean): Promise<void> {
    const run = this.queue.then(async () => {
      const data = await this.all();
      if (fn(data)) await this.write(data);
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  get file(): string {
    return path.join(this.dir, 'mcp-secrets.bin');
  }

  private async all(): Promise<Record<string, Record<string, string>>> {
    let raw: string;
    try {
      raw = await fs.readFile(this.file, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw err;
    }
    if (!this.cipher.available()) throw new StoreError('unavailable', 'No se pueden descifrar los secretos en este sistema');
    let v: unknown;
    try {
      v = JSON.parse(this.cipher.decrypt(Buffer.from(raw, 'base64')));
    } catch {
      throw new StoreError('corrupt', MCP_SECRETS_UNREADABLE);
    }
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new StoreError('corrupt', MCP_SECRETS_UNREADABLE);
    return v as Record<string, Record<string, string>>;
  }

  private async write(data: Record<string, Record<string, string>>): Promise<void> {
    if (!this.cipher.available()) throw new StoreError('unavailable', 'Este sistema no ofrece almacenamiento cifrado: el secreto no se guarda');
    // Copia de lo anterior antes de escribir [R89.8].
    await fs.copyFile(this.file, `${this.file}.bak`).catch(() => undefined);
    await atomicWrite(this.file, this.cipher.encrypt(JSON.stringify(data)).toString('base64'));
  }

  /** Nombres con valor guardado (nunca los valores). */
  async names(key: string): Promise<string[]> {
    return Object.keys((await this.lenient())[key] ?? {}).sort();
  }

  async set(key: string, name: string, value: string): Promise<void> {
    if (value.length === 0) throw new StoreError('invalid', 'Escribe el valor del secreto');
    if (value.length > 4_000) throw new StoreError('invalid', 'El secreto es demasiado largo (máximo 4000)');
    return this.change((data) => {
      data[key] = { ...(data[key] ?? {}), [name]: value };
      return true;
    });
  }

  /** Pasa los secretos de una clave a otra (al cambiar el ámbito de un servidor) [R30.9]. */
  async move(from: string, to: string): Promise<void> {
    return this.change((data) => {
      if (!data[from] || from === to) return false;
      data[to] = { ...(data[to] ?? {}), ...data[from] };
      delete data[from];
      return true;
    });
  }

  /** Pasa a otro prefijo (otra carpeta de proyecto) todas las claves `<prefijo>:<id>` [R96.7]. */
  async movePrefix(from: string, to: string): Promise<void> {
    return this.change((data) => {
      if (from === to) return false;
      let changed = false;
      for (const key of Object.keys(data)) {
        if (!key.startsWith(`${from}:`)) continue;
        const next = `${to}:${key.slice(from.length + 1)}`;
        data[next] = { ...(data[next] ?? {}), ...data[key] };
        delete data[key];
        changed = true;
      }
      return changed;
    });
  }

  async remove(key: string, name?: string): Promise<void> {
    return this.change((data) => {
      if (!data[key]) return false;
      if (name === undefined) delete data[key];
      else {
        const { [name]: _gone, ...rest } = data[key];
        void _gone;
        data[key] = rest;
      }
      return true;
    });
  }

  /** Solo para el proceso principal al lanzar un agente. */
  async read(key: string): Promise<Record<string, string>> {
    return { ...((await this.lenient())[key] ?? {}) };
  }
}
