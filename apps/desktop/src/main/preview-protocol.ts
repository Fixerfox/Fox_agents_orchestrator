import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PREVIEW_CSP } from './window';

/**
 * Respuesta del protocolo `orq-preview` con la CSP en la propia respuesta: no depende de que `onHeadersReceived` se
 * aplique a `protocol.handle` [R89.9].
 */
export async function previewResponse(abs: string | undefined, fetchFile: (url: string) => Promise<Response>): Promise<Response> {
  const secure = (h: Headers) => {
    h.set('Content-Security-Policy', PREVIEW_CSP);
    h.set('X-Content-Type-Options', 'nosniff');
    return h;
  };
  if (!abs) return new Response('No encontrado', { status: 404, headers: secure(new Headers({ 'Content-Type': 'text/plain; charset=utf-8' })) });
  const r = await fetchFile(pathToFileURL(abs).toString());
  return new Response(r.body, { status: r.status, headers: secure(new Headers(r.headers)) });
}

/** Lo que «Abrir fuera» abre con el programa del sistema; lo demás se enseña en su carpeta [R89.10]. */
export const OPEN_OUTSIDE_EXTENSIONS = ['html', 'htm', 'pdf', 'md', 'txt', 'csv', 'json', 'svg', 'png', 'jpg', 'jpeg', 'gif', 'webp'] as const;

/** «Abrir fuera» de una vista previa: documentos e imágenes con su programa; nada ejecutable [R89.10]. */
export async function openOutside(abs: string, shell: { openPath(p: string): Promise<string>; showItemInFolder(p: string): void }): Promise<void> {
  const ext = path.extname(abs).slice(1).toLowerCase();
  if (!(OPEN_OUTSIDE_EXTENSIONS as readonly string[]).includes(ext)) {
    shell.showItemInFolder(abs);
    return;
  }
  const err = await shell.openPath(abs);
  if (err) throw new Error(err);
}
