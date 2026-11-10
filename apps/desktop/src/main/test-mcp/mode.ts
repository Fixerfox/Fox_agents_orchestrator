/** Lo que se sabe del modo prueba sin cargar su servidor: va en toda compilación [R82.1][R91.8]. */
export const DEFAULT_TEST_PORT = 47321;
/** Carpeta de datos del modo prueba, junto a la normal [R82.2]. */
export const TEST_DATA_FOLDER = 'Orquestador-test';

/** ¿Arranca en modo prueba, y en qué puerto? Nunca en la app empaquetada [R82.1]. */
export function testMode(argv: readonly string[], packaged: boolean): { port: number } | undefined {
  if (packaged || !argv.includes('--test-mcp')) return undefined;
  const raw = argv.find((a) => a.startsWith('--test-mcp-port='))?.split('=')[1];
  const port = raw !== undefined && /^\d+$/.test(raw) && Number(raw) > 0 && Number(raw) < 65536 ? Number(raw) : DEFAULT_TEST_PORT;
  return { port };
}
