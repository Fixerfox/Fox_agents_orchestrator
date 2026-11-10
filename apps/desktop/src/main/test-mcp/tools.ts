import { ASSISTANT_TOOLS, CHANNELS, type ApiResult, type InvokeMethod } from '@orquestador/editor';
import type { TestTool, ToolParam, ToolResult } from './protocol';

/** Lo que las herramientas necesitan de la app: así se prueban sin Electron. */
export interface TestHost {
  /** El mismo camino que el IPC, con sus validaciones [R82.13]. */
  invoke(channel: string, payload?: unknown): Promise<ApiResult<unknown>>;
  /** Ejecuta algo en la interfaz y espera su respuesta, como mucho `timeoutMs` [R82.17]. */
  renderer(tool: string, args: Record<string, unknown>, timeoutMs: number): Promise<unknown>;
  /** PNG de la ventana en base64 [R82.12]. */
  screenshot(): Promise<string>;
  /** Rutas para el siguiente diálogo de archivos; vacío, cancelar [R82.11]. */
  queueDialog(paths: string[]): void;
  /** Últimos errores y avisos de la interfaz [R82.15]. */
  logs(limit: number): string[];
  /** Recarga la interfaz y espera a que esté lista [R82.16]. */
  reload(): Promise<void>;
  sleep(ms: number): Promise<void>;
}

/** Las acciones de la app que no tienen sentido sin una persona delante [R82.7]. */
export const EXCLUDED_APP_TOOLS: ReadonlySet<string> = new Set(['request_secret', 'ask_user', 'open_terminal']);
/** Métodos de la API que `call_api` no deja usar: las terminales [R90.12]. */
export const EXCLUDED_API_METHODS: ReadonlySet<string> = new Set(['terminalStart', 'terminalWrite', 'terminalResize', 'terminalKill']);
export const UI_TIMEOUT_MS = 60_000;
export const APP_TOOL_TIMEOUT_MS = 10 * 60_000;
export const WAIT_RUN_DEFAULT_MS = 60_000;
export const WAIT_RUN_MAX_MS = 10 * 60_000;
const POLL_MS = 500;

const str = (description: string, optional = false): ToolParam => ({ type: 'string', description, ...(optional ? { optional } : {}) });
const num = (description: string): ToolParam => ({ type: 'number', description, optional: true });
const bool = (description: string): ToolParam => ({ type: 'boolean', description, optional: true });
const text = (value: unknown): ToolResult => ({ text: value });
const clamp = (v: unknown, def: number, max: number) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.min(v, max) : def);

function unwrap<T>(r: ApiResult<T>): T {
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}

/** Herramientas del modo prueba: las acciones de la app y las de prueba [R82.7]–[R82.16]. */
export function testTools(host: TestHost): TestTool[] {
  const ui = (name: string, description: string, params: Record<string, ToolParam>, timeoutMs = UI_TIMEOUT_MS): TestTool => ({
    name,
    description,
    params,
    run: async (args) => text(await host.renderer(name, args, timeoutMs)),
  });

  // Las mismas acciones que el asistente, ejecutadas en la interfaz sin «Permitir» [R82.7].
  const app: TestTool[] = ASSISTANT_TOOLS.filter((t) => !EXCLUDED_APP_TOOLS.has(t.name)).map((t) => ({
    name: t.name,
    description: t.description,
    params: t.params,
    run: async (args) => text(await host.renderer(`app:${t.name}`, args, APP_TOOL_TIMEOUT_MS)),
  }));

  // Las terminales no se abren desde fuera, igual que open_terminal [R90.12].
  const methods = (Object.keys(CHANNELS) as InvokeMethod[]).filter((m) => !EXCLUDED_API_METHODS.has(m));
  const tools: TestTool[] = [
    ui('app_state', 'Estado de la app: pantalla (start o la sección), proyecto abierto, diagrama abierto, si el asistente está abierto y si hay una ejecución en marcha.', {}),
    ui(
      'ui_snapshot',
      'Lo que hay en pantalla: títulos y cada elemento con el que se puede interactuar (rol, nombre accesible y estado). Lo que está en un diálogo abierto va marcado. Úsalo antes de ui_click o ui_type.',
      {},
    ),
    ui('ui_click', 'Pulsa un elemento por su nombre accesible (primero coincidencia exacta sin distinguir mayúsculas, luego «contiene»). role e index desambiguan.', { name: str('Nombre accesible (texto del botón, aria-label…)'), role: str('Rol: button, link, tab, menuitem, checkbox, option…', true), index: num('Cuál, si hay varios (0 = el primero)') }),
    ui('ui_type', 'Escribe en un campo por su nombre accesible (etiqueta); sustituye su valor. Con submit pulsa Intro.', { label: str('Nombre accesible del campo'), text: str('Texto'), submit: bool('Pulsar Intro después') }),
    ui('ui_press', 'Pulsa una tecla en el elemento con foco (Enter, Escape, Tab, ArrowDown…).', { key: str('Tecla') }),
    ui('ui_wait', 'Espera a que un texto aparezca en pantalla (o desaparezca, con gone).', { text: str('Texto'), gone: bool('Esperar a que desaparezca'), timeoutMs: num('Milisegundos (5000 por defecto, 60000 como máximo)') }, UI_TIMEOUT_MS + 5_000),
    {
      name: 'open_project',
      description: 'Abre el proyecto de una carpeta (o lo crea, con create) como los botones de la pantalla de inicio. Usa una carpeta de pruebas, no un proyecto real.',
      params: { path: str('Ruta absoluta de la carpeta'), create: bool('Crear el proyecto en esa carpeta') },
      run: async (args) => {
        host.queueDialog([String(args['path'])]);
        return text(await host.renderer('open_project', { create: args['create'] === true }, UI_TIMEOUT_MS));
      },
    },
    {
      name: 'queue_dialog',
      description: 'El siguiente diálogo de archivos o carpetas de la app devuelve estas rutas sin enseñarse. Con una lista vacía, se cancela.',
      params: { paths: { type: 'string[]', description: 'Rutas absolutas' } },
      run: async (args) => {
        host.queueDialog(args['paths'] as string[]);
        return text('Listo: el siguiente diálogo devolverá esas rutas.');
      },
    },
    { name: 'screenshot', description: 'Captura de la ventana en PNG.', params: {}, run: async () => ({ image: { data: await host.screenshot(), mimeType: 'image/png' } }) },
    {
      name: 'call_api',
      description: `Llama a un método de la API de la interfaz por el mismo camino que el IPC y devuelve su resultado ({ ok, value } o { ok, error }). Lo que cambie así no se refresca solo en la interfaz. Métodos: ${methods.join(', ')}.`,
      params: { method: str('Nombre del método'), payload: { type: 'object', description: 'Argumento del método (si es un texto, envuélvelo en { value })', optional: true } },
      run: async (args) => {
        const method = String(args['method']) as InvokeMethod;
        if (!methods.includes(method)) throw new Error(`Método desconocido: ${method}`);
        const raw = args['payload'] as Record<string, unknown> | undefined;
        // Algunos métodos reciben un texto (p. ej. el id de una ejecución).
        const payload = raw && Object.keys(raw).length === 1 && 'value' in raw ? raw['value'] : raw;
        return text(await host.invoke(CHANNELS[method], payload));
      },
    },
    {
      name: 'wait_run',
      description: 'Espera a que una ejecución (por defecto, la más reciente) termine o quede esperando una respuesta. Devuelve su estado, el motivo y las preguntas pendientes.',
      params: { runId: str('Id de la ejecución', true), timeoutMs: num('Milisegundos (60000 por defecto, 600000 como máximo)') },
      run: async (args) => text(await waitRun(host, typeof args['runId'] === 'string' ? args['runId'] : undefined, clamp(args['timeoutMs'], WAIT_RUN_DEFAULT_MS, WAIT_RUN_MAX_MS))),
    },
    { name: 'logs', description: 'Últimos errores y avisos de la consola de la interfaz y cierres inesperados desde que arrancó.', params: { limit: num('Cuántos (50 por defecto, 200 como máximo)') }, run: async (args) => text(host.logs(clamp(args['limit'], 50, 200))) },
    {
      name: 'reload',
      description: 'Recarga la interfaz y espera a que vuelva a estar lista.',
      params: {},
      run: async () => {
        await host.reload();
        return text('Interfaz recargada.');
      },
    },
  ];
  return [...tools, ...app];
}

interface RunRow {
  runId: string;
  status: string;
  reason?: string;
  startedAt?: string;
}

/** Espera a que la ejecución termine o pregunte [R82.14]. */
async function waitRun(host: TestHost, runId: string | undefined, timeoutMs: number): Promise<unknown> {
  let waited = 0;
  for (;;) {
    const runs = unwrap(await host.invoke(CHANNELS.listRuns)) as RunRow[];
    const run = runId ? runs.find((r) => r.runId === runId) : [...runs].sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''))[0];
    if (!run) throw new Error(runId ? `No existe la ejecución ${runId}` : 'No hay ninguna ejecución');
    if (run.status !== 'running') return { runId: run.runId, status: run.status, ...(run.reason ? { reason: run.reason } : {}) };
    const questions = unwrap(await host.invoke(CHANNELS.pendingQuestions, run.runId)) as unknown[];
    if (questions.length > 0) return { runId: run.runId, status: 'waiting', questions };
    if (waited >= timeoutMs) return { runId: run.runId, status: 'running', timedOut: true };
    await host.sleep(POLL_MS);
    waited += POLL_MS;
  }
}
