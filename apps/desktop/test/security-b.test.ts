import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHANNELS } from '@orquestador/editor';
import { createDemoOrchestrator } from '@orquestador/runtime';
import { SettingsStore } from '@orquestador/store';
import { DesktopHandlers } from '../src/main/handlers';
import { openOutside, previewResponse } from '../src/main/preview-protocol';
import { PREVIEW_CSP } from '../src/main/window';

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'orq-sec-b-'));
});
afterEach(() => fs.rm(dir, { recursive: true, force: true }));

describe('SPEC-089 · vistas previas y abrir fuera', () => {
  it('[R89.9] la respuesta del protocolo lleva la CSP y nosniff, con el estado y el tipo del archivo', async () => {
    const seen: string[] = [];
    const r = await previewResponse(join(dir, 'index.html'), async (url) => (seen.push(url), new Response('<h1>hola</h1>', { status: 200, headers: { 'Content-Type': 'text/html' } })));
    expect(seen[0]).toMatch(/^file:\/\//);
    expect(r.status).toBe(200);
    expect(r.headers.get('Content-Security-Policy')).toBe(PREVIEW_CSP);
    expect(r.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(r.headers.get('Content-Type')).toBe('text/html');
    expect(await r.text()).toBe('<h1>hola</h1>');
    const missing = await previewResponse(undefined, async () => new Response(''));
    expect(missing.status).toBe(404);
    expect(missing.headers.get('Content-Security-Policy')).toBe(PREVIEW_CSP);
    expect(PREVIEW_CSP).not.toMatch(/connect-src[^;]*(https?:|\*)/);
  });

  it('[R89.10] abre documentos e imágenes; lo demás lo enseña en su carpeta', async () => {
    const shell = { openPath: vi.fn(async () => ''), showItemInFolder: vi.fn() };
    for (const f of ['a.html', 'b.PDF', 'c.png', 'd.md']) await openOutside(join(dir, f), shell);
    expect(shell.openPath).toHaveBeenCalledTimes(4);
    for (const f of ['x.bat', 'y.hta', 'z.lnk', 'w.exe', 'v.ps1', 'sin-extension']) await openOutside(join(dir, f), shell);
    expect(shell.openPath).toHaveBeenCalledTimes(4);
    expect(shell.showItemInFolder).toHaveBeenCalledTimes(6);
    await expect(openOutside(join(dir, 'a.html'), { openPath: async () => 'falló', showItemInFolder: () => undefined })).rejects.toThrow('falló');
  });
});

describe('SPEC-089 · ajustes dañados por IPC', () => {
  it('[R89.6] getSettings dice que se recuperaron y guardar quita la marca', async () => {
    const settings = new SettingsStore(join(dir, 'config'));
    await fs.mkdir(settings.dir, { recursive: true });
    await fs.writeFile(settings.file, 'roto');
    const h = new DesktopHandlers({ pickFolder: async () => null, createOrchestrator: createDemoOrchestrator, settings });
    const got = (await h.invoke(CHANNELS.getSettings, undefined)) as { ok: true; value: { recovered?: boolean; permissions?: string; apiKeyStored: boolean } };
    expect(got.value).toMatchObject({ recovered: true, permissions: 'ask' });
    const { recovered: _r, apiKeyStored: _k, ...plain } = got.value;
    void _r;
    void _k;
    const saved = (await h.invoke(CHANNELS.saveSettings, plain)) as { ok: true; value: { recovered?: boolean } };
    expect(saved.value.recovered).toBeUndefined();
    h.dispose();
  });
});
