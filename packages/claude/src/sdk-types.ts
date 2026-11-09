/** Forma mínima de los mensajes del SDK que usamos; lo demás se ignora [R27.5]. */
export interface SdkMessage {
  type: string;
  subtype?: string;
  message?: { content?: unknown };
  error?: string;
  result?: string;
  is_error?: boolean;
  errors?: string[];
  total_cost_usd?: number;
  usage?: { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number };
  /** Mensaje `system`/`init`: herramientas y estado de los servidores MCP [R30.5]. */
  tools?: string[];
  mcp_servers?: { name: string; status: string }[];
}

/** Configuración de un servidor MCP tal como la recibe el SDK [R30.4]. */
export type SdkMcpServer =
  | { type: 'stdio'; command: string; args?: string[]; env?: Record<string, string> }
  | { type: 'http'; url: string; headers?: Record<string, string> };

export type PermissionResult = { behavior: 'allow'; updatedInput: Record<string, unknown> } | { behavior: 'deny'; message: string };

/** Prompt de sistema: uno propio o el de Claude Code con lo nuestro añadido al final [R50.1][R50.7]. */
export type SdkSystemPrompt = string | { type: 'preset'; preset: 'claude_code'; append?: string };

/** Datos de la llamada que el SDK pasa a `canUseTool`; `toolUseID` identifica la llamada [R50.4]. */
export interface CanUseToolOptions {
  signal?: AbortSignal;
  toolUseID?: string;
  agentID?: string;
}

export type CanUseTool = (tool: string, input: Record<string, unknown>, opts?: CanUseToolOptions) => Promise<PermissionResult>;

/** Gancho `PreToolUse` del SDK. */
export type PreToolUseHook = (input: unknown, toolUseId: string | undefined, opts: { signal: AbortSignal }) => Promise<Record<string, unknown>>;

export interface ClaudeQueryOptions {
  model?: string;
  systemPrompt?: SdkSystemPrompt;
  cwd?: string;
  maxTurns?: number;
  /** Presupuesto de la consulta; al pasarse, `error_max_budget_usd` [R77.9]. */
  maxBudgetUsd?: number;
  /** Lista de herramientas o todas las de Claude Code [R50.7]. */
  tools?: string[] | { type: 'preset'; preset: 'claude_code' };
  allowedTools?: string[];
  disallowedTools?: string[];
  permissionMode?: 'default';
  canUseTool?: CanUseTool;
  /** Solo los servidores MCP que pasamos, no los de `.claude` [R50.3]. */
  strictMcpConfig?: boolean;
  abortController?: AbortController;
  env?: Record<string, string | undefined>;
  settingSources?: string[];
  persistSession?: boolean;
  mcpServers?: Record<string, SdkMcpServer>;
  /** Ganchos del SDK; el asistente usa `PreToolUse` para no leer secretos [R29.8]. */
  hooks?: Partial<Record<'PreToolUse', { matcher?: string; hooks: PreToolUseHook[]; timeout?: number }[]>>;
}

/** Función que lanza una consulta al SDK; se inyecta para probar sin red [R27.7]. */
export type QueryFn = (args: { prompt: string; options: ClaudeQueryOptions }) => AsyncIterable<SdkMessage>;
