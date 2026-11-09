import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, net, Notification, protocol, safeStorage, session, shell, Tray } from 'electron';
import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile, spawn } from 'node:child_process';
import { ASSISTANT_EVENTS_CHANNEL, CHANNELS, OPEN_RUN_CHANNEL, RUN_EVENTS_CHANNEL, TERMINAL_EVENTS_CHANNEL } from '@orquestador/editor';
import { sdkCreateAppServer, sdkQuery } from '@orquestador/claude';
import { ApiKeyVault, McpSecretVault, RecentStore, SettingsStore } from '@orquestador/store';
import { crashLine } from './crash';
import { Background } from './background';
import { cleanupSpaces, composeOrchestrator } from './composition';
import { DesktopHandlers } from './handlers';
import { TerminalService, type SpawnPty } from './terminal';
import { parseWindowTone, secureWebContents, titleBarOverlay, windowOptions, TITLEBAR, WINDOW_TONE_CHANNEL } from './window';
import { APP_USER_MODEL_ID, appIdRegistration } from './windows-app-id';

// Una sola instancia: abrir la app otra vez enseña la ventana que ya existe [R61.6].
if (!app.requestSingleInstanceLock()) app.exit(0);
let mainWindow: BrowserWindow | undefined;
let tray: Tray | undefined;
let trayBase: { open(): void; quit(): void } | undefined;
/** Electron suelta el aviso si nadie lo guarda, y entonces pulsarlo no hace nada [R61.11]. */
const notices = new Set<Notification>();
const ICON = join(__dirname, 'icon.png');

/** Deja constancia de lo que no se ve: si la interfaz se cae, nadie llega a leer su consola [R19.11]. */
const noteCrash = (what: string): void => {
  const dir = join(app.getPath('userData'), 'logs');
  void mkdir(dir, { recursive: true }).then(() => appendFile(join(dir, 'crash.log'), `${new Date().toISOString()} ${what}\n`)).catch(() => undefined);
};

// Sin identidad registrada, Windows descarta los avisos sin decir nada [R61.14].
if (process.platform === 'win32') {
  app.setAppUserModelId(APP_USER_MODEL_ID);
  for (const args of appIdRegistration(ICON)) execFile('reg', args, () => {});
}

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
  // Los espacios de las ramas en paralelo, en los datos de la app [R73.6].
  createOrchestrator: (ctx) => composeOrchestrator({ ...ctx, spacesRoot: join(dataDir(), 'spaces'), createAppServer: sdkCreateAppServer }, sdkQuery),
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
  watchRun: (event, diagram) => background.onRunEvent(event, diagram),
  offerInterrupted: (runs, act) => background.offerInterrupted(runs, act),
  memoryProposals: (n) => background.memoryProposals(n),
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

const background = new Background({
  window: () => mainWindow,
  createWindow,
  createTray({ open, quit }) {
    tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: process.platform === 'win32' ? 16 : 24 }));
    tray.setToolTip('Orquestador');
    trayBase = { open, quit };
    tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Abrir Orquestador', click: open }, { type: 'separator' }, { label: 'Salir', click: quit }]));
    tray.on('click', open);
  },
  // Las interrumpidas, con «Reanudar» y «Descartar» [R74.12].
  setTrayRuns(items) {
    if (!tray || !trayBase) return;
    const runs = items.map((i) => ({ label: i.label, submenu: [{ label: 'Reanudar', click: i.resume }, { label: 'Descartar', click: i.dismiss }] }));
    tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Abrir Orquestador', click: trayBase.open }, ...(runs.length > 0 ? [{ type: 'separator' as const }, ...runs] : []), { type: 'separator' }, { label: 'Salir', click: trayBase.quit }]));
  },
  notify({ title, body }, onClick) {
    if (!Notification.isSupported()) return;
    const notice = new Notification({ title, body, icon: ICON });
    const forget = () => void notices.delete(notice);
    notices.add(notice);
    notice.on('click', () => {
      forget();
      onClick();
    });
    notice.on('close', forget);
    notice.on('failed', forget);
    notice.show();
  },
  openRun(target) {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(OPEN_RUN_CHANNEL, target);
  },
  activeRuns: () => handlers.activeRuns(),
  async confirmQuit(active) {
    const { response } = await dialog.showMessageBox({
      type: 'warning',
      title: 'Salir de Orquestador',
      message: active === 1 ? 'Hay 1 ejecución en marcha o en cola.' : `Hay ${active} ejecuciones en marcha o en cola.`,
      detail: 'Si sales ahora se interrumpirán.',
      buttons: ['Salir', 'Seguir trabajando'],
      defaultId: 1,
      cancelId: 1,
    });
    return response === 0;
  },
  quit: () => app.quit(),
});

function createWindow(): void {
  const win = new BrowserWindow(windowOptions(join(__dirname, 'preload.cjs'), process.platform, ICON));
  mainWindow = win;
  win.on('close', (e) => background.onClose(e));
  // Al apagar o cerrar sesión, Windows no espera a una ventana que se niega a cerrarse [R61.5].
  win.on('session-end', () => background.onQuitting());
  const indexUrl = pathToFileURL(join(__dirname, 'renderer', 'index.html')).toString();
  secureWebContents(win.webContents, win.webContents.session, indexUrl, (url) => void shell.openExternal(url));
  win.once('ready-to-show', () => win.show());
  // Una interfaz caída deja la ventana vacía: se recarga y vuelve al proyecto [R19.11][R19.12].
  win.webContents.on('render-process-gone', (_e, details) => {
    noteCrash(`interfaz caída: ${details.reason} (${details.exitCode})`);
    if (details.reason !== 'clean-exit' && !win.isDestroyed()) win.reload();
  });
  win.on('unresponsive', () => noteCrash('la interfaz no responde'));
  // Un error al pintar también se apunta, con su traza [R19.12].
  win.webContents.on('console-message', (...args: unknown[]) => {
    const message = crashLine(args);
    if (message) noteCrash(message);
  });
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
  // Espacios de ramas que quedaron de un cierre inesperado [R73.18].
  void new RecentStore(join(dataDir(), 'config')).list().then((recent) => cleanupSpaces(join(dataDir(), 'spaces'), recent.map((r) => r.root)));
  // La bandeja es para Windows y Linux, los sistemas de la app.
  if (process.platform !== 'darwin') background.start();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('second-instance', () => background.open());
app.on('before-quit', () => background.onQuitting());

app.on('window-all-closed', () => {
  handlers.dispose();
  if (process.platform !== 'darwin') app.quit();
});
