import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, safeStorage, session, shell } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { ASSISTANT_EVENTS_CHANNEL, CHANNELS, RUN_EVENTS_CHANNEL, TERMINAL_EVENTS_CHANNEL } from '@orquestador/editor';
import { sdkCreateAppServer, sdkQuery } from '@orquestador/claude';
import { ApiKeyVault, McpSecretVault, RecentStore, SettingsStore } from '@orquestador/store';
import { composeOrchestrator } from './composition';
import { DesktopHandlers } from './handlers';
import { TerminalService, type SpawnPty } from './terminal';
import { parseWindowTone, secureWebContents, titleBarOverlay, windowOptions, TITLEBAR, WINDOW_TONE_CHANNEL } from './window';

let mainWindow: BrowserWindow | undefined;

const dataDir = (): string => app.getPath('userData');
const cipher = {
  available: () => safeStorage.isEncryptionAvailable(),
  encrypt: (plain: string) => safeStorage.encryptString(plain),
  decrypt: (data: Buffer) => safeStorage.decryptString(data),
};
// node-pty se carga en tiempo de ejecución (módulo nativo, fuera del paquete) [R30.13]
const nativeImport = new Function('specifier', 'return import(specifier)') as (s: string) => Promise<{ spawn: SpawnPty; default?: { spawn: SpawnPty } }>;
const terminals = new TerminalService({
  loadPty: async () => {
    const mod = await nativeImport('@lydell/node-pty');
    return (mod.spawn ?? mod.default!.spawn) as SpawnPty;
  },
  // si no hay pseudoterminal, la terminal del sistema [R30.14]
  openExternal: ({ file, args, cwd, env, verbatim }) =>
    new Promise((resolve, reject) => {
      const child = spawn(file, args, { cwd, env, detached: true, stdio: 'ignore', windowsVerbatimArguments: verbatim === true });
      child.once('error', reject);
      child.once('spawn', () => {
        child.unref();
        resolve();
      });
    }),
  push: (id, event) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(TERMINAL_EVENTS_CHANNEL, { id, event });
  },
});

// Vistas previas de las webs que hacen los pasos: protocolo propio de solo lectura [R54.4]. Se registra antes de «ready».
protocol.registerSchemesAsPrivileged([{ scheme: 'orq-preview', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

const handlers = new DesktopHandlers({
  terminals,
  openFile: async (abs) => {
    const err = await shell.openPath(abs);
    if (err) throw new Error(err);
  },
  claudeQuery: sdkQuery,
  createOrchestrator: (ctx) => composeOrchestrator(ctx, sdkQuery),
  preinstallSpecKit: true,
  settings: new SettingsStore(join(dataDir(), 'config')),
  recents: new RecentStore(join(dataDir(), 'config')),
  vault: new ApiKeyVault(join(dataDir(), 'config'), cipher),
  mcpVault: new McpSecretVault(join(dataDir(), 'config'), cipher),
  appMcpDir: join(dataDir(), 'config', 'mcp'),
  createAppServer: sdkCreateAppServer,
  assistantProtectedDirs: [dataDir()],
  pushAssistant: (turnId, event) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(ASSISTANT_EVENTS_CHANNEL, { turnId, event });
  },
  push: (runId, events) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(RUN_EVENTS_CHANNEL, { runId, events });
  },
  async pickSkillFiles(kind) {
    const res = await dialog.showOpenDialog({
      title: kind === 'folder' ? 'Elige la carpeta de referencia' : 'Elige los archivos de referencia',
      properties: kind === 'folder' ? ['openDirectory'] : ['openFile', 'multiSelections'],
    });
    return res.canceled || res.filePaths.length === 0 ? null : res.filePaths;
  },
  async pickInputFiles(defaultPath) {
    const res = await dialog.showOpenDialog({
      title: defaultPath ? 'Elige archivos del proyecto para la entrada' : 'Adjunta archivos a la entrada',
      properties: ['openFile', 'multiSelections'],
      ...(defaultPath ? { defaultPath } : {}),
    });
    return res.canceled || res.filePaths.length === 0 ? null : res.filePaths;
  },
  async pickImport(kind) {
    const res = await dialog.showOpenDialog({
      title: kind === 'zip' ? 'Elige el archivo Zip con agentes o skills' : 'Elige la carpeta con agentes o skills',
      properties: kind === 'zip' ? ['openFile'] : ['openDirectory'],
      ...(kind === 'zip' ? { filters: [{ name: 'Zip', extensions: ['zip'] }] } : {}),
    });
    return res.canceled ? null : (res.filePaths[0] ?? null);
  },
  async pickFolder(purpose) {
    const res = await dialog.showOpenDialog({
      title: purpose === 'create' ? 'Elige o crea la carpeta del proyecto' : purpose === 'work' ? 'Elige la carpeta de trabajo de los agentes' : 'Abre la carpeta de un proyecto',
      properties: purpose === 'create' ? ['openDirectory', 'createDirectory'] : ['openDirectory'],
    });
    return res.canceled ? null : (res.filePaths[0] ?? null);
  },
});

function createWindow(): void {
  const win = new BrowserWindow(windowOptions(join(__dirname, 'preload.cjs')));
  mainWindow = win;
  const indexUrl = pathToFileURL(join(__dirname, 'renderer', 'index.html')).toString();
  secureWebContents(win.webContents, win.webContents.session, indexUrl, (url) => void shell.openExternal(url));
  win.once('ready-to-show', () => win.show());
  // Sin menú del sistema (File, Edit…) en Windows y Linux [R19.8].
  if (process.platform !== 'darwin') win.removeMenu();
  void win.loadURL(indexUrl);
}

// Los botones de ventana siguen el tema de la app [R19.8].
ipcMain.on(WINDOW_TONE_CHANNEL, (e, value: unknown) => {
  const tone = parseWindowTone(value);
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!tone || !win || win.isDestroyed()) return;
  win.setBackgroundColor(TITLEBAR[tone].color);
  if (process.platform !== 'darwin') win.setTitleBarOverlay(titleBarOverlay(tone));
});

app.whenReady().then(() => {
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null);
  for (const channel of Object.values(CHANNELS)) {
    ipcMain.handle(channel, (_event, payload: unknown) => handlers.invoke(channel, payload));
  }
  void session; // la política de contenido se fija por ventana en secureWebContents
  protocol.handle('orq-preview', async (req) => {
    const abs = await handlers.previewAsset(req.url);
    return abs ? net.fetch(pathToFileURL(abs).toString()) : new Response('No encontrado', { status: 404 });
  });
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  handlers.dispose();
  if (process.platform !== 'darwin') app.quit();
});
