import { type FieldProblem, type Id, isSafeId } from '../shared';

export const MCP_SCHEMA_VERSION = 1;

/** Límites de un servidor MCP [R30.2]. */
export const MCP_LIMITS = {
  name: 60,
  description: 300,
  command: 500,
  args: 50,
  arg: 500,
  url: 2_000,
  secrets: 20,
  secretValue: 4_000,
} as const;

/** Nombre de una variable de entorno o cabecera secreta: `API_KEY`, `Authorization`… [R30.2]. */
export const SECRET_NAME = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;

/**
 * Servidor MCP del proyecto [R30.1]. Un comando local (`stdio`) o un servidor web (`http`). Los valores secretos
 * (variables de entorno o cabeceras) nunca van en este JSON: solo sus nombres; los valores los guarda cifrados el
 * proceso principal.
 */
export interface McpServerDefinition {
  id: Id;
  schemaVersion: number;
  name: string;
  description: string;
  transport: 'stdio' | 'http';
  command?: string;
  args?: string[];
  url?: string;
  /** Variables de entorno (stdio) o cabeceras (http) secretas, por nombre. */
  secretNames?: string[];
  /** Apagado no se pasa a ningún agente. Lo importado llega apagado hasta que el usuario lo revisa [R30.6]. */
  enabled: boolean;
  /** Sus herramientas no piden permiso cada vez [R30.4]. */
  trusted?: boolean;
  /** Dónde se guarda: solo en este proyecto (por defecto) o para todos los proyectos [R30.9]. */
  scope?: McpScope;
}

/** Ámbito de un servidor MCP [R30.9]. */
export type McpScope = 'project' | 'app';

export function newMcpServer(id: Id, name: string): McpServerDefinition {
  return { id, schemaVersion: MCP_SCHEMA_VERSION, name, description: '', transport: 'stdio', command: '', args: [], enabled: true };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Valida un servidor MCP [R30.2]. */
export function validateMcpServer(m: unknown): FieldProblem[] {
  if (!isObject(m)) return [{ field: 'mcp', message: 'El servidor MCP no es válido' }];
  const out: FieldProblem[] = [];
  if (!isSafeId(m.id)) out.push({ field: 'id', message: 'El identificador no es válido' });
  const name = typeof m.name === 'string' ? m.name.trim() : '';
  if (name.length === 0) out.push({ field: 'name', message: 'Escribe un nombre' });
  else if (name.length > MCP_LIMITS.name) out.push({ field: 'name', message: `El nombre admite hasta ${MCP_LIMITS.name} caracteres` });
  if (typeof m.description !== 'string' || m.description.length > MCP_LIMITS.description) out.push({ field: 'description', message: `La descripción admite hasta ${MCP_LIMITS.description} caracteres` });
  if (m.transport === 'stdio') {
    const cmd = typeof m.command === 'string' ? m.command.trim() : '';
    if (cmd.length === 0) out.push({ field: 'command', message: 'Escribe el comando que arranca el servidor' });
    else if (cmd.length > MCP_LIMITS.command) out.push({ field: 'command', message: `El comando admite hasta ${MCP_LIMITS.command} caracteres` });
    if (m.args !== undefined && (!Array.isArray(m.args) || m.args.length > MCP_LIMITS.args || m.args.some((a) => typeof a !== 'string' || a.length > MCP_LIMITS.arg))) {
      out.push({ field: 'args', message: `Hasta ${MCP_LIMITS.args} argumentos de ${MCP_LIMITS.arg} caracteres` });
    }
  } else if (m.transport === 'http') {
    const url = typeof m.url === 'string' ? m.url.trim() : '';
    if (!/^https?:\/\/[^\s]+$/i.test(url) || url.length > MCP_LIMITS.url) out.push({ field: 'url', message: 'Escribe una dirección http o https' });
  } else out.push({ field: 'transport', message: 'Elige comando local o servidor web' });
  if (m.secretNames !== undefined) {
    const names = m.secretNames;
    if (!Array.isArray(names) || names.length > MCP_LIMITS.secrets || names.some((n) => typeof n !== 'string' || !SECRET_NAME.test(n))) {
      out.push({ field: 'secretNames', message: 'Los nombres de los secretos solo llevan letras, números, guiones y guiones bajos' });
    } else if (new Set(names).size !== names.length) out.push({ field: 'secretNames', message: 'Hay nombres de secretos repetidos' });
  }
  if (typeof m.enabled !== 'boolean') out.push({ field: 'enabled', message: 'Falta si está activado' });
  if (m.trusted !== undefined && typeof m.trusted !== 'boolean') out.push({ field: 'trusted', message: 'El valor de confianza no es válido' });
  if (m.scope !== undefined && m.scope !== 'project' && m.scope !== 'app') out.push({ field: 'scope', message: 'Elige dónde guardarlo' });
  return out;
}

/** Nombre que ve Claude para un servidor (prefijo de sus herramientas `mcp__<nombre>__…`) [R30.4]. */
export function mcpKey(m: Pick<McpServerDefinition, 'id'>): string {
  return m.id.replace(/[^A-Za-z0-9_-]/g, '_');
}

/** Lo que se ha entendido de un trozo pegado de un README [R38.8]. */
export interface McpSnippet {
  name?: string;
  transport: 'stdio' | 'http';
  command?: string;
  args?: string[];
  url?: string;
  secretNames: string[];
  /** Traía valores de variables o cabeceras, que no se copian. */
  droppedValues: boolean;
}

/** Parte una línea de comando como un shell sencillo: espacios, comillas simples y dobles y `\` [R38.8]. */
export function splitCommandLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let has = false;
  let quote: '"' | "'" | undefined;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quote) {
      if (c === quote) quote = undefined;
      else if (c === '\\' && quote === '"' && i + 1 < line.length && (line[i + 1] === '"' || line[i + 1] === '\\')) cur += line[++i];
      else cur += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      has = true;
    } else if (c === '\\' && i + 1 < line.length) {
      const n = line[i + 1]!;
      if (n === '\n' || n === '\r') i++; // continuación de línea
      else cur += line[++i];
      has = true;
    } else if (/\s/.test(c)) {
      if (has || cur !== '') out.push(cur);
      cur = '';
      has = false;
    } else {
      cur += c;
    }
  }
  if (has || cur !== '') out.push(cur);
  return out;
}

const URL_RE = /^https?:\/\/\S+$/i;
const ENV_ASSIGN = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s;
const uniq = (xs: string[]) => [...new Set(xs.filter((x) => SECRET_NAME.test(x)))];

function fromConfig(name: string | undefined, cfg: Record<string, unknown>): McpSnippet | undefined {
  const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  const keys = (v: unknown) => (isObject(v) ? Object.keys(v) : []);
  const hasValues = (v: unknown) => isObject(v) && Object.values(v).some((x) => typeof x === 'string' && x.trim() !== '' && !/^\$\{[^}]*\}$/.test(x.trim()));
  const secretNames = uniq([...keys(cfg['env']), ...keys(cfg['headers'])]);
  const droppedValues = hasValues(cfg['env']) || hasValues(cfg['headers']);
  const base = { ...(name ? { name } : {}), secretNames, droppedValues };
  if (typeof cfg['url'] === 'string') return { ...base, transport: 'http', url: cfg['url'] };
  if (typeof cfg['command'] === 'string') return { ...base, transport: 'stdio', command: cfg['command'], args: strs(cfg['args']) };
  return undefined;
}

/** `claude mcp add [opciones] nombre (url | -- comando args…)` */
function fromClaudeAdd(tokens: string[]): McpSnippet | undefined {
  let transport: 'stdio' | 'http' | undefined;
  const secrets: string[] = [];
  let dropped = false;
  const rest: string[] = [];
  let i = 3;
  for (; i < tokens.length; i++) {
    const tk = tokens[i]!;
    if (tk === '--') {
      i++;
      break;
    }
    if (tk === '-t' || tk === '--transport') {
      const v = tokens[++i] ?? '';
      transport = v === 'stdio' ? 'stdio' : 'http';
    } else if (tk.startsWith('--transport=')) transport = tk.slice(12) === 'stdio' ? 'stdio' : 'http';
    else if (tk === '-e' || tk === '--env') {
      const m = ENV_ASSIGN.exec(tokens[++i] ?? '');
      if (m) {
        secrets.push(m[1]!);
        dropped ||= m[2]!.trim() !== '';
      }
    } else if (tk === '-H' || tk === '--header') {
      const h = tokens[++i] ?? '';
      const at = h.indexOf(':');
      if (at > 0) {
        secrets.push(h.slice(0, at).trim());
        dropped ||= h.slice(at + 1).trim() !== '';
      }
    } else if (tk === '-s' || tk === '--scope') i++;
    else if (tk.startsWith('-')) continue;
    else rest.push(tk);
  }
  const after = tokens.slice(i);
  const name = rest[0];
  const url = rest.find((x) => URL_RE.test(x));
  if (url && after.length === 0) return { ...(name && name !== url ? { name } : {}), transport: 'http', url, secretNames: uniq(secrets), droppedValues: dropped };
  if (transport === 'http' || after.length === 0) return undefined;
  return { ...(name ? { name } : {}), transport: 'stdio', command: after[0]!, args: after.slice(1), secretNames: uniq(secrets), droppedValues: dropped };
}

/**
 * Entiende lo que se pega de un README: un JSON `mcpServers` (o la configuración de un solo servidor), una dirección
 * http(s), `claude mcp add …` o una línea de comando con variables `NOMBRE=valor` delante. Solo devuelve los nombres
 * de los secretos, nunca sus valores [R38.8].
 */
export function parseMcpSnippet(text: string): McpSnippet | undefined {
  const raw = text.trim();
  if (raw === '') return undefined;
  if (raw.startsWith('{')) {
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return undefined;
    }
    if (!isObject(json)) return undefined;
    const servers = isObject(json['mcpServers']) ? json['mcpServers'] : isObject(json['servers']) ? json['servers'] : undefined;
    if (servers) {
      const first = Object.entries(servers).find(([, v]) => isObject(v));
      return first ? fromConfig(first[0], first[1] as Record<string, unknown>) : undefined;
    }
    if ('command' in json || 'url' in json) return fromConfig(undefined, json);
    // `{ "nombre": { command… } }`
    const one = Object.entries(json).find(([, v]) => isObject(v) && ('command' in v || 'url' in v));
    return one ? fromConfig(one[0], one[1] as Record<string, unknown>) : undefined;
  }
  if (URL_RE.test(raw)) return { transport: 'http', url: raw, secretNames: [], droppedValues: false };
  const tokens = splitCommandLine(raw.replace(/^\$\s+/, ''));
  if (tokens[0] === 'claude' && tokens[1] === 'mcp' && tokens[2] === 'add') return fromClaudeAdd(tokens);
  const secrets: string[] = [];
  let dropped = false;
  while (tokens.length > 0) {
    const m = ENV_ASSIGN.exec(tokens[0]!);
    if (!m) break;
    secrets.push(m[1]!);
    dropped ||= m[2]!.trim() !== '';
    tokens.shift();
  }
  if (tokens.length === 0 || !/^[\w.~/\\@][^\s]*$/.test(tokens[0]!)) return undefined;
  return { transport: 'stdio', command: tokens[0]!, args: tokens.slice(1), secretNames: uniq(secrets), droppedValues: dropped };
}
