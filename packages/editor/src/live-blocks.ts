import type { TranscriptItem } from './live';

type ToolItem = Extract<TranscriptItem, { kind: 'tool' }>;

/** Un elemento de la conversación: los de siempre o un grupo de herramientas seguidas [R69.2]. */
export type ConversationBlock = TranscriptItem | { kind: 'tools'; tools: ToolItem[] };

/** Junta las herramientas seguidas en un bloque; lo demás queda igual y en su orden [R69.2]. */
export function conversationBlocks(items: readonly TranscriptItem[]): ConversationBlock[] {
  const out: ConversationBlock[] = [];
  for (const it of items) {
    const last = out[out.length - 1];
    if (it.kind === 'tool') {
      if (last?.kind === 'tools') last.tools.push(it);
      else out.push({ kind: 'tools', tools: [it] });
    } else out.push(it);
  }
  return out;
}

const TARGET_KEYS = ['file_path', 'path', 'command', 'pattern', 'url', 'notebook_path', 'query'] as const;

/** Objetivo principal de una herramienta (fichero, comando, patrón o dirección), corto; nada si no lo hay [R69.2]. */
export function toolTarget(input: unknown, max = 60): string | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const rec = input as Record<string, unknown>;
  for (const k of TARGET_KEYS) {
    const v = rec[k];
    if (typeof v === 'string' && v.trim() !== '') {
      const one = v.trim().split('\n')[0]!;
      return one.length > max ? `${one.slice(0, max - 1)}…` : one;
    }
  }
  return undefined;
}
