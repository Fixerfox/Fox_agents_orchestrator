import { describe, expect, it, vi } from 'vitest';
import { CSP, isAllowedNavigation, isPreviewUrl, PREVIEW_CSP, parseWindowTone, secureWebContents, titleBarOverlay, TITLEBAR, TITLEBAR_HEIGHT, windowOptions, type SessionLike, type WebContentsLike } from '../src/main/window';

const APP = 'file:///opt/orquestador/renderer/index.html';

describe('ventana segura [R19.1]', () => {
  it('[R19.1] aislamiento de contexto y sandbox activados, sin integración de Node', () => {
    const { webPreferences: w } = windowOptions('/x/preload.cjs');
    expect(w).toMatchObject({
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      preload: '/x/preload.cjs',
    });
  });

  it('[R19.1] la CSP es restrictiva: sin recursos externos ni objetos', () => {
    expect(CSP).toContain("default-src 'self'");
    expect(CSP).toContain("script-src 'self'");
    expect(CSP).toContain("object-src 'none'");
    expect(CSP).toContain("frame-ancestors 'none'");
    expect(CSP).not.toMatch(/https?:|\*|unsafe-eval|script-src[^;]*unsafe-inline/);
  });

  it('[R19.1] solo se permite navegar a la propia app', () => {
    expect(isAllowedNavigation(APP, APP)).toBe(true);
    expect(isAllowedNavigation(APP + '#x', APP)).toBe(true);
    expect(isAllowedNavigation('https://evil.example/', APP)).toBe(false);
    expect(isAllowedNavigation('file:///etc/passwd', APP)).toBe(false);
    expect(isAllowedNavigation('javascript:alert(1)', APP)).toBe(false);
    expect(isAllowedNavigation('no es url', APP)).toBe(false);
  });

  it('[R19.1] deniega ventanas nuevas, bloquea navegación externa e inyecta la CSP', () => {
    let open: (() => { action: 'deny' }) | undefined;
    const listeners: Record<string, unknown> = {};
    let headers: Parameters<SessionLike['webRequest']['onHeadersReceived']>[0] | undefined;
    const wc: WebContentsLike = {
      setWindowOpenHandler: (h) => void (open = h),
      on: ((ev: string, l: unknown) => void (listeners[ev] = l)) as WebContentsLike['on'],
    };
    const nav = (e: { preventDefault(): void }, url: string) => (listeners['will-navigate'] as (e: { preventDefault(): void }, url: string) => void)(e, url);
    const session: SessionLike = { webRequest: { onHeadersReceived: (l) => void (headers = l) } };
    secureWebContents(wc, session, APP);

    expect(open!()).toEqual({ action: 'deny' });

    const blocked = { preventDefault: vi.fn() };
    nav(blocked, 'https://evil.example/');
    expect(blocked.preventDefault).toHaveBeenCalled();
    const allowed = { preventDefault: vi.fn() };
    nav(allowed, APP);
    expect(allowed.preventDefault).not.toHaveBeenCalled();

    const cb = vi.fn();
    headers!({ responseHeaders: { 'X-Test': ['1'] } }, cb);
    expect(cb).toHaveBeenCalledWith({ responseHeaders: { 'X-Test': ['1'], 'Content-Security-Policy': [CSP] } });
  });

  it('[R54.4] las vistas previas van en un marco del protocolo propio, con su política y sin salir de su copia', () => {
    const listeners: Record<string, unknown> = {};
    let headers: Parameters<SessionLike['webRequest']['onHeadersReceived']>[0] | undefined;
    const wc: WebContentsLike = { setWindowOpenHandler: () => {}, on: ((ev: string, l: unknown) => void (listeners[ev] = l)) as WebContentsLike['on'] };
    secureWebContents(wc, { webRequest: { onHeadersReceived: (l) => void (headers = l) } }, APP);
    expect(CSP).toContain('frame-src orq-preview:');
    expect(PREVIEW_CSP).toContain("connect-src 'none'");
    expect(PREVIEW_CSP).not.toMatch(/https?:/);
    const cb = vi.fn();
    headers!({ url: 'orq-preview://run/r1/imp/web/index.html', responseHeaders: {} }, cb);
    expect(cb).toHaveBeenCalledWith({ responseHeaders: { 'Content-Security-Policy': [PREVIEW_CSP] } });
    const frameNav = listeners['will-frame-navigate'] as (e: { preventDefault(): void; url: string; isMainFrame: boolean }) => void;
    const out = { preventDefault: vi.fn(), url: 'https://evil.example/', isMainFrame: false };
    frameNav(out);
    expect(out.preventDefault).toHaveBeenCalled();
    const within = { preventDefault: vi.fn(), url: 'orq-preview://run/r1/imp/web/otra.html', isMainFrame: false };
    frameNav(within);
    expect(within.preventDefault).not.toHaveBeenCalled();
    expect(isPreviewUrl('orq-preview://x')).toBe(true);
    expect(isPreviewUrl('file:///x')).toBe(false);
  });
});

describe('ventana propia [R19.8]', () => {
  it('[R19.8] sin barra de título ni menú del sistema; botones de ventana con los colores de la app', () => {
    const o = windowOptions('/p.cjs', 'win32');
    expect(o).toMatchObject({ titleBarStyle: 'hidden', autoHideMenuBar: true, titleBarOverlay: { height: TITLEBAR_HEIGHT, color: TITLEBAR.dark.color } });
    expect(windowOptions('/p.cjs', 'darwin')).not.toHaveProperty('titleBarOverlay');
    expect(titleBarOverlay('light')).toEqual({ color: '#ffffff', symbolColor: '#111827', height: 52 });
  });
  it('[R19.8] el tono solo admite claro u oscuro', () => {
    expect(parseWindowTone('dark')).toBe('dark');
    expect(parseWindowTone('light')).toBe('light');
    expect(parseWindowTone('#fff')).toBeUndefined();
    expect(parseWindowTone({})).toBeUndefined();
  });
});
