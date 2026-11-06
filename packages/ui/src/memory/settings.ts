import { normalizeSettings, validateSettings } from '@orquestador/core';
import { fail, ok, type SettingsView } from '@orquestador/editor';
import { invalid } from './state';
import type { MemoryApi, MemoryApiOptions, MemoryState } from './types';

/** Ajustes de la app y clave API. */
export function memorySettings(s: MemoryState, options: MemoryApiOptions) {
  let keyStored = false;
  const view = (): SettingsView => ({ ...s.settings, apiKeyStored: keyStored });

  return {
    async getSettings() {
      return ok(view());
    },
    async testConnection() {
      return ok(options.connection ?? { ok: true, message: 'Claude responde correctamente.', model: s.settings.defaultModel, ms: 120 });
    },
    async saveSettings(next) {
      const problems = validateSettings(next);
      if (problems.length > 0) return invalid(problems);
      s.settings = normalizeSettings(next);
      return ok(view());
    },
    async setApiKey(key) {
      const field = (message: string) => fail('invalid', message, [{ field: 'apiKey', message }]);
      if (key.length === 0) return field('Escribe la clave');
      if (/\s/.test(key)) return field('La clave no puede llevar espacios');
      if (key.length > 500) return field('La clave es demasiado larga (máximo 500)');
      if (options.noEncryption) return fail('unavailable', 'Este sistema no ofrece almacenamiento cifrado: la clave no se guarda');
      keyStored = true;
      return ok(view());
    },
    async clearApiKey() {
      keyStored = false;
      return ok(view());
    },
  } satisfies Partial<MemoryApi>;
}
