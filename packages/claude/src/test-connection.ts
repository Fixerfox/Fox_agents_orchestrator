import type { AppSettings } from '@orquestador/core';
import { explainThrown } from './errors';
import { askOnce } from './once';
import type { QueryFn } from './sdk-types';

export interface ConnectionResult {
  ok: boolean;
  message: string;
  model: string;
  ms: number;
}

/** Consulta mínima con los ajustes guardados [R27.12]; nunca lanza: devuelve el motivo explicado. */
export async function testConnection(args: { query: QueryFn; settings: AppSettings; apiKey: string | undefined; cwd: string }): Promise<ConnectionResult> {
  const model = args.settings.defaultModel;
  const start = Date.now();
  try {
    const { ms } = await askOnce({ ...args, system: 'Responde solo con la palabra OK.', prompt: 'Comprobación de conexión.' });
    return { ok: true, message: 'Claude responde correctamente.', model, ms };
  } catch (e) {
    return { ok: false, message: explainThrown(e, args.apiKey).message, model, ms: Date.now() - start };
  }
}
