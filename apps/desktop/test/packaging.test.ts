import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { defaultSettings } from '@orquestador/core';
import { CHANNELS } from '@orquestador/editor';
import { createDemoOrchestrator } from '@orquestador/runtime';
import { APP_NAME, MIGRATED, OLD_DATA_FOLDER, migrateDataFolder } from '../src/main/data-folder';
import { DesktopHandlers } from '../src/main/handlers';
import { isSmoke, runSmoke, smokeLine, type SmokeDeps } from '../src/main/smoke';
import { firstThatStarts, linuxTerminals, macTerminal, TerminalService, withClaudeOnPath } from '../src/main/terminal';
import { windowOptions } from '../src/main/window';

const ROOT = join(__dirname, '..', '..', '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const json = <T>(rel: string) => JSON.parse(read(rel)) as T;
const script = async <T>(rel: string) => (await import(pathToFileURL(join(ROOT, rel)).href)) as T;
const MAIN = read('apps/desktop/src/main/main.ts');

describe('SPEC-091 · carpeta de datos', () => {
  it('[R91.1] fija el nombre y la carpeta antes de la instancia única, salvo en modo prueba', () => {
    const setName = MAIN.indexOf('app.setName(APP_NAME)');
    expect(APP_NAME).toBe('Orquestador');
    expect(setName).toBeGreaterThan(MAIN.indexOf('if (test) app.setPath'));
    expect(MAIN.indexOf("app.setPath('userData', join(app.getPath('appData'), APP_NAME))")).toBeGreaterThan(setName);
    expect(MAIN.indexOf('requestSingleInstanceLock')).toBeGreaterThan(MAIN.indexOf('migrateDataFolder('));
  });

  it('[R91.2] copia lo nuestro una sola vez, sin cachés ni espacios, y no toca la antigua', () => {
    const files = new Set([join('/ad', OLD_DATA_FOLDER, 'config'), join('/ad', OLD_DATA_FOLDER, 'assistant'), join('/ad', OLD_DATA_FOLDER, 'trust.json'), join('/ad', OLD_DATA_FOLDER, 'spaces'), join('/ad', OLD_DATA_FOLDER, 'Cache')]);
    const copied: [string, string][] = [];
    const fs = { exists: (f: string) => files.has(f), copy: (a: string, b: string) => void copied.push([a, b]) };
    expect(migrateDataFolder('/ad', fs)).toBe('migrated');
    expect(copied).toEqual([
      [join('/ad', OLD_DATA_FOLDER, 'config'), join('/ad', APP_NAME, 'config')],
      [join('/ad', OLD_DATA_FOLDER, 'assistant'), join('/ad', APP_NAME, 'assistant')],
      [join('/ad', OLD_DATA_FOLDER, 'trust.json'), join('/ad', APP_NAME, 'trust.json')],
    ]);
    expect(MIGRATED).not.toContain('spaces');
    // Ya migrada (la nueva tiene config/) o sin datos antiguos: nada.
    files.add(join('/ad', APP_NAME, 'config'));
    expect(migrateDataFolder('/ad', fs)).toBe('skipped');
    expect(migrateDataFolder('/vacio', { exists: () => false, copy: () => undefined })).toBe('skipped');
  });

  it('[R91.2] en disco: los ajustes y la clave cifrada siguen ahí (E91.a)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'orq-mig-'));
    try {
      const { mkdir, writeFile } = await import('node:fs/promises');
      await mkdir(join(dir, OLD_DATA_FOLDER, 'config'), { recursive: true });
      await writeFile(join(dir, OLD_DATA_FOLDER, 'config', 'settings.json'), '{"maxParallel":6}');
      await writeFile(join(dir, OLD_DATA_FOLDER, 'config', 'api-key.bin'), 'cifrado');
      expect(migrateDataFolder(dir)).toBe('migrated');
      expect(await readFile(join(dir, APP_NAME, 'config', 'settings.json'), 'utf8')).toBe('{"maxParallel":6}');
      expect(await readFile(join(dir, APP_NAME, 'config', 'api-key.bin'), 'utf8')).toBe('cifrado');
      expect(existsSync(join(dir, OLD_DATA_FOLDER, 'config', 'settings.json'))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('SPEC-091 · paquete', () => {
  it('[R91.3] la app declara nombre, versión, licencia y solo las dependencias de ejecución, exactas', () => {
    const app = json<{ productName: string; version: string; license: string; author: string; dependencies: Record<string, string> }>('apps/desktop/package.json');
    expect(app).toMatchObject({ productName: 'Orquestador', version: '0.9.0', license: 'MIT', author: 'Nicolas Corta Avila' });
    const runtime = Object.entries(app.dependencies).filter(([name]) => !name.startsWith('@orquestador/'));
    expect(runtime.map(([name]) => name).sort()).toEqual(['@anthropic-ai/claude-agent-sdk', '@anthropic-ai/sdk', '@lydell/node-pty', '@modelcontextprotocol/sdk', 'zod']);
    // Exactas y las mismas que están instaladas en el repositorio.
    for (const [name, v] of runtime) {
      expect(v).toMatch(/^\d+\.\d+\.\d+(-[\w.]+)?$/);
      expect(json<{ version: string }>(`node_modules/${name}/package.json`).version).toBe(v);
    }
  });

  it('[R91.4] electron-builder: id, asar, recursos y un destino por sistema con nombre fijo', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- configuración de electron-builder leída tal cual
    const c = json<Record<string, any>>('apps/desktop/electron-builder.json');
    expect(c.appId).toBe('com.fixerfox.orquestador');
    expect(read('apps/desktop/src/main/windows-app-id.ts')).toContain('com.fixerfox.orquestador');
    expect(c.asar).toBe(true);
    expect(c.asarUnpack).toEqual(expect.arrayContaining(['node_modules/@anthropic-ai/claude-agent-sdk*/**', 'node_modules/@lydell/node-pty*/**']));
    expect(c.extraResources.map((r: { to: string }) => r.to)).toEqual(['LICENSE', 'THIRD_PARTY_NOTICES.txt', 'icon.png']);
    expect(c.win.target).toEqual([{ target: 'nsis', arch: ['x64'] }]);
    expect(c.nsis).toMatchObject({ oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true });
    expect(c.linux).toMatchObject({ target: [{ target: 'AppImage', arch: ['x64'] }], category: 'Development', executableName: 'orquestador' });
    expect(c.mac).toMatchObject({ category: 'public.app-category.developer-tools', hardenedRuntime: true });
    const entitlements = read(c.mac.entitlements);
    for (const k of ['allow-jit', 'allow-unsigned-executable-memory', 'disable-library-validation']) expect(entitlements).toContain(`com.apple.security.cs.${k}`);
    // Nombres fijos, para los enlaces de la web (decisión 5).
    expect(c.win.artifactName.replace('${arch}', 'x64').replace('${ext}', 'exe')).toBe('Orquestador-Windows-x64.exe');
    expect(c.linux.artifactName.replace('${ext}', 'AppImage')).toBe('Orquestador-Linux-x86_64.AppImage');
    expect(c.dmg.artifactName.replace('${arch}', 'arm64').replace('${ext}', 'dmg')).toBe('Orquestador-macOS-arm64.dmg');
    for (const rel of [c.linux.icon, c.mac.icon, 'LICENSE']) expect(existsSync(join(ROOT, rel))).toBe(true);
  });

  it('[R91.5] npm run dist: release, avisos, dependencias de ejecución y electron-builder', async () => {
    expect(json<{ scripts: Record<string, string> }>('package.json').scripts.dist).toBe('node scripts/dist.mjs');
    const src = read('scripts/dist.mjs');
    expect(src).toContain("'--release'");
    expect(src).toContain("'scripts/notices.mjs'");
    expect(src).toContain('npm install --omit=dev');
    const { stagedManifest } = await script<{ stagedManifest(a: object): Record<string, unknown> }>('scripts/dist.mjs');
    const staged = stagedManifest(json('apps/desktop/package.json'));
    expect(staged).toMatchObject({ name: 'orquestador', productName: 'Orquestador', main: 'dist/main.cjs' });
    expect(staged).not.toHaveProperty('private');
    expect(Object.keys(staged.dependencies as object).some((d) => d.startsWith('@orquestador/'))).toBe(false);
  });
});

describe('SPEC-091 · compilación de release', () => {
  it('[R91.8] --release: sin sourcemaps y sin el modo prueba, que se carga por import() tras la constante', () => {
    const build = read('scripts/build-desktop.mjs');
    expect(build).toContain('sourcemap: !release');
    expect(build).toContain('__ORQ_TEST_MCP__: String(!release)');
    expect(MAIN).not.toMatch(/^import .* from '\.\/test-mcp\/(server|tools)'/m);
    expect(MAIN).toContain('const startTestMcp = __ORQ_TEST_MCP__ ?');
    expect(MAIN).toContain("await import('./test-mcp/server')");
  });

  it('[R91.9] empaquetada, la ventana no tiene DevTools', () => {
    expect(windowOptions('/p.cjs', 'win32', undefined, undefined, false).webPreferences.devTools).toBe(false);
    expect(windowOptions('/p.cjs').webPreferences.devTools).toBe(true);
    expect(MAIN).toContain('!app.isPackaged));');
  });
});

describe('SPEC-091 · versión y avisos', () => {
  it('[R91.10] los avisos llevan cada paquete de producción con su licencia, y Spec Kit', async () => {
    type Entry = { name: string; version: string; license: string; text: string };
    const n = await script<{ productionRoots(): string[]; collect(n: string[]): Entry[]; vendored(): Entry[]; render(e: Entry[], v: string): string }>('scripts/notices.mjs');
    const roots = n.productionRoots();
    expect(roots).toEqual(expect.arrayContaining(['react', '@xyflow/react', '@anthropic-ai/claude-agent-sdk', '@fontsource-variable/geist', 'fflate']));
    expect(roots.some((r) => r.startsWith('@orquestador/'))).toBe(false);
    const entries = n.collect(['react', '@fontsource-variable/geist']);
    expect(entries.find((e) => e.name === 'react')).toMatchObject({ license: 'MIT' });
    expect(entries.find((e) => e.name === '@fontsource-variable/geist')?.license).toMatch(/OFL/);
    expect(n.vendored()[0]).toMatchObject({ license: 'MIT' });
    const text = n.render([...entries, ...n.vendored()], '0.9.0');
    expect(text).toContain('Orquestador 0.9.0');
    expect(text).toContain('GitHub Spec Kit');
    expect(text).toMatch(/react \d+\.\d+\.\d+ — MIT/);
  });

  it('[R91.11] los ajustes traen la versión y el sistema, que no se guardan', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'orq-info-'));
    try {
      const { SettingsStore } = await import('@orquestador/store');
      const h = new DesktopHandlers({ pickFolder: async () => null, createOrchestrator: () => createDemoOrchestrator(), settings: new SettingsStore(dir), appInfo: { version: '0.9.0', platform: 'linux', arch: 'x64' } });
      expect(await h.invoke(CHANNELS.getSettings, undefined)).toMatchObject({ ok: true, value: { app: { version: '0.9.0', platform: 'linux', arch: 'x64' } } });
      // Guardar los ajustes con `app` lo rechaza el contrato: no es un ajuste.
      expect(await h.invoke(CHANNELS.saveSettings, { ...defaultSettings(), app: { version: 'x' } })).toMatchObject({ ok: false });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('SPEC-091 · cada sistema', () => {
  it('[R91.12] Linux: $TERMINAL y después las conocidas, la primera que arranca', async () => {
    const cmd = { file: 'claude', args: ['hola'] };
    const list = linuxTerminals(cmd, { TERMINAL: 'alacritty' });
    expect(list.map((c) => c.file)).toEqual(['alacritty', 'x-terminal-emulator', 'gnome-terminal', 'konsole', 'xfce4-terminal', 'xterm']);
    expect(list[2]).toEqual({ file: 'gnome-terminal', args: ['--', 'claude', 'hola'] });
    expect(linuxTerminals(cmd, {})[0]!.file).toBe('x-terminal-emulator');
    const tried: string[] = [];
    await firstThatStarts(list, async (c) => {
      tried.push(c.file);
      if (c.file !== 'konsole') throw new Error('ENOENT');
    });
    expect(tried).toEqual(['alacritty', 'x-terminal-emulator', 'gnome-terminal', 'konsole']);
    await expect(firstThatStarts(list, async () => Promise.reject(new Error('ENOENT')))).rejects.toThrow('ENOENT');
    // Con node-pty roto, el servicio recorre la lista.
    const opened: string[] = [];
    const svc = new TerminalService({ loadPty: async () => Promise.reject(new Error('x')), openExternal: async (c) => (opened.push(c.file), c.file === 'xterm' ? undefined : Promise.reject(new Error('ENOENT'))), push: () => {}, platform: 'linux', env: {} });
    await expect(svc.start('/p', { program: 'claude', cols: 80, rows: 24 })).resolves.toMatchObject({ external: true });
    expect(opened.at(-1)).toBe('xterm');
  });

  it('[R91.12] macOS: Terminal.app en la carpeta, con todo entre comillas', () => {
    const m = macTerminal({ file: 'claude', args: ["it's \"ok\""] }, '/Users/u/mi proyecto', {});
    expect(m.file).toBe('osascript');
    expect(m.args[1]).toBe(`tell application "Terminal" to do script "cd '/Users/u/mi proyecto' && 'claude' 'it'\\\\''s \\"ok\\"'"`);
  });

  it('[R91.13] empaquetada, el icono sale de los recursos, fuera del asar', () => {
    expect(MAIN).toContain("app.isPackaged ? join(process.resourcesPath, 'icon.png')");
  });

  it('[R91.17] la terminal encuentra el claude del paquete al final del PATH', () => {
    expect(withClaudeOnPath({ PATH: '/usr/bin' }, '/opt/O/claude-dir', 'linux')).toEqual({ PATH: '/usr/bin:/opt/O/claude-dir' });
    expect(withClaudeOnPath({ Path: 'C:\\Windows' }, 'C:\\O\\sdk', 'win32')).toEqual({ Path: 'C:\\Windows;C:\\O\\sdk' });
    expect(withClaudeOnPath({ PATH: '/a:/b' }, '/b', 'darwin')).toEqual({ PATH: '/a:/b' });
    expect(withClaudeOnPath({ PATH: '/a' }, undefined, 'linux')).toEqual({ PATH: '/a' });
  });
});

describe('SPEC-091 · prueba de humo y releases', () => {
  const ok = (): SmokeDeps => ({
    dataDir: '/datos',
    windowLoaded: async () => undefined,
    writeFile: async () => undefined,
    removeFile: async () => undefined,
    claude: '/c/claude',
    exists: () => true,
    claudeVersion: async () => '2.1.0 (Claude Code)\n',
    loadPty: async () => ({}),
    timeoutMs: 200,
  });

  it('[R91.14] todo bien: ok y la versión de Claude; la línea la lee scripts/smoke.mjs', async () => {
    expect(isSmoke(['electron', '.', '--smoke'])).toBe(true);
    const r = await runSmoke(ok());
    expect(r).toMatchObject({ ok: true, window: true, data: true, claude: true, pty: true, claudeVersion: '2.1.0 (Claude Code)', errors: [] });
    const { parseSmoke } = await script<{ parseSmoke(t: string): unknown }>('scripts/smoke.mjs');
    expect(parseSmoke(`ruido\r\n${smokeLine(r)}\r\n`)).toEqual(r);
    expect(parseSmoke('nada')).toBeUndefined();
    expect(MAIN).toContain('if (!smoke && !app.requestSingleInstanceLock())');
  });

  it('[R91.14] cada fallo se dice, y una ventana que no carga no cuelga la prueba', async () => {
    const r = await runSmoke({ ...ok(), windowLoaded: () => new Promise(() => undefined), claude: undefined, loadPty: async () => Promise.reject(new Error('sin pty')) });
    expect(r).toMatchObject({ ok: false, window: false, data: true, claude: false, pty: false });
    expect(r.errors.join('\n')).toMatch(/ventana: .*sin respuesta[\s\S]*claude: no se encuentra[\s\S]*node-pty: sin pty/);
    const blocked = await runSmoke({ ...ok(), claudeVersion: async () => Promise.reject(new Error('EACCES')) });
    expect(blocked).toMatchObject({ ok: false, claude: false });
  });

  it('[R91.15] la CI construye los tres sistemas, prueba lo empaquetado y publica con una etiqueta', () => {
    const wf = read('.github/workflows/release.yml');
    expect(wf).toMatch(/tags: \['v\*'\]/);
    expect(wf).toContain('workflow_dispatch');
    for (const os of ['windows-latest', 'ubuntu-latest', 'macos-latest', 'macos-15-intel']) expect(wf).toContain(`os: ${os}`);
    expect(wf).toContain('xvfb-run');
    expect(wf).toContain('scripts/smoke.mjs');
    expect(wf).toContain("if: startsWith(github.ref, 'refs/tags/v')");
    expect(wf).toContain('case "$TAG" in *-*) PRE="--prerelease"');
  });

  it('[R91.18] la versión definitiva solo sale de main; las de prueba, de cualquier rama', () => {
    const wf = read('.github/workflows/release.yml');
    expect(wf).toContain("if: startsWith(github.ref, 'refs/tags/v') && !contains(github.ref_name, '-')");
    expect(wf).toContain('git merge-base --is-ancestor "$GITHUB_SHA" origin/main');
    expect(wf).toMatch(/build:\n {4}needs: origin/);
    for (const f of ['Orquestador-Windows-x64.exe', 'Orquestador-Linux-x86_64.AppImage', 'Orquestador-macOS-arm64.dmg', 'Orquestador-macOS-x64.dmg']) expect(wf).toContain(`out/${f}`);
  });

  it('[R91.16] firma y notarización con los secretos si existen; si no, macOS firma ad hoc y la release lo dice', async () => {
    const wf = read('.github/workflows/release.yml');
    for (const s of ['CSC_LINK', 'CSC_KEY_PASSWORD', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID']) expect(wf).toContain(`${s}: \${{ secrets.${s} }}`);
    expect(wf).toContain('sin firma');
    const { macIdentity, dropEmptySigning } = await script<{ macIdentity(e: Record<string, string>): string | undefined; dropEmptySigning(e: Record<string, string>): Record<string, string> }>('scripts/dist.mjs');
    // La CI pasa '' si no existe el secreto: se quita para que electron-builder no lo tome por una ruta.
    expect(dropEmptySigning({ CSC_LINK: '', CSC_KEY_PASSWORD: ' ', APPLE_ID: 'yo@x', PATH: '' })).toEqual({ APPLE_ID: 'yo@x', PATH: '' });
    expect(macIdentity({})).toBe('-');
    expect(macIdentity({ CSC_LINK: 'base64' })).toBeUndefined();
  });
});
