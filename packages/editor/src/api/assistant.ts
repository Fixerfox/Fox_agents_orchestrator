import { ASSISTANT_MAX_MESSAGES, ASSISTANT_MAX_TEXT, type AssistantEvent, type AssistantMessage } from '../assistant';
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
    default:
      return UNHANDLED;
  }
}
