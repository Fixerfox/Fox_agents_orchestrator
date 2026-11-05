import type { AppSettings } from '@orquestador/core';
import { assistantGuardHook, assistantToolPolicy, ASSISTANT_GUARD_MATCHER, isAssistantShownTool, readTargetOf } from './assistant-read';
import { buildEnv, settingSourcesFor } from './connection';
import { explainThrown } from './errors';
import { MessageMapper } from './mapper';
import type { PermissionResult, QueryFn } from './sdk-types';

/** Una herramienta tal como la recibe el servidor MCP en proceso [R29.1]. */
export interface AppToolDef {
  name: string;
  description: string;
  params: Record<string, { type: 'string' | 'number' | 'boolean' | 'string[]'; description: string; optional?: boolean }>;
  handler: (args: Record<string, unknown>) => Promise<{ content: { type: 'text'; text: string }[]; isError?: boolean }>;
}

/** Crea la configuración del servidor MCP en proceso; el real usa el SDK y los tests una imitación [R29.4]. */
export type CreateAppServer = (name: string, tools: AppToolDef[]) => Promise<unknown>;

export type AssistantTurnEvent =
  | { type: 'text'; text: string }
  | { type: 'tool'; callId: string; name: string; args: Record<string, unknown> }
  /** Una herramienta del sistema: solo el nombre del archivo, el patrón, el dominio o el comando [R29.9][R50.9]. */
  | { type: 'read'; tool: string; target: string; ok: boolean }
  | { type: 'done'; text: string; usage?: { inputTokens: number; outputTokens: number; costUsd: number } }
  | { type: 'error'; message: string };

export const ASSISTANT_SYSTEM_PROMPT = [
  'Eres el asistente de Orquestador, una aplicación de escritorio para orquestar agentes de IA con diagramas.',
  'Conceptos: un agente tiene nombre, «para qué sirve», instrucciones, modelo, skills (pasos reutilizables), contextos (lo que debe saber) y servidores MCP (herramientas externas).',
  'Un diagrama va de Entrada a Salida; cada paso de agente tiene su propia tarea; un router decide el camino; un bucle repite; varios pasos que salen del mismo trabajan a la vez y el siguiente espera a todos.',
  'Actúas sobre el proyecto solo con las herramientas mcp__orquestador__*: consulta antes de cambiar, usa ids reales y no inventes agentes ni skills que no existan (créalos si hace falta).',
  'Tienes todas las herramientas de Claude Code y ninguna pide permiso: lee, busca, escribe y edita archivos de cualquier carpeta del equipo (también fuera del proyecto, p. ej. C:\\Users\\…), ejecuta comandos con Bash (instalar dependencias, compilar, probar), lanza subagentes y consulta la web. Para lo que tenga que iniciar sesión o ser interactivo, ofrece open_terminal.',
  'Los agentes, skills, contextos, MCP, diagramas y ejecuciones del proyecto se cambian SIEMPRE con las herramientas mcp__orquestador__*, nunca editando .orquestador a mano (ni con Bash): así la interfaz se mantiene al día y se respeta el cerrojo de las ejecuciones. La carpeta de datos de la app tampoco se toca. Si te dan una carpeta, míralo tú antes de preguntar.',
  'Borrar, ejecutar, probar un servidor MCP y abrir la terminal piden permiso al usuario: si te lo deniega, no insistas y propón otra cosa.',
  'Para dar de alta un servidor MCP: averigua cómo se arranca (comando y argumentos o dirección web; si te dan su carpeta, léela; si es un paquete conocido, búscalo; pregunta solo si aun así no lo sabes), créalo con create_mcp poniendo solo los NOMBRES de sus secretos, pide cada valor con request_secret, pruébalo con test_mcp y asígnalo con assign_mcp al agente o al paso. Pregunta si lo quiere solo en este proyecto o en todos (scope).',
  'Nunca pidas que te escriban un token o una clave en el chat: usa request_secret. Si aun así lo escriben, no lo repitas ni lo pongas en ninguna herramienta. Si el servidor necesita iniciar sesión o instalar algo, ofrece open_terminal.',
  'Para preguntas cerradas (qué servicio, en qué ámbito, qué tipo, confirmar) usa ask_user con botones, de una en una; no hagas listas numeradas de preguntas.',
  'El usuario puede estar en cualquier pantalla de la app; lo que creas aparece al momento en su lista.',
  'Para saber cómo fue una ejecución (si terminó, qué hizo cada paso, por qué falló, qué archivos tocó) usa list_runs y get_run; no supongas el resultado a partir del diagrama.',
  'Responde siempre en español, breve y claro, con Markdown sencillo (negrita, listas, `código`), y di qué has cambiado.',
].join('\n');

const MAX_HISTORY_CHARS = 60_000;

/** Mensaje del turno: la conversación reciente y la petición nueva al final [R29.4]. */
export function buildAssistantPrompt(messages: readonly { role: 'user' | 'assistant'; text: string }[]): string {
  const last = messages[messages.length - 1];
  const before = messages.slice(0, -1);
  let history = before.map((m) => `${m.role === 'user' ? 'Usuario' : 'Asistente'}: ${m.text}`).join('\n\n');
  if (history.length > MAX_HISTORY_CHARS) history = `…${history.slice(-MAX_HISTORY_CHARS)}`;
  return history ? `Conversación hasta ahora:\n${history}\n\nPetición nueva del usuario:\n${last?.text ?? ''}` : (last?.text ?? '');
}

/**
 * Un turno del asistente: el SDK solo ve las herramientas de la app; cada llamada se reenvía a la interfaz y se
 * espera su respuesta; el texto se emite según llega [R29.4].
 */
export async function runAssistantTurn(args: {
  query: QueryFn;
  createServer: CreateAppServer;
  tools: readonly Omit<AppToolDef, 'handler'>[];
  messages: readonly { role: 'user' | 'assistant'; text: string }[];
  settings: AppSettings;
  apiKey: string | undefined;
  cwd: string;
  /** Carpetas que el asistente nunca lee, como la de datos de la app [R29.8]. */
  protectedDirs?: readonly string[];
  signal: AbortSignal;
  emit: (e: AssistantTurnEvent) => void;
  /** Ejecuta la herramienta en la interfaz y devuelve su resultado. */
  callTool: (callId: string, name: string, input: Record<string, unknown>) => Promise<{ ok: boolean; result: unknown }>;
  newId: () => string;
}): Promise<void> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  args.signal.addEventListener('abort', abort, { once: true });
  const server = 'orquestador';
  const allowed = args.tools.map((t) => `mcp__${server}__${t.name}`);
  const defs: AppToolDef[] = args.tools.map((t) => ({
    ...t,
    handler: async (input) => {
      const callId = args.newId();
      args.emit({ type: 'tool', callId, name: t.name, args: input });
      const r = await args.callTool(callId, t.name, input);
      return { content: [{ type: 'text', text: JSON.stringify(r.result ?? null) }], ...(r.ok ? {} : { isError: true }) };
    },
  }));
  const policy = assistantToolPolicy({ appTools: allowed, protectedDirs: args.protectedDirs ?? [], cwd: args.cwd });
  /** Herramientas en curso, por nombre y en orden, para avisar cuando llega su resultado [R29.9][R50.9]. */
  const reading = new Map<string, string[]>();
  const mapper = new MessageMapper(args.apiKey);
  let text = '';
  let usage: { inputTokens: number; outputTokens: number; costUsd: number } | undefined;
  try {
    const instance = await args.createServer(server, defs);
    const options = {
      model: args.settings.defaultModel,
      cwd: args.cwd,
      maxTurns: 100,
      // Todas las de Claude Code; pregunta con ask_user, no con AskUserQuestion [R50.7].
      tools: { type: 'preset' as const, preset: 'claude_code' as const },
      disallowedTools: ['AskUserQuestion'],
      allowedTools: [...allowed],
      permissionMode: 'default' as const,
      // Nada pide permiso salvo la protección de la app [R50.8].
      canUseTool: async (tool: string, input: Record<string, unknown>): Promise<PermissionResult> => policy(tool, input),
      // El gancho corre antes que cualquier regla de permisos de `.claude` [R50.8].
      hooks: { PreToolUse: [{ matcher: ASSISTANT_GUARD_MATCHER, hooks: [assistantGuardHook(policy)] }] },
      abortController: controller,
      env: buildEnv(args.settings, args.apiKey),
      settingSources: settingSourcesFor(args.settings),
      persistSession: false,
      systemPrompt: { type: 'preset' as const, preset: 'claude_code' as const, append: ASSISTANT_SYSTEM_PROMPT },
      mcpServers: { [server]: instance as never },
    };
    let result: string | undefined;
    for await (const msg of args.query({ prompt: buildAssistantPrompt(args.messages), options })) {
      if (args.signal.aborted) break;
      for (const ev of mapper.map(msg)) {
        if (ev.type === 'tool_call' && isAssistantShownTool(ev.tool)) {
          reading.set(ev.tool, [...(reading.get(ev.tool) ?? []), readTargetOf(ev.tool, ev.input)]);
        } else if (ev.type === 'tool_result' && isAssistantShownTool(ev.tool)) {
          const queue = reading.get(ev.tool) ?? [];
          args.emit({ type: 'read', tool: ev.tool, target: queue.shift() ?? '', ok: ev.ok });
          reading.set(ev.tool, queue);
        } else if (ev.type === 'token') {
          text += ev.text;
          args.emit({ type: 'text', text: ev.text });
        } else if (ev.type === 'usage') usage = { inputTokens: ev.inputTokens, outputTokens: ev.outputTokens, costUsd: ev.costUsd ?? 0 };
        else if (ev.type === 'result') result = ev.text;
      }
    }
    if (args.signal.aborted) return args.emit({ type: 'error', message: 'Detenido.' });
    args.emit({ type: 'done', text: result ?? text, ...(usage ? { usage } : {}) });
  } catch (e) {
    if (args.signal.aborted) return args.emit({ type: 'error', message: 'Detenido.' });
    args.emit({ type: 'error', message: explainThrown(e, args.apiKey).message });
  } finally {
    args.signal.removeEventListener('abort', abort);
  }
}
