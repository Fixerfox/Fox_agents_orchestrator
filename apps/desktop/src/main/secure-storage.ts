/** Lo que se usa del `safeStorage` de Electron. */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  /** Solo en Linux: `basic_text` es una clave conocida, no un llavero del sistema. */
  getSelectedStorageBackend?(): string;
}

/** Backends de Linux que no protegen nada: cifran con una clave conocida o no lo dicen [R90.8]. */
const WEAK_LINUX_BACKENDS = new Set(['basic_text', 'unknown', '']);

/**
 * ¿Hay cifrado de verdad? En Linux sin gnome-keyring ni kwallet, Electron cifra con `basic_text` y aun así dice que está
 * disponible: eso cuenta como no disponible, para no guardar la clave «cifrada» con una clave conocida [R90.8].
 */
export function secureStorageAvailable(storage: SafeStorageLike, platform: NodeJS.Platform = process.platform): boolean {
  if (!storage.isEncryptionAvailable()) return false;
  if (platform !== 'linux') return true;
  const backend = storage.getSelectedStorageBackend?.() ?? '';
  return !WEAK_LINUX_BACKENDS.has(backend);
}
