import { AgentError, type AgentStreamEvent } from '@orquestador/core';
import { explainAssistantError, explainResult, scrub } from './errors';
import type { SdkMessage } from './sdk-types';

interface Block {
  type?: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
}

const MAX_OUTPUT = 4000;

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((c) => (c && typeof c === 'object' && 'text' in c ? String((c as Block).text ?? '') : '')).join('');
  return '';
}

/** Traduce mensajes del SDK en eventos del orquestador, recordando qué herramienta es cada resultado [R27.5][R27.6]. */
export class MessageMapper {
  private readonly tools = new Map<string, string>();
  constructor(
    private readonly secret?: string,
    /** Presupuesto del intento, para decirlo si se pasa [R77.9]. */
    private readonly maxBudgetUsd?: number,
  ) {}

  /** El uso de un resultado, aunque sea un error: lo gastado cuenta igual [R77.9]. */
  usageOf(msg: SdkMessage): AgentStreamEvent[] {
    if (msg.type !== 'result' || !msg.usage) return [];
    return [usageEvent(msg)];
  }

  map(msg: SdkMessage): AgentStreamEvent[] {
    if (msg.type === 'assistant') {
      if (msg.error) throw explainAssistantError(msg.error);
      const out: AgentStreamEvent[] = [];
      for (const b of asBlocks(msg.message?.content)) {
        if (b.type === 'text' && b.text) out.push({ type: 'token', text: scrub(b.text, this.secret) });
        else if (b.type === 'tool_use' && b.name) {
          if (b.id) this.tools.set(b.id, b.name);
          out.push({ type: 'tool_call', tool: b.name, input: b.input ?? {} });
        }
      }
      return out;
    }
    if (msg.type === 'user') {
      const out: AgentStreamEvent[] = [];
      for (const b of asBlocks(msg.message?.content)) {
        if (b.type !== 'tool_result') continue;
        const output = scrub(textOf(b.content), this.secret);
        out.push({
          type: 'tool_result',
          tool: (b.tool_use_id && this.tools.get(b.tool_use_id)) || 'herramienta',
          ok: !b.is_error,
          ...(output ? { output: output.length > MAX_OUTPUT ? `${output.slice(0, MAX_OUTPUT)}…` : output } : {}),
          ...(b.tool_use_id ? { id: b.tool_use_id } : {}),
        });
      }
      return out;
    }
    if (msg.type === 'result') {
      if (msg.is_error || (msg.subtype && msg.subtype !== 'success')) throw explainResult(msg.subtype, msg.errors, msg.result, this.secret, this.maxBudgetUsd);
      if (typeof msg.result !== 'string') throw new AgentError('Claude terminó sin devolver un resultado.', false);
      const out: AgentStreamEvent[] = [];
      if (msg.usage) out.push(usageEvent(msg));
      out.push({ type: 'result', text: scrub(msg.result, this.secret) });
      return out;
    }
    return [];
  }
}

/** Uso de un resultado: la entrada es todo lo que lee Claude, también lo escrito y leído de la caché [R83.1][R83.2]. */
function usageEvent(msg: SdkMessage): AgentStreamEvent {
  const u = msg.usage ?? {};
  const cached = u.cache_read_input_tokens ?? 0;
  return {
    type: 'usage',
    inputTokens: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + cached,
    outputTokens: u.output_tokens ?? 0,
    ...(cached > 0 ? { cachedTokens: cached } : {}),
    ...(typeof msg.total_cost_usd === 'number' ? { costUsd: msg.total_cost_usd } : {}),
  };
}

function asBlocks(content: unknown): Block[] {
  return Array.isArray(content) ? (content.filter((b) => b && typeof b === 'object') as Block[]) : [];
}
