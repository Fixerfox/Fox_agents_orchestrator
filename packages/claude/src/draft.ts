import {
  AgentError,
  DEFAULT_MODEL,
  LIMITS,
  MODELS,
  SKILL_LIMITS,
  validateAgent,
  validateContext,
  validateSkill,
  type AppSettings,
  type ContextDefinition,
  type FieldProblem,
  type SkillDefinition,
} from '@orquestador/core';
import { askOnce, extractJson } from './once';
import type { QueryFn } from './sdk-types';

export type DraftKind = 'agent' | 'skill' | 'context';

export interface DraftResult {
  /** Campos propuestos, ya filtrados a los conocidos [R26.6]. */
  fields: Record<string, unknown>;
  /** Lo que no pasa las reglas de un alta manual, campo a campo [R26.6]. */
  problems: FieldProblem[];
  ms: number;
}

export const AGENT_DRAFT_KEYS = ['name', 'description', 'instructions', 'model', 'contextIds', 'skillIds'] as const;
export const SKILL_DRAFT_KEYS = ['name', 'description', 'body'] as const;
export const CONTEXT_DRAFT_KEYS = ['name', 'value'] as const;

const STRING_KEYS = new Set(['name', 'description', 'instructions', 'model', 'body', 'value']);

/**
 * Prompt de sistema: solo nombres y descripciones de contextos y skills, nunca sus valores,
 * archivos ni la clave [R26.4].
 */
export function buildDraftSystem(kind: DraftKind, contexts: ContextDefinition[], skills: SkillDefinition[]): string {
  const rules =
    kind === 'agent'
      ? [
          'Ayudas a redactar la definición de un agente para un orquestador de agentes.',
          'Responde SOLO con un objeto JSON con estas claves:',
          `- "name": nombre corto (máximo ${LIMITS.name} caracteres).`,
          `- "description": qué hace, en una frase (máximo ${LIMITS.description} caracteres).`,
          `- "instructions": instrucciones claras en Markdown (máximo ${LIMITS.instructions} caracteres).`,
          `- "model": uno de ${MODELS.map((m) => m.id).join(', ')}.`,
          '- "contextIds": ids de contextos existentes que le convengan (puede ser []).',
          '- "skillIds": ids de skills existentes que le convengan (puede ser []).',
        ]
      : kind === 'context'
        ? [
            'Ayudas a redactar un contexto de texto: información de referencia que se entrega a un agente (reglas, datos, glosario, tono…).',
            'Responde SOLO con un objeto JSON con estas claves:',
            `- "name": nombre corto (máximo ${LIMITS.name} caracteres).`,
            `- "value": el texto del contexto en Markdown (máximo ${LIMITS.contextText} caracteres).`,
          ]
        : [
          'Ayudas a redactar una skill (instrucciones reutilizables) para un orquestador de agentes.',
          'Responde SOLO con un objeto JSON con estas claves:',
          `- "name": nombre corto (máximo ${LIMITS.name} caracteres).`,
          `- "description": cuándo usarla, en una frase (máximo ${LIMITS.description} caracteres).`,
          `- "body": contenido en Markdown (máximo ${SKILL_LIMITS.body} caracteres).`,
        ];
  const parts = [rules.join('\n'), 'Escribe en español salvo que se pida otra cosa. No añadas texto fuera del JSON.'];
  if (kind === 'agent') {
    parts.push(`Contextos existentes:\n${contexts.length ? contexts.map((c) => `- ${c.id}: ${c.name} (${c.kind})`).join('\n') : '(ninguno)'}`);
    parts.push(`Skills existentes:\n${skills.length ? skills.map((k) => `- ${k.id}: ${k.name}. ${k.description}`).join('\n') : '(ninguna)'}`);
  }
  return parts.join('\n\n');
}

/** Mensaje del usuario: su indicación y, si mejora algo, el borrador actual [R26.3][R26.4]. */
export function buildDraftPrompt(kind: DraftKind, instruction: string, current?: Record<string, unknown>): string {
  const filled = current && Object.values(current).some((v) => (typeof v === 'string' ? v.trim() !== '' : Array.isArray(v) && v.length > 0));
  const noun = kind === 'agent' ? 'agente' : kind === 'skill' ? 'skill' : 'contexto';
  const parts = [filled ? `Mejora este ${noun} según la indicación y devuelve el objeto completo.` : `Crea ${kind === 'agent' ? 'un agente' : kind === 'skill' ? 'una skill' : 'un contexto'} según la indicación.`];
  if (filled) parts.push(`Borrador actual:\n${JSON.stringify(current, null, 2)}`);
  parts.push(`Indicación:\n${instruction.trim()}`);
  return parts.join('\n\n');
}

/** Valida la respuesta con las reglas del alta manual y descarta lo desconocido [R26.6]. */
export function parseDraft(kind: DraftKind, text: string, contexts: ContextDefinition[], skills: SkillDefinition[]): { fields: Record<string, unknown>; problems: FieldProblem[] } {
  const raw = extractJson(text);
  if (!raw) throw new AgentError('Claude no devolvió una propuesta con el formato esperado. Prueba otra vez o reformula la indicación.', false);
  const keys: readonly string[] = kind === 'agent' ? AGENT_DRAFT_KEYS : kind === 'skill' ? SKILL_DRAFT_KEYS : CONTEXT_DRAFT_KEYS;
  const contextIds = new Set(contexts.map((c) => c.id));
  const skillIds = new Set(skills.map((k) => k.id));
  const fields: Record<string, unknown> = {};
  for (const key of keys) {
    const v = raw[key];
    if (STRING_KEYS.has(key)) {
      if (typeof v === 'string') fields[key] = v;
    } else if (Array.isArray(v)) {
      const known = key === 'contextIds' ? contextIds : skillIds;
      fields[key] = [...new Set(v.filter((x): x is string => typeof x === 'string' && known.has(x)))];
    }
  }
  if (typeof fields['model'] === 'string' && !MODELS.some((m) => m.id === fields['model'])) delete fields['model'];
  if (Object.keys(fields).length === 0) throw new AgentError('Claude no propuso ningún campo. Prueba con una indicación más concreta.', false);
  const problems =
    kind === 'agent'
      ? validateAgent({ id: 'borrador', schemaVersion: 1, name: '', description: '', instructions: '', model: DEFAULT_MODEL, contextIds: [], skillIds: [], ...fields }, { contextIds, skillIds })
      : kind === 'skill'
        ? validateSkill({ id: 'borrador', name: '', description: '', body: '', ...fields })
        : validateContext({ id: 'borrador', schemaVersion: 1, kind: 'text', name: '', value: '', ...fields });
  return { fields, problems: problems.filter((p) => p.field !== 'id') };
}

export interface DraftArgs {
  query: QueryFn;
  settings: AppSettings;
  apiKey: string | undefined;
  cwd: string;
  kind: DraftKind;
  instruction: string;
  current?: Record<string, unknown>;
  contexts: ContextDefinition[];
  skills: SkillDefinition[];
  signal?: AbortSignal;
}

/** Pide a Claude una propuesta de agente o skill; sin herramientas y sin leer archivos [R26.1][R26.4][R26.5]. */
export async function draftWithClaude(a: DraftArgs): Promise<DraftResult> {
  const { text, ms } = await askOnce({
    query: a.query,
    settings: a.settings,
    apiKey: a.apiKey,
    cwd: a.cwd,
    system: buildDraftSystem(a.kind, a.contexts, a.skills),
    prompt: buildDraftPrompt(a.kind, a.instruction, a.current),
    ...(a.signal ? { signal: a.signal } : {}),
  });
  return { ...parseDraft(a.kind, text, a.contexts, a.skills), ms };
}
