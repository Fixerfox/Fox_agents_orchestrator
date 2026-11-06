/** Lógica pura del nodo «Transformar» (SPEC-037): sin IA, sin disco; la usan el motor y la vista previa. */

export type JsonValue = null | boolean | number | string | JsonValue[] | { [k: string]: JsonValue };

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
