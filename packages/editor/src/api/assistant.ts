import { ASSISTANT_MAX_MESSAGES, ASSISTANT_MAX_SAVED_ITEMS, ASSISTANT_MAX_TABS, ASSISTANT_MAX_TEXT, ASSISTANT_TAB_TITLE_MAX, type AssistantEvent, type AssistantMessage, type SavedAssistantTabs } from '../assistant';
import { UNHANDLED, isObject, safeId, type RequestCheck } from './check';
import { CHANNELS } from './contract';
import type { ApiResult } from './result';

export interface DraftRequest {
  kind: 'agent' | 'skill' | 'context';
  /** Lo que el usuario quiere, con sus palabras. */
  instruction: string;
  /** Borrador actual del formulario, si se quiere mejorar [R26.3]. */
  current?: Record<string, unknown>;
}

export interface DraftResult {
  fields: Record<string, unknown>;
  problems: { field: string; message: string }[];
  ms: number;
}

/** Asistente y redacción con Claude. */
export interface AssistantApi {
  /** Pide a Claude que redacte o mejore un agente o una skill; no guarda nada [R26.1][R26.2]. */
  draftWithClaude(req: DraftRequest): Promise<ApiResult<DraftResult>>;
  /** Asistente: lanza un turno con la conversación reciente; las respuestas llegan por `onAssistantEvents` [R29.4]. */
  assistantSend(req: { turnId: string; messages: AssistantMessage[] }): Promise<ApiResult<null>>;
  /** Resultado de una herramienta que ejecutó la interfaz [R29.2]. */
  assistantToolResult(req: { turnId: string; callId: string; ok: boolean; result: unknown }): Promise<ApiResult<boolean>>;
  assistantCancel(turnId: string): Promise<ApiResult<boolean>>;
  /** Pestañas guardadas del proyecto abierto; `null` sin proyecto o sin nada guardado [R86.11]. */
  assistantTabsLoad(): Promise<ApiResult<SavedAssistantTabs | null>>;
  /** Guarda las pestañas del proyecto abierto en la carpeta de datos de la app [R86.11]. */
  assistantTabsSave(doc: SavedAssistantTabs): Promise<ApiResult<null>>;
  onAssistantEvents(listener: (turnId: string, event: AssistantEvent) => void): () => void;
}

export function parseAssistantRequest(channel: string, payload: unknown, { bad, exact, str }: RequestCheck): unknown {
  switch (channel) {
    case CHANNELS.draftWithClaude: {
      if (!isObject(payload)) throw bad('se esperaba una petición');
      exact(payload, ['kind', 'instruction', 'current']);
      if (payload.kind !== 'agent' && payload.kind !== 'skill' && payload.kind !== 'context') throw bad('kind no válido');
      str(payload.instruction, 'instruction', 4000, 1);
      if (payload.current !== undefined) {
        if (!isObject(payload.current)) throw bad('current no válido');
        const allowed = payload.kind === 'agent' ? ['name', 'description', 'instructions', 'model', 'contextIds', 'skillIds'] : payload.kind === 'skill' ? ['name', 'description', 'body'] : ['name', 'value'];
        exact(payload.current, allowed);
        for (const [k, v] of Object.entries(payload.current)) {
          if (Array.isArray(v)) {
            if (v.length > 200 || !v.every(safeId)) throw bad(`${k} no válido`);
          } else str(v, k, 200_000);
        }
      }
      return payload;
    }
    case CHANNELS.assistantSend: {
      if (!isObject(payload)) throw bad('se esperaba un objeto');
      exact(payload, ['turnId', 'messages']);
      if (!safeId(payload.turnId)) throw bad('turnId no válido');
      const msgs = payload.messages;
      if (!Array.isArray(msgs) || msgs.length === 0 || msgs.length > ASSISTANT_MAX_MESSAGES) throw bad('mensajes no válidos');
      for (const m of msgs) {
        if (!isObject(m) || (m.role !== 'user' && m.role !== 'assistant')) throw bad('mensaje no válido');
        str(m.text, 'text', ASSISTANT_MAX_TEXT, 0);
      }
      return payload;
    }
    case CHANNELS.assistantToolResult: {
      if (!isObject(payload)) throw bad('se esperaba un objeto');
      exact(payload, ['turnId', 'callId', 'ok', 'result']);
      if (!safeId(payload.turnId) || !safeId(payload.callId)) throw bad('id no válido');
      if (typeof payload.ok !== 'boolean') throw bad('ok no válido');
      if (JSON.stringify(payload.result ?? null).length > 200_000) throw bad('resultado demasiado grande');
      return payload;
    }
    case CHANNELS.assistantCancel:
      if (!safeId(payload)) throw bad('turnId no válido');
      return payload;
    case CHANNELS.assistantTabsLoad:
      if (payload !== undefined && payload !== null) throw bad('no admite argumentos');
      return undefined;
    case CHANNELS.assistantTabsSave:
      checkSavedTabs(payload, { bad, exact, str });
      return payload;
    default:
      return UNHANDLED;
  }
}

const ITEM_KINDS = new Set(['user', 'assistant', 'tool', 'read', 'error']);
const TOOL_STATUSES = new Set(['running', 'ask', 'secret', 'choice', 'done', 'error', 'denied', 'undone']);
const SAVED_MAX_BYTES = 4_000_000;

/** Pestañas que se guardan: límites, ids seguros y elementos conocidos [R86.12]. */
function checkSavedTabs(payload: unknown, { bad, exact, str }: Pick<RequestCheck, 'bad' | 'exact' | 'str'>): void {
  if (!isObject(payload)) throw bad('se esperaba un objeto');
  exact(payload, ['activeId', 'tabs']);
  if (!safeId(payload.activeId)) throw bad('activeId no válido');
  if (JSON.stringify(payload).length > SAVED_MAX_BYTES) throw bad('pestañas demasiado grandes');
  const tabs = payload.tabs;
  if (!Array.isArray(tabs) || tabs.length > ASSISTANT_MAX_TABS) throw bad('pestañas no válidas');
  for (const tab of tabs) {
    if (!isObject(tab)) throw bad('pestaña no válida');
    exact(tab, ['id', 'title', 'updatedAt', 'items']);
    if (!safeId(tab.id)) throw bad('id de pestaña no válido');
    str(tab.title, 'title', ASSISTANT_TAB_TITLE_MAX, 0);
    if (typeof tab.updatedAt !== 'number' || !Number.isFinite(tab.updatedAt)) throw bad('updatedAt no válido');
    if (!Array.isArray(tab.items) || tab.items.length > ASSISTANT_MAX_SAVED_ITEMS) throw bad('elementos no válidos');
    for (const it of tab.items) {
      if (!isObject(it) || typeof it.kind !== 'string' || !ITEM_KINDS.has(it.kind)) throw bad('elemento no válido');
      if (!safeId(it.id)) throw bad('id de elemento no válido');
      if (it.kind === 'tool') {
        if (typeof it.status !== 'string' || !TOOL_STATUSES.has(it.status) || typeof it.name !== 'string' || !isObject(it.args)) throw bad('acción no válida');
      } else if (it.kind === 'read') {
        str(it.tool, 'tool', 200, 0);
        str(it.target, 'target', 2000, 0);
      } else str(it.text, 'text', ASSISTANT_MAX_TEXT, 0);
    }
  }
}
