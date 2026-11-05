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
  constructor(readonly dir: string) {}

  get file(): string {
    return path.join(this.dir, 'settings.json');
  }

  /** Lee los ajustes; si no existen o están dañados se usan los de por defecto [R23.1]. */
  async load(): Promise<AppSettings> {
    try {
      return normalizeSettings((await readVersioned<AppSettings>(this.file, settingsSpec)).data);
    } catch (err) {
      if (err instanceof StoreError && (err.code === 'not-found' || err.code === 'corrupt')) return defaultSettings();
      throw err;
    }
  }

  async save(settings: AppSettings): Promise<AppSettings> {
    const problems = validateSettings(settings);
    if (problems.length > 0) throw new StoreError('invalid', problems[0]!.message, problems);
    const clean = normalizeSettings(settings);
    await writeVersioned(this.file, clean as unknown as Record<string, unknown>, settingsSpec);
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
export class McpSecretVault {
  constructor(
    readonly dir: string,
    private readonly cipher: SecretCipher,
  ) {}

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
    try {
      const v: unknown = JSON.parse(this.cipher.decrypt(Buffer.from(raw, 'base64')));
      return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, Record<string, string>>) : {};
    } catch {
      return {};
    }
  }

  private async write(data: Record<string, Record<string, string>>): Promise<void> {
    if (!this.cipher.available()) throw new StoreError('unavailable', 'Este sistema no ofrece almacenamiento cifrado: el secreto no se guarda');
    await atomicWrite(this.file, this.cipher.encrypt(JSON.stringify(data)).toString('base64'));
  }

  /** Nombres con valor guardado (nunca los valores). */
  async names(key: string): Promise<string[]> {
    return Object.keys((await this.all())[key] ?? {}).sort();
  }

  async set(key: string, name: string, value: string): Promise<void> {
    if (value.length === 0) throw new StoreError('invalid', 'Escribe el valor del secreto');
    if (value.length > 4_000) throw new StoreError('invalid', 'El secreto es demasiado largo (máximo 4000)');
    const data = await this.all();
    data[key] = { ...(data[key] ?? {}), [name]: value };
    await this.write(data);
  }

  /** Pasa los secretos de una clave a otra (al cambiar el ámbito de un servidor) [R30.9]. */
  async move(from: string, to: string): Promise<void> {
    const data = await this.all();
    if (!data[from] || from === to) return;
    data[to] = { ...(data[to] ?? {}), ...data[from] };
    delete data[from];
    await this.write(data);
  }

  async remove(key: string, name?: string): Promise<void> {
    const data = await this.all();
    if (!data[key]) return;
    if (name === undefined) delete data[key];
    else {
      const { [name]: _gone, ...rest } = data[key];
      void _gone;
      data[key] = rest;
    }
    await this.write(data);
  }

  /** Solo para el proceso principal al lanzar un agente. */
  async read(key: string): Promise<Record<string, string>> {
    return { ...((await this.all())[key] ?? {}) };
  }
}
