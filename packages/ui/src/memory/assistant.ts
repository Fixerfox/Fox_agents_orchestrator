import { ok, fail, type AssistantEvent, type SavedAssistantTabs } from '@orquestador/editor';
import type { MemoryApi, MemoryApiOptions, MemoryState } from './types';

/** Asistente simulado y redacción con Claude. */
export function memoryAssistant(s: MemoryState, options: MemoryApiOptions) {
  const assistantListeners = new Set<(turnId: string, event: AssistantEvent) => void>();
  const turns = new Map<string, { cancelled: boolean; pending: Map<string, (r: { ok: boolean; result: unknown }) => void> }>();
  const assistantResults: MemoryApi['assistantResults'] = [];
  const assistantTurns: MemoryApi['assistantTurns'] = [];
  const callNames = new Map<string, string>();
  /** Pestañas guardadas del proyecto abierto [R86.11]. */
  let savedTabs: SavedAssistantTabs | null = null;

  return {
    assistantResults,
    assistantTurns,
    async draftWithClaude(req) {
      const d = options.draft;
      if (typeof d === 'function') return d(req);
      if (d) return ok(structuredClone(d));
      const fields: Record<string, unknown> =
        req.kind === 'agent'
          ? { name: 'Revisor', description: req.instruction.slice(0, 120), instructions: `# Objetivo\n${req.instruction}`, model: s.settings.defaultModel, contextIds: [], skillIds: [] }
          : req.kind === 'skill'
            ? { name: 'Guía de estilo', description: req.instruction.slice(0, 120), body: `# Pasos\n${req.instruction}` }
            : { name: 'Glosario', value: `# Glosario\n${req.instruction}` };
      return ok({ fields, problems: [], ms: 90 });
    },
    async assistantSend({ turnId, messages }) {
      if (!s.open) return fail('not-found', 'Abre un proyecto para usar el asistente');
      assistantTurns.push(structuredClone(messages));
      const steps = options.assistant?.(messages) ?? [{ text: 'Estoy en modo simulado. Para que pueda crear agentes, skills y diagramas por ti, elige el motor «Claude» en Ajustes.' }];
      const turn = { cancelled: false, pending: new Map<string, (r: { ok: boolean; result: unknown }) => void>() };
      turns.set(turnId, turn);
      const emit = (e: AssistantEvent) => queueMicrotask(() => assistantListeners.forEach((l) => l(turnId, e)));
      void (async () => {
        let text = '';
        let n = 0;
        for (const step of steps) {
          if (turn.cancelled) break;
          if ('text' in step) {
            text += step.text;
            emit({ type: 'text', text: step.text });
          } else if ('read' in step) {
            emit({ type: 'read', tool: step.read, target: step.target, ok: step.ok ?? true });
          } else {
            const callId = `${turnId}-c${++n}`;
            callNames.set(callId, step.tool);
            const done = new Promise<{ ok: boolean; result: unknown }>((resolve) => turn.pending.set(callId, resolve));
            emit({ type: 'tool', callId, name: step.tool, args: step.args });
            await done;
          }
          await new Promise((r) => setTimeout(r, 0));
        }
        turns.delete(turnId);
        emit(turn.cancelled ? { type: 'error', message: 'Detenido.' } : { type: 'done', text });
      })();
      return ok(null);
    },
    async assistantToolResult({ turnId, callId, ok: good, result }) {
      const r = turns.get(turnId)?.pending.get(callId);
      if (!r) return ok(false);
      assistantResults.push({ name: callNames.get(callId) ?? '?', ok: good, result: structuredClone(result) });
      r({ ok: good, result });
      return ok(true);
    },
    async assistantCancel(turnId) {
      const turn = turns.get(turnId);
      if (!turn) return ok(false);
      turn.cancelled = true;
      for (const r of turn.pending.values()) r({ ok: false, result: 'Detenido.' });
      return ok(true);
    },
    async assistantTabsLoad() {
      return ok(s.open && savedTabs ? structuredClone(savedTabs) : null);
    },
    async assistantTabsSave(doc) {
      if (!s.open) return fail('not-found', 'No hay un proyecto abierto');
      savedTabs = structuredClone(doc);
      return ok(null);
    },
    onAssistantEvents(listener) {
      assistantListeners.add(listener);
      return () => void assistantListeners.delete(listener);
    },
  } satisfies Partial<MemoryApi>;
}
