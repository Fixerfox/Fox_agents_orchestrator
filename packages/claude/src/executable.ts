import path from 'node:path';

/** Lo que hace falta del sistema para encontrar el binario de Claude; se inyecta para probarlo [R91.6]. */
export interface ExecutableEnv {
  platform: NodeJS.Platform;
  arch: string;
  /** `require.resolve` de un módulo; lanza si no existe. */
  resolve(id: string): string;
  exists(file: string): boolean;
  /** La app está empaquetada: lo de `app.asar` está en `app.asar.unpacked`. */
  packaged: boolean;
  /** `PATH` y, en Windows, `PATHEXT`. */
  envPath?: string | undefined;
  pathExt?: string | undefined;
  /** Linux con musl (Alpine): se prueba antes esa variante, como hace el SDK. */
  musl?: boolean;
}

const SDK = '@anthropic-ai/claude-agent-sdk';

/** Paquetes de plataforma que trae el SDK, en el orden en que los prueba él [R91.6]. */
export function platformPackages(platform: NodeJS.Platform, arch: string, musl = false): string[] {
  if (platform === 'linux') return musl ? [`${SDK}-linux-${arch}-musl`, `${SDK}-linux-${arch}`] : [`${SDK}-linux-${arch}`, `${SDK}-linux-${arch}-musl`];
  return [`${SDK}-${platform}-${arch}`];
}

/** Dentro de un paquete, lo desempaquetado está junto a `app.asar` [R91.6]. */
export const unpacked = (file: string): string => file.replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2');

/**
 * Ruta del binario de Claude: el del paquete de plataforma del SDK (fuera del `asar` si la app está empaquetada) o, si
 * falta, el `claude` del `PATH`. Sin ninguno, `undefined` y el SDK dirá que no lo encuentra [R91.6].
 */
export function resolveClaudeExecutable(env: ExecutableEnv): string | undefined {
  const exe = env.platform === 'win32' ? 'claude.exe' : 'claude';
  for (const pkg of platformPackages(env.platform, env.arch, env.musl)) {
    let file: string;
    try {
      file = env.resolve(`${pkg}/${exe}`);
    } catch {
      continue;
    }
    const real = env.packaged ? unpacked(file) : file;
    if (env.exists(real)) return real;
  }
  const sep = env.platform === 'win32' ? ';' : ':';
  const exts = env.platform === 'win32' ? (env.pathExt ?? '.EXE;.CMD;.BAT').split(';').filter(Boolean) : [''];
  for (const dir of (env.envPath ?? '').split(sep).filter(Boolean)) {
    for (const ext of exts) {
      const candidate = path.join(dir, `claude${ext.toLowerCase()}`);
      if (env.exists(candidate)) return candidate;
    }
  }
  return undefined;
}
