import type { AppSettings } from '@orquestador/core';
import { UNHANDLED, isObject, type RequestCheck } from './check';
import { CHANNELS } from './contract';
import type { ApiResult } from './result';

/** Resultado de «Probar conexión» [R27.12]. */
export interface ConnectionResult {
  ok: boolean;
  message: string;
  model: string;
  ms: number;
}

/** Ajustes tal como los ve el renderer: la clave API nunca viaja, solo si existe [R23.3]. */
export interface SettingsView extends AppSettings {
  apiKeyStored: boolean;
}

/** Ajustes de la app y clave API. */
export interface SettingsApi {
  getSettings(): Promise<ApiResult<SettingsView>>;
  saveSettings(settings: AppSettings): Promise<ApiResult<SettingsView>>;
  /** Consulta mínima a Claude con los ajustes guardados [R27.12]. */
  testConnection(): Promise<ApiResult<ConnectionResult>>;
  setApiKey(key: string): Promise<ApiResult<SettingsView>>;
  clearApiKey(): Promise<ApiResult<SettingsView>>;
}

/** Ajustes nuevos por forma: objetos, sí/no, números y palabras [R70.21]. */
const SETTINGS_OBJECTS = ['limits', 'unanswered'];
const SETTINGS_FLAGS: string[] = [];
const SETTINGS_NUMBERS: string[] = ['memoryTokens'];
const SETTINGS_WORDS: string[] = [];

export function parseSettingsRequest(channel: string, payload: unknown, { bad, exact, str }: RequestCheck): unknown {
  switch (channel) {
    case CHANNELS.testConnection:
    case CHANNELS.getSettings:
    case CHANNELS.clearApiKey:
      if (payload !== undefined && payload !== null) throw bad('no admite argumentos');
      return undefined;
    case CHANNELS.saveSettings: {
      if (!isObject(payload)) throw bad('se esperaban ajustes');
      exact(payload, ['schemaVersion', 'authMode', 'engine', 'defaultModel', 'maxParallel', 'defaultMaxTokens', 'permissions', 'claudeConfig', 'supervisorReview', 'supervisorModel', 'supervisorHumanChecks', ...SETTINGS_OBJECTS, ...SETTINGS_FLAGS, ...SETTINGS_NUMBERS, ...SETTINGS_WORDS]);
      // Los ajustes de SPEC-070–077 se comprueban por su forma; el contenido lo valida `validateSettings` al guardar.
      for (const k of SETTINGS_OBJECTS) if (payload[k] !== undefined && !isObject(payload[k])) throw bad(`${k} no válido`);
      for (const k of SETTINGS_FLAGS) if (payload[k] !== undefined && typeof payload[k] !== 'boolean') throw bad(`${k} no válido`);
      for (const k of SETTINGS_NUMBERS) if (payload[k] !== undefined && typeof payload[k] !== 'number') throw bad(`${k} no válido`);
      for (const k of SETTINGS_WORDS) if (payload[k] !== undefined) str(payload[k], k, 200);
      if (typeof payload.schemaVersion !== 'number') throw bad('falta la versión');
      str(payload.authMode, 'authMode', 50);
      str(payload.engine, 'engine', 50);
      str(payload.defaultModel, 'defaultModel', 200);
      if (typeof payload.maxParallel !== 'number') throw bad('maxParallel no válido');
      if (payload.defaultMaxTokens !== undefined && typeof payload.defaultMaxTokens !== 'number') throw bad('defaultMaxTokens no válido');
      if (payload.permissions !== undefined && !['ask', 'auto', 'full'].includes(payload.permissions as string)) throw bad('permissions no válido');
      if (payload.claudeConfig !== undefined && typeof payload.claudeConfig !== 'boolean') throw bad('claudeConfig no válido');
      if (payload.supervisorReview !== undefined && typeof payload.supervisorReview !== 'boolean') throw bad('supervisorReview no válido');
      if (payload.supervisorModel !== undefined) str(payload.supervisorModel, 'supervisorModel', 200);
      if (payload.supervisorHumanChecks !== undefined && payload.supervisorHumanChecks !== 'warn' && payload.supervisorHumanChecks !== 'fail') throw bad('supervisorHumanChecks no válido');
      return payload as unknown as AppSettings;
    }
    case CHANNELS.setApiKey:
      return str(payload, 'clave', 2000);
    default:
      return UNHANDLED;
  }
}
