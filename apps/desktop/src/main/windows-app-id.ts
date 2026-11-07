/** Identidad de la app en Windows, que decide si sus avisos se enseñan [R61.14]. */
export const APP_USER_MODEL_ID = 'com.fixerfox.orquestador';

/**
 * Argumentos de `reg` para dar de alta la identidad en el usuario actual. Sin instalador no la crea nadie, y sin ella
 * Windows descarta los avisos en silencio aunque Electron informe de que se enseñaron [R61.14].
 */
export function appIdRegistration(icon: string): string[][] {
  const key = `HKCU\\Software\\Classes\\AppUserModelId\\${APP_USER_MODEL_ID}`;
  const value = (name: string, data: string) => ['add', key, '/v', name, '/t', 'REG_EXPAND_SZ', '/d', data, '/f'];
  return [value('DisplayName', 'Orquestador'), value('IconUri', icon)];
}
