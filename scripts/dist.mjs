// Construye el instalador del sistema actual en release/dist [R91.5]:
// compila en modo release, genera los avisos, prepara release/app con las dependencias de ejecución y llama a
// electron-builder. La firma y la notarización salen solas de los secretos del entorno [R91.16].
import { execFileSync, execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const stage = join(root, 'release', 'app');
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const node = (script, ...args) => execFileSync(process.execPath, [join(root, script), ...args], { cwd: root, stdio: 'inherit' });

/** El package.json de lo empaquetado: el de la app, sin lo que solo sirve en el repositorio (los `@orquestador/*` van en el bundle). */
export function stagedManifest(app) {
  const rest = { ...app };
  delete rest.name;
  delete rest.private;
  const dependencies = Object.fromEntries(Object.entries(app.dependencies ?? {}).filter(([name]) => !name.startsWith('@orquestador/')));
  return { name: 'orquestador', ...rest, dependencies };
}

/** Variables de firma y notarización que lee electron-builder [R91.16]. */
export const SIGNING_VARS = ['CSC_LINK', 'CSC_KEY_PASSWORD', 'CSC_NAME', 'WIN_CSC_LINK', 'WIN_CSC_KEY_PASSWORD', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID', 'APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER'];

/**
 * Quita las que llegan vacías: la CI pone `''` si no existe el secreto, y electron-builder toma un `CSC_LINK` vacío
 * por una ruta (la carpeta del proyecto) e intenta importarla como certificado [R91.16].
 */
export function dropEmptySigning(env) {
  for (const k of SIGNING_VARS) if (env[k] !== undefined && env[k].trim() === '') delete env[k];
  return env;
}

/** ¿Hay con qué firmar en macOS? Si no, firma *ad hoc* (Apple Silicon no abre nada sin firma) [R91.16]. */
export const macIdentity = (env) => (env.CSC_LINK || env.CSC_NAME ? undefined : '-');

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  rmSync(join(root, 'release'), { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });
  node('scripts/build-desktop.mjs', '--release', '--out', 'release/app/dist');
  node('scripts/notices.mjs');
  const app = readJson(join(root, 'apps', 'desktop', 'package.json'));
  writeFileSync(join(stage, 'package.json'), `${JSON.stringify(stagedManifest(app), null, 2)}\n`);
  // Solo lo de ejecución, para este sistema: cada uno trae su binario de Claude y su node-pty [R91.3].
  execSync('npm install --omit=dev --no-audit --no-fund --no-package-lock', { cwd: stage, stdio: 'inherit' });
  if (!existsSync(join(stage, 'node_modules', '@anthropic-ai', 'claude-agent-sdk'))) throw new Error('No se instaló el SDK de Claude');

  const config = readJson(join(root, 'apps', 'desktop', 'electron-builder.json'));
  delete config.$comment;
  const electronVersion = readJson(join(root, 'node_modules', 'electron', 'package.json')).version;
  dropEmptySigning(process.env);
  const identity = macIdentity(process.env);
  const { build, Platform, Arch } = await import('electron-builder');
  const targets = process.platform === 'win32' ? Platform.WINDOWS : process.platform === 'darwin' ? Platform.MAC : Platform.LINUX;
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  await build({
    projectDir: root,
    targets: targets.createTarget(undefined, Arch[arch]),
    config: { ...config, electronVersion, mac: { ...config.mac, ...(identity ? { identity } : {}) } },
    publish: 'never',
  });
  cpSync(join(root, 'release', 'THIRD_PARTY_NOTICES.txt'), join(root, 'release', 'dist', 'THIRD_PARTY_NOTICES.txt'));
  console.log('Paquete en', join(root, 'release', 'dist'));
}
