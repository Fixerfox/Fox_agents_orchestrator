import { join } from 'node:path';

/** Lo que comprueba la prueba de humo; todo se inyecta para probarla sin Electron [R91.14]. */
export interface SmokeDeps {
  dataDir: string;
  /** Espera a que la ventana cargue la interfaz. */
  windowLoaded(): Promise<void>;
  writeFile(file: string, text: string): Promise<void>;
  removeFile(file: string): Promise<void>;
  /** Ruta del binario de Claude que se ha encontrado, si hay. */
  claude: string | undefined;
  exists(file: string): boolean;
  /** Ejecuta `claude --version`: que exista no basta si el sistema no lo deja arrancar. */
  claudeVersion(file: string): Promise<string>;
  loadPty(): Promise<unknown>;
  timeoutMs?: number;
}

export interface SmokeResult {
  ok: boolean;
  window: boolean;
  data: boolean;
  claude: boolean;
  pty: boolean;
  claudePath?: string;
  claudeVersion?: string;
  errors: string[];
}

export const SMOKE_ARG = '--smoke';
export const isSmoke = (argv: readonly string[]): boolean => argv.includes(SMOKE_ARG);
/** La línea que busca la CI en la salida [R91.14]. */
export const smokeLine = (r: SmokeResult): string => `ORQ_SMOKE ${JSON.stringify(r)}`;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

function within<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what}: sin respuesta en ${Math.round(ms / 1000)} s`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

/** Arranque mínimo de lo empaquetado: ventana, datos, Claude y node-pty [R91.14]. */
export async function runSmoke(d: SmokeDeps): Promise<SmokeResult> {
  const errors: string[] = [];
  const ms = d.timeoutMs ?? 30_000;
  const check = async (what: string, fn: () => Promise<void>): Promise<boolean> => {
    try {
      await within(fn(), ms, what);
      return true;
    } catch (e) {
      errors.push(`${what}: ${message(e)}`);
      return false;
    }
  };
  const window = await check('ventana', () => d.windowLoaded());
  const data = await check('datos', async () => {
    const probe = join(d.dataDir, `.smoke-${process.pid}`);
    await d.writeFile(probe, 'ok');
    await d.removeFile(probe);
  });
  let version: string | undefined;
  const claude = await check('claude', async () => {
    if (!d.claude) throw new Error('no se encuentra el binario');
    if (!d.exists(d.claude)) throw new Error(`no existe ${d.claude}`);
    version = (await d.claudeVersion(d.claude)).trim();
    if (!version) throw new Error('no dice su versión');
  });
  const pty = await check('node-pty', async () => {
    await d.loadPty();
  });
  return { ok: window && data && claude && pty, window, data, claude, pty, ...(d.claude ? { claudePath: d.claude } : {}), ...(version ? { claudeVersion: version } : {}), errors };
}
