import { KNOWLEDGE_KIND_OF, STEP_FORCED_KEYS, mergeExtra, type KnowledgeExtra } from '@orquestador/core';

/** Las tres listas de un conocimiento añadido. */
export type KnowledgeListKey = 'skillIds' | 'contextIds' | 'mcpIds';

/** Clave de un elemento en el estado en vivo: `skill:id`, `context:id` o `mcp:id` [R36.18]. */
export const knowledgeKey = (list: KnowledgeListKey, id: string): string => `${KNOWLEDGE_KIND_OF[list]}:${id}`;

/** Una skill o un MCP enchufado a un paso es obligatorio siempre y no tiene interruptor [R36.21][R36.22]. */
export const isForcedOnStep = (list: KnowledgeListKey): boolean => (STEP_FORCED_KEYS as readonly string[]).includes(list);

export const isRequired = (extra: KnowledgeExtra | undefined, list: KnowledgeListKey, id: string): boolean => (extra?.required?.[list] ?? []).includes(id);

/**
 * Marca o desmarca como obligatorio un elemento que ya está en su lista; si no está, no cambia nada [R36.4].
 * El resultado queda limpio: sin listas vacías y sin obligatorios que ya no estén en su lista.
 */
export function setRequired(extra: KnowledgeExtra | undefined, list: KnowledgeListKey, id: string, on: boolean): KnowledgeExtra {
  const base = extra ?? {};
  if (!(base[list] ?? []).includes(id)) return mergeExtra(base);
  const current = base.required?.[list] ?? [];
  const next = on ? [...new Set([...current, id])] : current.filter((x) => x !== id);
  return mergeExtra({ ...base, required: { ...base.required, [list]: next } });
}

/** Estado de un elemento en el último intento del paso [R36.18]. `unused` lo deduce quien dibuja cuando el paso ya terminó. */
export type KnowledgeState = 'included' | 'used' | 'missing';
