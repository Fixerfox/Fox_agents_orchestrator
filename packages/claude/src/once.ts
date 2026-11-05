import { AgentError, type AppSettings } from '@orquestador/core';
import { baseOptions } from './connection';
import { explainThrown } from './errors';
import { MessageMapper } from './mapper';
import type { QueryFn } from './sdk-types';

export interface OnceArgs {
  query: QueryFn;
  settings: AppSettings;
  apiKey: string | undefined;
  cwd: string;
  system: string;
  prompt: string;
  signal?: AbortSignal;
}

/** Consulta de un solo turno, sin herramientas: devuelve el texto final o lanza `AgentError`. */
export async function askOnce(a: OnceArgs): Promise<{ text: string; ms: number; usage?: { inputTokens: number; outputTokens: number; costUsd?: number } }> {
  const start = Date.now();
  const controller = new AbortController();
  const abort = () => controller.abort();
  a.signal?.addEventListener('abort', abort, { once: true });
  if (a.signal?.aborted) controller.abort();
  const mapper = new MessageMapper(a.apiKey);
  try {
    const options = { ...baseOptions({ settings: a.settings, apiKey: a.apiKey, cwd: a.cwd, maxTurns: 1, controller, tools: false }), systemPrompt: a.system };
    let text: string | undefined;
    let usage: { inputTokens: number; outputTokens: number; costUsd?: number } | undefined;
    for await (const msg of a.query({ prompt: a.prompt, options })) {
      for (const ev of mapper.map(msg)) {
        if (ev.type === 'result') text = ev.text;
        // Tokens del turno, para el presupuesto de quien lo pida [R46.9].
        if (ev.type === 'usage') usage = { inputTokens: ev.inputTokens, outputTokens: ev.outputTokens, ...(ev.costUsd !== undefined ? { costUsd: ev.costUsd } : {}) };
      }
    }
    if (text === undefined) throw new AgentError('Claude no devolvió ninguna respuesta.', false);
    return { text, ms: Date.now() - start, ...(usage ? { usage } : {}) };
  } catch (e) {
    throw explainThrown(e, a.apiKey);
  } finally {
    a.signal?.removeEventListener('abort', abort);
  }
}

/** Extrae el primer objeto JSON de un texto, tolerando vallas de código y texto alrededor [R27.11]. */
export function extractJson(text: string): Record<string, unknown> | undefined {
  const start = text.indexOf('{');
  if (start < 0) return undefined;
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) {
      try {
        const v: unknown = JSON.parse(text.slice(start, i + 1));
        return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}
