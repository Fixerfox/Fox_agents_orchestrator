import { parseSchema } from '../shared';
import { MAX_TRANSFORM_ATTEMPTS, MAX_TRANSFORM_TEXT, type TransformConfig } from './model';

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
