import { mcpKey, type AppSettings, type McpServerDefinition } from '@orquestador/core';
import { buildEnv } from './connection';
import type { PermissionResult, QueryFn, SdkMcpServer } from './sdk-types';

/** Servidor listo para el SDK: definición más sus secretos (solo en el proceso principal) [R30.4]. */
export interface ResolvedMcp {
  def: McpServerDefinition;
  secrets: Record<string, string>;
}

/** Configuración del SDK: los secretos van como variables de entorno (comando) o cabeceras (web) [R30.4]. */
export function sdkMcpConfig(list: readonly ResolvedMcp[]): Record<string, SdkMcpServer> {
  const out: Record<string, SdkMcpServer> = {};
  for (const { def, secrets } of list) {
    if (!def.enabled) continue;
    const names = def.secretNames ?? [];
    const vals = Object.fromEntries(names.filter((n) => secrets[n] !== undefined).map((n) => [n, secrets[n]!]));
    out[mcpKey(def)] =
      def.transport === 'stdio'
        ? { type: 'stdio', command: def.command ?? '', ...(def.args && def.args.length > 0 ? { args: def.args } : {}), ...(Object.keys(vals).length > 0 ? { env: vals } : {}) }
        : { type: 'http', url: def.url ?? '', ...(Object.keys(vals).length > 0 ? { headers: vals } : {}) };
  }
  return out;
}

const ALLOW_ONCE = 'Permitir';
const ALLOW_RUN = 'Permitir en esta ejecución';
const DENY = 'Denegar';

/**
 * Permiso de las herramientas MCP (`mcp__<servidor>__<herramienta>`): los servidores de confianza no preguntan; los
 * demás preguntan en el chat del nodo y «Permitir en esta ejecución» vale para todo ese servidor [R30.4].
 */
export function createMcpPolicy(list: readonly ResolvedMcp[], ask: (q: { text: string; options: string[]; kind?: 'permission' }) => Promise<string>, opts: { noAsk?: boolean } = {}) {
  const byKey = new Map(list.filter((m) => m.def.enabled).map((m) => [mcpKey(m.def), m.def]));
  const allowed = new Set<string>();
  return async (tool: string, input: Record<string, unknown>): Promise<PermissionResult | undefined> => {
    const m = /^mcp__([^_]+(?:_[^_]+)*?)__(.+)$/.exec(tool);
    if (!m) return undefined;
    const def = byKey.get(m[1]!);
    if (!def) return { behavior: 'deny', message: `El servidor MCP ${m[1]} no está asignado a este agente.` };
    // Con «Sin preguntar nunca» tampoco preguntan los que no son de confianza [R51.2].
    if (def.trusted || opts.noAsk || allowed.has(m[1]!)) return { behavior: 'allow', updatedInput: input };
    const answer = (await ask({ text: `¿Puede usar «${m[2]}» del servidor MCP «${def.name}»?`, options: [ALLOW_ONCE, ALLOW_RUN, DENY], kind: 'permission' })).trim();
    if (answer === ALLOW_ONCE) return { behavior: 'allow', updatedInput: input };
    if (answer === ALLOW_RUN) {
      allowed.add(m[1]!);
      return { behavior: 'allow', updatedInput: input };
    }
    return { behavior: 'deny', message: answer && answer !== DENY ? `El usuario no lo permite y dice: ${answer}` : `El usuario no permite usar ${m[2]}.` };
  };
}

/**
 * «Probar conexión» de un servidor MCP: arranca el SDK solo con ese servidor y lee el mensaje de inicio (estado y
 * herramientas); se corta ahí, antes de llamar al modelo, así que no gasta tokens [R30.5].
 */
export async function testMcpServer(args: { query: QueryFn; server: ResolvedMcp; settings: AppSettings; apiKey: string | undefined; cwd: string; timeoutMs?: number }): Promise<{ ok: boolean; message: string; tools: string[]; ms: number }> {
  const started = Date.now();
  const key = mcpKey(args.server.def);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), args.timeoutMs ?? 20_000);
  try {
    const options = {
      cwd: args.cwd,
      maxTurns: 1,
      tools: [],
      allowedTools: [],
      permissionMode: 'default' as const,
      abortController: controller,
      env: buildEnv(args.settings, args.apiKey),
      settingSources: [],
      persistSession: false,
      mcpServers: sdkMcpConfig([{ ...args.server, def: { ...args.server.def, enabled: true } }]),
      canUseTool: async () => ({ behavior: 'deny' as const, message: 'Solo es una prueba de conexión' }),
    };
    for await (const msg of args.query({ prompt: 'ping', options })) {
      if (msg.type === 'system' && msg.subtype === 'init') {
        const status = msg.mcp_servers?.find((s) => s.name === key)?.status ?? 'desconocido';
        const tools = (msg.tools ?? []).filter((t) => t.startsWith(`mcp__${key}__`)).map((t) => t.slice(`mcp__${key}__`.length));
        controller.abort();
        const ok = status === 'connected';
        return { ok, message: ok ? `«${args.server.def.name}» responde con ${tools.length} herramienta(s).` : `«${args.server.def.name}» no arranca (estado: ${status}). Revisa el comando y los secretos.`, tools, ms: Date.now() - started };
      }
    }
    return { ok: false, message: 'Claude no informó del estado del servidor.', tools: [], ms: Date.now() - started };
  } catch (e) {
    const aborted = controller.signal.aborted;
    return { ok: false, message: aborted ? 'El servidor tardó demasiado en responder.' : e instanceof Error ? e.message : String(e), tools: [], ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}
