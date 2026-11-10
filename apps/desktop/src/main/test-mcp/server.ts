import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { dirname } from 'node:path';
import { RPC, handleMcp, type TestTool } from './protocol';

export const DEFAULT_TEST_PORT = 47321;
/** Carpeta de datos del modo prueba, junto a la normal [R82.2]. */
export const TEST_DATA_FOLDER = 'Orquestador-test';
/** Más de esto en una petición no es una llamada de herramienta. */
const MAX_BODY = 5 * 1024 * 1024;

/** ¿Arranca en modo prueba, y en qué puerto? Nunca en la app empaquetada [R82.1]. */
export function testMode(argv: readonly string[], packaged: boolean): { port: number } | undefined {
  if (packaged || !argv.includes('--test-mcp')) return undefined;
  const raw = argv.find((a) => a.startsWith('--test-mcp-port='))?.split('=')[1];
  const port = raw !== undefined && /^\d+$/.test(raw) && Number(raw) > 0 && Number(raw) < 65536 ? Number(raw) : DEFAULT_TEST_PORT;
  return { port };
}

/** El token del modo prueba: se crea una vez y se guarda con la dirección [R82.6]. */
export async function loadToken(file: string, url: string): Promise<string> {
  const saved = await readFile(file, 'utf8').then((t) => JSON.parse(t) as { token?: unknown }, () => undefined);
  const token = typeof saved?.token === 'string' && saved.token.length >= 32 ? saved.token : randomBytes(24).toString('hex');
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify({ url, token }, null, 2)}\n`, { mode: 0o600 });
  return token;
}

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

function send(res: ServerResponse, status: number, body?: unknown): void {
  if (body === undefined) {
    res.writeHead(status).end();
    return;
  }
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string | undefined> {
  return new Promise((resolve) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        resolve(undefined);
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => resolve(undefined));
  });
}

/** Atiende una petición HTTP del modo prueba [R82.5]. */
export async function serveMcp(req: IncomingMessage, res: ServerResponse, token: string, tools: () => readonly TestTool[]): Promise<void> {
  const path = (req.url ?? '').split('?')[0];
  if (path !== '/mcp') return send(res, 404, { error: 'No encontrado' });
  // Un navegador siempre manda Origin: ninguna web puede hablar con el modo prueba [R82.5].
  if (req.headers.origin !== undefined) return send(res, 403, { error: 'Origen no permitido' });
  const auth = req.headers.authorization ?? '';
  if (!auth.startsWith('Bearer ') || !same(auth.slice(7), token)) return send(res, 401, { error: 'Falta el token del modo prueba' });
  if (req.method !== 'POST') {
    res.setHeader('allow', 'POST');
    return send(res, 405, { error: 'Solo POST' });
  }
  const raw = await readBody(req);
  let message: unknown;
  try {
    if (raw === undefined) throw new Error('too big');
    message = JSON.parse(raw);
  } catch {
    return send(res, 200, { jsonrpc: '2.0', id: null, error: { code: RPC.parse, message: 'El cuerpo no es JSON válido' } });
  }
  const out = await handleMcp(message, tools());
  // Solo notificaciones: aceptado y sin cuerpo [R82.5].
  if (out === undefined) return send(res, 202);
  send(res, 200, out);
}

/** Arranca el servidor en 127.0.0.1; si el puerto está ocupado, lo rechaza [R82.5][R82.6]. */
export function startTestServer(port: number, token: string, tools: () => readonly TestTool[]): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      void serveMcp(req, res, token, tools).catch(() => {
        if (!res.headersSent) send(res, 500, { error: 'Error interno' });
      });
    });
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(server);
    });
  });
}
