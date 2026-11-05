import { DEFAULT_TRANSFORM_ATTEMPTS, MAX_TRANSFORM_ATTEMPTS, MAX_TRANSFORM_TEXT, type Payload, type TransformConfig, type TransformFormat } from './types';

/** Lógica pura del nodo «Transformar» (SPEC-037): sin IA, sin disco; la usan el motor y la vista previa. */

export type JsonValue = null | boolean | number | string | JsonValue[] | { [k: string]: JsonValue };

/** Resultado de convertir: texto final o errores de formato, y avisos de huecos vacíos [R37.3]. */
export type TransformOutcome = { ok: true; text: string; warnings: string[] } | { ok: false; errors: string[]; warnings: string[] };

/** Busca el primer valor JSON (objeto o lista) bien formado a partir de `start`. */
function scanJson(text: string, from = 0): { value: JsonValue } | undefined {
  for (let start = from; start < text.length; start++) {
    const open = text[start];
    if (open !== '{' && open !== '[') continue;
    let depth = 0;
    let inString = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i]!;
      if (inString) {
        if (ch === '\\') i++;
        else if (ch === '"') inString = false;
      } else if (ch === '"') inString = true;
      else if (ch === '{' || ch === '[') depth++;
      else if (ch === '}' || ch === ']') {
        if (--depth === 0) {
          try {
            return { value: JSON.parse(text.slice(start, i + 1)) as JsonValue };
          } catch {
            break;
          }
        }
      }
    }
  }
  return undefined;
}

/** JSON de un texto: primero un bloque ```json, después el primer objeto o lista bien formado [R37.4]. */
export function extractJsonValue(text: string): { value: JsonValue } | undefined {
  for (const m of text.matchAll(/```json\s*\n([\s\S]*?)```/gi)) {
    try {
      return { value: JSON.parse(m[1]!) as JsonValue };
    } catch {
      /* bloque mal formado: se sigue buscando */
    }
  }
  const whole = text.trim();
  if (whole !== '') {
    try {
      const v = JSON.parse(whole) as JsonValue;
      if (v !== null && typeof v === 'object') return { value: v };
    } catch {
      /* no es JSON entero */
    }
  }
  return scanJson(text);
}

/** Campo de un JSON por ruta con puntos e índices (`items.0.nombre`); `undefined` si no existe [R37.3]. */
export function getJsonPath(value: JsonValue | undefined, path: string): JsonValue | undefined {
  let cur: JsonValue | undefined = value;
  for (const part of path.split('.').filter((p) => p !== '')) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
    if (Array.isArray(cur)) {
      if (!/^\d+$/.test(part)) return undefined;
      cur = cur[Number(part)];
    } else {
      if (!Object.prototype.hasOwnProperty.call(cur, part)) return undefined;
      cur = cur[part];
    }
  }
  return cur;
}

const HOLE = /\{\{\s*([^{}]+?)\s*\}\}/g;

/**
 * Rellena la plantilla. Con `json`, cada hueco va codificado en JSON para que la plantilla siga siendo JSON
 * válido; con `markdown` o `text`, tal cual (objetos y listas como JSON) [R37.3][R37.5].
 */
export function renderTemplate(template: string, input: Payload, format: TransformFormat): { text: string; warnings: string[] } {
  const warnings: string[] = [];
  let parsed: { value: JsonValue } | undefined | null = null;
  const json = () => (parsed === null ? (parsed = extractJsonValue(input.text)) : parsed);
  const text = template.replace(HOLE, (_all, raw: string) => {
    const key = raw.trim();
    let value: JsonValue | undefined;
    if (key === 'entrada') value = input.text;
    else if (key === 'archivos') value = input.files.join('\n');
    else if (key === 'json' || key.startsWith('json.')) {
      const found = json();
      if (!found) {
        warnings.push(`{{${key}}}: la entrada no trae JSON`);
        value = undefined;
      } else {
        value = key === 'json' ? found.value : getJsonPath(found.value, key.slice(5));
        if (value === undefined) warnings.push(`{{${key}}}: el campo no existe`);
      }
    } else {
      warnings.push(`{{${key}}}: hueco desconocido`);
    }
    if (format === 'json') return value === undefined ? (key === 'entrada' || key === 'archivos' ? '""' : 'null') : JSON.stringify(value);
    if (value === undefined || value === null) return '';
    return typeof value === 'string' ? value : typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
  });
  return { text, warnings };
}

// ——— Esquema (subconjunto de JSON Schema) [R37.9] ———

type Schema = Record<string, unknown>;

/** Lee el texto de un esquema: error si no es JSON o no es un objeto [R37.2]. */
export function parseSchema(text: string | undefined): { schema?: Schema; error?: string } {
  if (text === undefined || text.trim() === '') return {};
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch (e) {
    return { error: `El esquema no es JSON: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return { error: 'El esquema tiene que ser un objeto JSON' };
  return { schema: v as Schema };
}

const typeOf = (v: unknown): string => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v === 'number' ? (Number.isInteger(v) ? 'integer' : 'number') : typeof v);
const typeMatches = (v: unknown, t: string) => {
  const actual = typeOf(v);
  return actual === t || (t === 'number' && actual === 'integer');
};
const pathOf = (base: string, key: string | number) => (typeof key === 'number' ? `${base}[${key}]` : /^[A-Za-z_$][\w$]*$/.test(key) ? `${base}.${key}` : `${base}[${JSON.stringify(key)}]`);
const num = (s: Schema, k: string) => (typeof s[k] === 'number' ? (s[k] as number) : undefined);

/** Comprueba un valor contra el esquema; devuelve los errores con su ruta (`$.items[0].nombre: falta`). */
export function validateJsonSchema(value: unknown, schema: Schema, path = '$', out: string[] = []): string[] {
  if (out.length >= 20) return out;
  const t = schema['type'];
  if (typeof t === 'string' || Array.isArray(t)) {
    const types = (Array.isArray(t) ? t : [t]).filter((x): x is string => typeof x === 'string');
    if (types.length > 0 && !types.some((x) => typeMatches(value, x))) {
      out.push(`${path}: se esperaba ${types.join(' o ')} y hay ${typeOf(value)}`);
      return out;
    }
  }
  if ('const' in schema && JSON.stringify(schema['const']) !== JSON.stringify(value)) out.push(`${path}: tiene que ser ${JSON.stringify(schema['const'])}`);
  if (Array.isArray(schema['enum']) && !schema['enum'].some((e) => JSON.stringify(e) === JSON.stringify(value))) {
    out.push(`${path}: tiene que ser uno de ${schema['enum'].map((e) => JSON.stringify(e)).join(', ')}`);
  }
  if (typeof value === 'string') {
    const min = num(schema, 'minLength');
    const max = num(schema, 'maxLength');
    if (min !== undefined && value.length < min) out.push(`${path}: mínimo ${min} caracteres`);
    if (max !== undefined && value.length > max) out.push(`${path}: máximo ${max} caracteres`);
  }
  if (typeof value === 'number') {
    const min = num(schema, 'minimum');
    const max = num(schema, 'maximum');
    if (min !== undefined && value < min) out.push(`${path}: mínimo ${min}`);
    if (max !== undefined && value > max) out.push(`${path}: máximo ${max}`);
  }
  if (Array.isArray(value)) {
    const min = num(schema, 'minItems');
    const max = num(schema, 'maxItems');
    if (min !== undefined && value.length < min) out.push(`${path}: mínimo ${min} elementos`);
    if (max !== undefined && value.length > max) out.push(`${path}: máximo ${max} elementos`);
    const items = schema['items'];
    if (items && typeof items === 'object' && !Array.isArray(items)) value.forEach((v, i) => validateJsonSchema(v, items as Schema, pathOf(path, i), out));
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const props = schema['properties'] && typeof schema['properties'] === 'object' ? (schema['properties'] as Record<string, Schema>) : {};
    if (Array.isArray(schema['required'])) {
      for (const k of schema['required']) if (typeof k === 'string' && !(k in obj)) out.push(`${pathOf(path, k)}: falta`);
    }
    for (const [k, v] of Object.entries(obj)) {
      const sub = props[k];
      if (sub && typeof sub === 'object') validateJsonSchema(v, sub, pathOf(path, k), out);
      else if (schema['additionalProperties'] === false) out.push(`${pathOf(path, k)}: campo no permitido`);
    }
  }
  return out;
}

/** Ejemplo válido de un esquema, para el motor simulado [R37.8]. */
export function sampleFromSchema(schema: Schema, depth = 0): JsonValue {
  if ('const' in schema) return schema['const'] as JsonValue;
  if (Array.isArray(schema['enum']) && schema['enum'].length > 0) return schema['enum'][0] as JsonValue;
  const t = Array.isArray(schema['type']) ? schema['type'].find((x) => x !== 'null') : schema['type'];
  switch (t) {
    case 'string': {
      const min = num(schema, 'minLength') ?? 0;
      const base = 'ejemplo';
      const s = base.length >= min ? base : base.padEnd(min, 'o');
      const max = num(schema, 'maxLength');
      return max !== undefined ? s.slice(0, max) : s;
    }
    case 'integer':
    case 'number':
      return num(schema, 'minimum') ?? (num(schema, 'maximum') !== undefined ? Math.min(0, num(schema, 'maximum')!) : 0);
    case 'boolean':
      return true;
    case 'null':
      return null;
    case 'array': {
      const items = schema['items'] && typeof schema['items'] === 'object' && !Array.isArray(schema['items']) ? (schema['items'] as Schema) : {};
      const n = Math.max(1, num(schema, 'minItems') ?? 1);
      const max = num(schema, 'maxItems');
      return depth > 6 ? [] : Array.from({ length: max !== undefined ? Math.min(n, max) : n }, () => sampleFromSchema(items, depth + 1));
    }
    default: {
      if (t !== 'object' && !schema['properties']) return t === undefined ? 'ejemplo' : null;
      const out: Record<string, JsonValue> = {};
      const props = schema['properties'] && typeof schema['properties'] === 'object' ? (schema['properties'] as Record<string, Schema>) : {};
      if (depth <= 6) for (const [k, sub] of Object.entries(props)) out[k] = sampleFromSchema(sub && typeof sub === 'object' ? sub : {}, depth + 1);
      return out;
    }
  }
}

/**
 * Comprueba que un texto cumple el formato: con `json` lo lee (extrayendo el JSON de la respuesta) y lo
 * compara con el esquema; devuelve el JSON formateado. Con `markdown` o `text`, que no esté vacío [R37.6][R37.9].
 */
export function checkFormat(text: string, format: TransformFormat, schemaText: string | undefined, extract: boolean): { ok: true; text: string } | { ok: false; errors: string[] } {
  if (format !== 'json') return text.trim() === '' ? { ok: false, errors: ['El resultado está vacío'] } : { ok: true, text };
  let value: JsonValue;
  if (extract) {
    const found = extractJsonValue(text);
    if (!found) return { ok: false, errors: ['La respuesta no contiene JSON'] };
    value = found.value;
  } else {
    try {
      value = JSON.parse(text) as JsonValue;
    } catch (e) {
      return { ok: false, errors: [`El resultado no es JSON válido: ${e instanceof Error ? e.message : String(e)}`] };
    }
  }
  const { schema, error } = parseSchema(schemaText);
  if (error) return { ok: false, errors: [error] };
  if (schema) {
    const errors = validateJsonSchema(value, schema);
    if (errors.length > 0) return { ok: false, errors };
  }
  return { ok: true, text: JSON.stringify(value, null, 2) };
}

/** Modo reglas completo: plantilla (o JSON de la entrada) + comprobación de formato y esquema [R37.3]–[R37.5]. */
export function applyTransformRules(cfg: TransformConfig, input: Payload): TransformOutcome {
  const template = cfg.template?.trim() ? cfg.template : undefined;
  if (!template) {
    if (cfg.format !== 'json') return { ok: false, errors: ['Falta la plantilla'], warnings: [] };
    const found = extractJsonValue(input.text);
    if (!found) return { ok: false, errors: ['La entrada no contiene JSON'], warnings: [] };
    const r = checkFormat(JSON.stringify(found.value), 'json', cfg.schema, false);
    return r.ok ? { ok: true, text: r.text, warnings: [] } : { ok: false, errors: r.errors, warnings: [] };
  }
  const { text, warnings } = renderTemplate(template, input, cfg.format);
  const r = checkFormat(text, cfg.format, cfg.schema, false);
  return r.ok ? { ok: true, text: r.text, warnings } : { ok: false, errors: r.errors, warnings };
}

/** Problemas de configuración del nodo, con el código de validación [R37.2]. */
export function transformProblems(cfg: TransformConfig | undefined): { code: string; message: string }[] {
  if (!cfg || typeof cfg !== 'object') return [{ code: 'transform-missing-config', message: 'El nodo transformar necesita configuración' }];
  const out: { code: string; message: string }[] = [];
  if ((cfg.mode !== 'rules' && cfg.mode !== 'ai') || (cfg.format !== 'json' && cfg.format !== 'markdown' && cfg.format !== 'text')) {
    out.push({ code: 'transform-missing-config', message: 'Modo o formato no válido' });
    return out;
  }
  for (const k of ['template', 'instructions', 'schema', 'sample'] as const) {
    const v = cfg[k];
    if (v !== undefined && (typeof v !== 'string' || v.length > MAX_TRANSFORM_TEXT)) out.push({ code: 'transform-too-long', message: `${k} supera ${MAX_TRANSFORM_TEXT} caracteres` });
  }
  if (cfg.schema?.trim()) {
    if (cfg.format !== 'json') out.push({ code: 'transform-schema-needs-json', message: 'El esquema solo vale con formato JSON' });
    const { error } = parseSchema(cfg.schema);
    if (error) out.push({ code: 'transform-bad-schema', message: error });
  }
  if (cfg.mode === 'ai' && !cfg.instructions?.trim()) out.push({ code: 'transform-missing-instructions', message: 'Con Claude hacen falta instrucciones' });
  if (cfg.mode === 'rules' && cfg.format !== 'json' && !cfg.template?.trim()) out.push({ code: 'transform-missing-template', message: 'En Markdown o texto por reglas hace falta una plantilla' });
  if (cfg.maxAttempts !== undefined && (!Number.isInteger(cfg.maxAttempts) || cfg.maxAttempts < 1 || cfg.maxAttempts > MAX_TRANSFORM_ATTEMPTS)) {
    out.push({ code: 'transform-bad-attempts', message: `Los intentos tienen que ser un entero entre 1 y ${MAX_TRANSFORM_ATTEMPTS}` });
  }
  return out;
}

export const transformAttempts = (cfg: TransformConfig): number => cfg.maxAttempts ?? DEFAULT_TRANSFORM_ATTEMPTS;

/** Conversión sin tokens del motor simulado [R37.8]. */
export function simulateTransform(format: TransformFormat, schemaText: string | undefined, input: Payload): string {
  if (format === 'markdown') return `# Resultado\n\n${input.text}`;
  if (format === 'text') return input.text;
  const { schema } = parseSchema(schemaText);
  if (schema) return JSON.stringify(sampleFromSchema(schema), null, 2);
  const found = extractJsonValue(input.text);
  return JSON.stringify(found ? found.value : { texto: input.text }, null, 2);
}
