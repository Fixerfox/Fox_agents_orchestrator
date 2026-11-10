import { cpSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/** Nombre de la app y de su carpeta de datos [R91.1]. */
export const APP_NAME = 'Orquestador';
/** Carpeta de datos de antes de empaquetar: Electron usaba el `name` del paquete [R91.2]. */
export const OLD_DATA_FOLDER = join('@orquestador', 'desktop');
/** Lo nuestro: ajustes, clave y secretos, recientes, pestañas del asistente, confianza y registros [R91.2]. */
export const MIGRATED = ['config', 'assistant', 'trust', 'trust.json', 'logs'] as const;

/**
 * Copia una vez lo nuestro de la carpeta antigua a la nueva, si la nueva aún no tiene `config/` y la antigua sí. No
 * toca la antigua ni copia cachés de Chromium ni `spaces/` [R91.2].
 */
export function migrateDataFolder(appData: string, fs: { exists(file: string): boolean; copy(from: string, to: string): void } = { exists: existsSync, copy: (from: string, to: string) => cpSync(from, to, { recursive: true, errorOnExist: false, force: false }) }): 'migrated' | 'skipped' {
  const oldDir = join(appData, OLD_DATA_FOLDER);
  const newDir = join(appData, APP_NAME);
  if (fs.exists(join(newDir, 'config')) || !fs.exists(join(oldDir, 'config'))) return 'skipped';
  for (const entry of MIGRATED) {
    const from = join(oldDir, entry);
    if (fs.exists(from)) fs.copy(from, join(newDir, entry));
  }
  return 'migrated';
}
