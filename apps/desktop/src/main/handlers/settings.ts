import { testConnection } from '@orquestador/claude';
import type { AppSettings } from '@orquestador/core';
import { CHANNELS, type SettingsView } from '@orquestador/editor';
import { StoreError } from '@orquestador/store';
import { UNHANDLED, type HandlerState } from './state';

async function settingsView(h: HandlerState): Promise<SettingsView> {
  return { ...h.settings, apiKeyStored: (await h.deps.vault?.has()) ?? false, ...(h.deps.settings?.recovered ? { recovered: true } : {}), ...(h.deps.appInfo ? { app: h.deps.appInfo } : {}) };
}

export async function handleSettings(h: HandlerState, channel: string, arg: unknown): Promise<unknown> {
  switch (channel) {
    case CHANNELS.getSettings: {
      if (h.deps.settings) h.settings = await h.deps.settings.load();
      return settingsView(h);
    }
    case CHANNELS.saveSettings: {
      if (!h.deps.settings) throw new StoreError('unavailable', 'Los ajustes no están disponibles');
      h.settings = await h.deps.settings.save(arg as AppSettings);
      return settingsView(h);
    }
    case CHANNELS.testConnection: {
      const root = h.root;
      if (!root) throw new StoreError('not-found', 'Abre un proyecto para probar la conexión');
      if (!h.deps.claudeQuery) throw new StoreError('unavailable', 'El motor de Claude no está disponible');
      const r = await testConnection({ query: h.deps.claudeQuery, settings: h.settings, apiKey: await h.deps.vault?.read(), cwd: root });
      return r;
    }
    case CHANNELS.setApiKey: {
      if (!h.deps.vault) throw new StoreError('unavailable', 'La clave no se puede guardar en este sistema');
      await h.deps.vault.set(arg as string);
      return settingsView(h);
    }
    case CHANNELS.clearApiKey: {
      await h.deps.vault?.clear();
      return settingsView(h);
    }
    default:
      return UNHANDLED;
  }
}
