import type { Id } from './types';

/**
 * Conocimiento añadido sin tocar al agente: skills, contextos y servidores MCP que valen solo para un paso
 * o para todo un diagrama [R33.1].
 */
export interface KnowledgeExtra {
  skillIds?: Id[];
  contextIds?: Id[];
  mcpIds?: Id[];
  /** Cuáles de las listas anteriores son obligatorios en esta asignación; es un subconjunto de ellas [R36.1]. */
  required?: KnowledgeLists;
}

/** Las tres listas de ids de un conocimiento añadido. */
export interface KnowledgeLists {
  skillIds?: Id[];
  contextIds?: Id[];
  mcpIds?: Id[];
}

/** Tipo de elemento de conocimiento [R36.13]. */
export type KnowledgeKind = 'skill' | 'context' | 'mcp';

export const KNOWLEDGE_LIST_KEYS = ['skillIds', 'contextIds', 'mcpIds'] as const;

export const KNOWLEDGE_KIND_OF = { skillIds: 'skill', contextIds: 'context', mcpIds: 'mcp' } as const;

/** Máximo de elementos de cada tipo en un conocimiento añadido [R33.2]. */
export const MAX_EXTRA_ITEMS = 50;

/**
 * Une listas de ids sin repetir, en orden [R33.3]. Lo obligatorio en cualquier parte lo es en el resultado
 * (aunque en otra sea opcional) y solo se conserva si sigue en la lista [R36.3][R36.4].
 */
export function mergeExtra(...parts: (KnowledgeExtra | undefined)[]): KnowledgeExtra {
  const out: KnowledgeExtra = {};
  const required: KnowledgeLists = {};
  for (const k of KNOWLEDGE_LIST_KEYS) {
    const v = [...new Set(parts.flatMap((p) => p?.[k] ?? []))];
    if (v.length === 0) continue;
    out[k] = v;
    const r = [...new Set(parts.flatMap((p) => p?.required?.[k] ?? []))].filter((id) => v.includes(id));
    if (r.length > 0) required[k] = r;
  }
  if (Object.keys(required).length > 0) out.required = required;
  return out;
}

/** Listas cuyo contenido es obligatorio siempre que está enchufado a un paso [R36.21]. */
export const STEP_FORCED_KEYS = ['skillIds', 'mcpIds'] as const;

/**
 * Conocimiento de un paso tal como se ejecuta: toda skill y todo MCP enchufado es obligatorio, esté o no en
 * `required`; los contextos conservan su marca [R36.21]. No cambia el diagrama guardado.
 */
export function stepExtra(extra: KnowledgeExtra | undefined): KnowledgeExtra | undefined {
  if (!extra) return undefined;
  const required: KnowledgeLists = { ...extra.required };
  for (const k of STEP_FORCED_KEYS) if ((extra[k] ?? []).length > 0) required[k] = [...new Set([...(extra.required?.[k] ?? []), ...(extra[k] ?? [])])];
  return mergeExtra({ ...extra, required });
}
