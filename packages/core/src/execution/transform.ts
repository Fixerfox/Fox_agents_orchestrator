import { DEFAULT_TRANSFORM_ATTEMPTS, type TransformConfig, type TransformFormat } from '../diagrams';
import { type JsonValue, type Payload, extractJsonValue, getJsonPath, parseSchema, sampleFromSchema, validateJsonSchema } from '../shared';

/** Resultado de convertir: texto final o errores de formato, y avisos de huecos vacíos [R37.3]. */
export type TransformOutcome = { ok: true; text: string; warnings: string[] } | { ok: false; errors: string[]; warnings: string[] };

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
