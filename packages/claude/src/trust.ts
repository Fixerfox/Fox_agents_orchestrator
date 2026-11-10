import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

/** Algo de la configuración de Claude Code de un proyecto que ejecuta comandos o cambia el entorno [R88.1]. */
export interface ConfigRisk {
  /** Archivo relativo a la carpeta (`.claude/settings.json`), nunca la ruta absoluta. */
  file: string;
  key: string;
  detail: string;
}

export const CLAUDE_CONFIG_FILES = ['.claude/settings.json', '.claude/settings.local.json'] as const;
/** Claves que ejecutan comandos o redirigen la API [R88.1]. */
export const RISKY_KEYS = ['hooks', 'env', 'apiKeyHelper', 'awsAuthRefresh', 'awsCredentialExport', 'otelHeadersHelper', 'statusLine'] as const;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Cuántos comandos hay en un bloque `hooks` de Claude Code. */
function countHooks(hooks: unknown): number {
  let n = 0;
  const visit = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(visit);
    else if (isObject(v)) {
      if (typeof v['command'] === 'string') n++;
      Object.values(v).forEach(visit);
    }
  };
  visit(hooks);
  return n;
}

function describe(key: string, value: unknown): string {
  if (key === 'hooks') {
    const n = countHooks(value);
    return `${n} ${n === 1 ? 'comando' : 'comandos'}`;
  }
  if (key === 'env' && isObject(value)) return Object.keys(value).sort().join(', ') || '(vacío)';
  if (typeof value === 'string') return value.length > 120 ? `${value.slice(0, 120)}…` : value;
  if (isObject(value) && typeof value['command'] === 'string') return String(value['command']).slice(0, 120);
  return JSON.stringify(value).slice(0, 120);
}

/**
 * Lo arriesgado de la configuración de Claude Code de unas carpetas y su huella [R88.1]. Un archivo que no existe o no
 * es JSON no cuenta.
 */
export async function scanClaudeConfig(dirs: readonly string[]): Promise<{ items: ConfigRisk[]; fingerprint: string }> {
  const items: ConfigRisk[] = [];
  const seen: unknown[] = [];
  const done = new Set<string>();
  for (const dir of dirs) {
    const base = path.resolve(dir);
    if (done.has(base)) continue;
    done.add(base);
    for (const file of CLAUDE_CONFIG_FILES) {
      let data: unknown;
      try {
        data = JSON.parse((await fs.readFile(path.join(base, file), 'utf8')).trimStart());
      } catch {
        continue;
      }
      if (!isObject(data)) continue;
      for (const key of RISKY_KEYS) {
        if (data[key] === undefined) continue;
        items.push({ file, key, detail: describe(key, data[key]) });
        seen.push([file, key, data[key]]);
      }
    }
  }
  const fingerprint = items.length === 0 ? '' : createHash('sha256').update(JSON.stringify(seen)).digest('hex');
  return { items, fingerprint };
}
