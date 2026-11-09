/** Protocolo MCP del modo prueba: JSON-RPC 2.0 con respuestas JSON, sin streaming [R82.4]. Puro: no abre nada. */

export type JsonSchemaType = 'string' | 'number' | 'boolean' | 'string[]' | 'object';
export interface ToolParam {
  type: JsonSchemaType;
  description: string;
  optional?: boolean;
}

/** Lo que devuelve una herramienta: texto (lo que no sea texto se pasa a JSON) o una imagen [R82.12]. */
export type ToolResult = { text: unknown } | { image: { data: string; mimeType: string } };

export interface TestTool {
  name: string;
  description: string;
  params: Record<string, ToolParam>;
  run(args: Record<string, unknown>): Promise<ToolResult>;
}

export const SERVER_NAME = 'orquestador-test';
/** Versiones del protocolo que se conocen, de la más reciente a la más antigua. */
export const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const;

export const RPC = { parse: -32700, invalid: -32600, method: -32601, params: -32602, internal: -32603 } as const;

type Id = string | number | null;
interface Request {
  jsonrpc?: unknown;
  id?: Id;
  method?: unknown;
  params?: unknown;
}
export type RpcResponse = { jsonrpc: '2.0'; id: Id; result: unknown } | { jsonrpc: '2.0'; id: Id; error: { code: number; message: string } };

const error = (id: Id, code: number, message: string): RpcResponse => ({ jsonrpc: '2.0', id, error: { code, message } });
const result = (id: Id, value: unknown): RpcResponse => ({ jsonrpc: '2.0', id, result: value });

/** JSON Schema de los parámetros de una herramienta [R82.4]. */
export function inputSchema(params: Record<string, ToolParam>): { type: 'object'; properties: Record<string, unknown>; required: string[]; additionalProperties: false } {
  const properties = Object.fromEntries(
    Object.entries(params).map(([k, p]) => [k, p.type === 'string[]' ? { type: 'array', items: { type: 'string' }, description: p.description } : { type: p.type, description: p.description }]),
  );
  return { type: 'object', properties, required: Object.entries(params).filter(([, p]) => !p.optional).map(([k]) => k), additionalProperties: false };
}

/** Problemas de unos argumentos frente a los parámetros, o nada si cumplen [R82.4]. */
export function checkArgs(params: Record<string, ToolParam>, args: unknown): string | undefined {
  if (args !== undefined && (typeof args !== 'object' || args === null || Array.isArray(args))) return 'Los argumentos deben ser un objeto';
  const a = (args ?? {}) as Record<string, unknown>;
  for (const k of Object.keys(a)) if (!(k in params)) return `Parámetro desconocido: ${k}`;
  for (const [k, p] of Object.entries(params)) {
    const v = a[k];
    if (v === undefined) {
      if (!p.optional) return `Falta el parámetro ${k}`;
      continue;
    }
    const okType =
      p.type === 'string[]' ? Array.isArray(v) && v.every((x) => typeof x === 'string') : p.type === 'object' ? typeof v === 'object' && v !== null && !Array.isArray(v) : typeof v === p.type;
    if (!okType) return `${k} debe ser ${p.type}`;
  }
  return undefined;
}

const content = (r: ToolResult) =>
  'image' in r ? [{ type: 'image', data: r.image.data, mimeType: r.image.mimeType }] : [{ type: 'text', text: typeof r.text === 'string' ? r.text : JSON.stringify(r.text, null, 2) }];

async function one(msg: Request, tools: readonly TestTool[]): Promise<RpcResponse | undefined> {
  const isNotification = !('id' in msg) || msg.id === undefined;
  const id: Id = isNotification ? null : (msg.id ?? null);
  if (msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return isNotification ? undefined : error(id, RPC.invalid, 'Petición JSON-RPC no válida');
  // Las notificaciones no tienen respuesta [R82.4].
  if (isNotification) return undefined;
  const params = (msg.params ?? {}) as Record<string, unknown>;
  switch (msg.method) {
    case 'initialize': {
      const asked = typeof params['protocolVersion'] === 'string' ? params['protocolVersion'] : undefined;
      const protocolVersion = asked && (PROTOCOL_VERSIONS as readonly string[]).includes(asked) ? asked : PROTOCOL_VERSIONS[0];
      return result(id, { protocolVersion, capabilities: { tools: {} }, serverInfo: { name: SERVER_NAME, version: '1.0.0' } });
    }
    case 'ping':
      return result(id, {});
    case 'tools/list':
      return result(id, { tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: inputSchema(t.params) })) });
    case 'tools/call': {
      const tool = tools.find((t) => t.name === params['name']);
      if (!tool) return error(id, RPC.params, `Herramienta desconocida: ${String(params['name'])}`);
      const problem = checkArgs(tool.params, params['arguments']);
      if (problem) return error(id, RPC.params, problem);
      try {
        return result(id, { content: content(await tool.run((params['arguments'] ?? {}) as Record<string, unknown>)) });
      } catch (e) {
        // Un fallo de la herramienta es un resultado con error, no un error del protocolo [R82.4].
        return result(id, { content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }], isError: true });
      }
    }
    default:
      return error(id, RPC.method, `Método desconocido: ${msg.method}`);
  }
}

/** Atiende un mensaje o un lote; `undefined` si solo había notificaciones [R82.4]. */
export async function handleMcp(message: unknown, tools: readonly TestTool[]): Promise<RpcResponse | RpcResponse[] | undefined> {
  if (Array.isArray(message)) {
    if (message.length === 0) return error(null, RPC.invalid, 'Lote vacío');
    const out = (await Promise.all(message.map((m) => one((m ?? {}) as Request, tools)))).filter((r): r is RpcResponse => r !== undefined);
    return out.length > 0 ? out : undefined;
  }
  if (typeof message !== 'object' || message === null) return error(null, RPC.invalid, 'Petición JSON-RPC no válida');
  return one(message as Request, tools);
}
