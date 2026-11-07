/** Seguridad de la ventana [R19.1]. Todo es puro o recibe interfaces mínimas para poder probarse sin Electron. */

export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  // Las vistas previas de webs van en un marco aislado servido por el protocolo propio [R54.4].
  "frame-src orq-preview:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

/**
 * Política de las webs previsualizadas: solo lo de su copia (y datos en línea), sin red, formularios ni salir del
 * marco [R54.4].
 */
export const PREVIEW_CSP = [
  'default-src orq-preview: data: blob:',
  "script-src orq-preview: 'unsafe-inline'",
  "style-src orq-preview: 'unsafe-inline' data:",
  'img-src orq-preview: data: blob:',
  'font-src orq-preview: data:',
  'media-src orq-preview: data: blob:',
  "connect-src 'none'",
  "form-action 'none'",
  'base-uri orq-preview:',
].join('; ');

/** ¿Es una dirección del protocolo de vistas previas? [R54.4] */
export const isPreviewUrl = (url: string): boolean => url.startsWith('orq-preview:');

export interface SecureWebPreferences {
  contextIsolation: true;
  sandbox: true;
  nodeIntegration: false;
  webSecurity: true;
  allowRunningInsecureContent: false;
  preload: string;
}

export function windowOptions(preload: string, platform: string = process.platform, icon?: string) {
  const webPreferences: SecureWebPreferences = {
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
    preload,
  };
  return {
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Orquestador',
    show: false,
    ...(icon ? { icon } : {}),
    // Ventana propia: sin barra de título ni menú del sistema; la barra superior de la app hace de barra de título [R19.8].
    titleBarStyle: 'hidden' as const,
    autoHideMenuBar: true,
    backgroundColor: TITLEBAR.dark.color,
    ...(platform === 'darwin' ? {} : { titleBarOverlay: titleBarOverlay('dark') }),
    webPreferences,
  };
}

/** Alto de la barra superior de la app (y de los botones de ventana dibujados encima) [R19.8]. */
export const TITLEBAR_HEIGHT = 52;
/** Colores de los botones minimizar/maximizar/cerrar: los de la barra superior de cada tema [R19.8]. */
export const TITLEBAR = {
  light: { color: '#ffffff', symbolColor: '#111827' },
  dark: { color: '#07080d', symbolColor: '#eef0f5' },
} as const;
export type WindowTone = keyof typeof TITLEBAR;

export function titleBarOverlay(tone: WindowTone) {
  return { ...TITLEBAR[tone], height: TITLEBAR_HEIGHT };
}

/** Lo que manda el renderer al cambiar de tema; cualquier otra cosa se ignora [R19.8]. */
export function parseWindowTone(value: unknown): WindowTone | undefined {
  return value === 'light' || value === 'dark' ? value : undefined;
}

/** Canal de una sola dirección (renderer → proceso principal) para el tono de la ventana. */
export const WINDOW_TONE_CHANNEL = 'window:tone';

/** Solo se permite navegar dentro de la propia app (file:// de la carpeta de la interfaz). */
export function isAllowedNavigation(url: string, appUrl: string): boolean {
  try {
    const target = new URL(url);
    const app = new URL(appUrl);
    return target.protocol === 'file:' && app.protocol === 'file:' && target.pathname === app.pathname;
  } catch {
    return false;
  }
}

export interface WebContentsLike {
  setWindowOpenHandler(handler: (details: { url: string }) => { action: 'deny' }): void;
  on(event: 'will-navigate', listener: (e: { preventDefault(): void }, url: string) => void): void;
  /** Navegación dentro de un marco (la vista previa) [R54.4]. */
  on(event: 'will-frame-navigate', listener: (e: { preventDefault(): void; url: string; isMainFrame: boolean }) => void): void;
}
export interface SessionLike {
  webRequest: {
    onHeadersReceived(
      listener: (
        details: { url?: string; responseHeaders?: Record<string, string[]> },
        callback: (r: { responseHeaders: Record<string, string[]> }) => void,
      ) => void,
    ): void;
  };
}

/** Lo único que sale al navegador: la dirección de una PR o un merge request [R58.15]. */
export const isReviewUrl = (url: string): boolean => /^https:\/\/[^\s/]+\/[^\s?#]+\/(?:pull|pull-requests|-\/merge_requests)\/\d+$/.test(url);

/** Bloquea ventanas nuevas y navegación externa, e impone la política de contenido. */
export function secureWebContents(wc: WebContentsLike, session: SessionLike, appUrl: string, openLink: (url: string) => void = () => {}): void {
  wc.setWindowOpenHandler(({ url }) => {
    if (isReviewUrl(url)) openLink(url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (e, url) => {
    if (!isAllowedNavigation(url, appUrl)) e.preventDefault();
  });
  // Un marco de vista previa no puede irse a otra web; solo moverse dentro de su copia [R54.4].
  wc.on('will-frame-navigate', (e) => {
    if (!e.isMainFrame && !isPreviewUrl(e.url) && e.url !== 'about:blank') e.preventDefault();
  });
  session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: { ...(details.responseHeaders ?? {}), 'Content-Security-Policy': [isPreviewUrl(details.url ?? '') ? PREVIEW_CSP : CSP] },
    });
  });
}
