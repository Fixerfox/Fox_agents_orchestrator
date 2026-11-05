import type { ClaudeQueryOptions, QueryFn, SdkMessage } from './sdk-types';
import type { AppToolDef } from './assistant';

// `import()` nativo: el paquete del SDK es ESM y el proceso principal se empaqueta en CommonJS.
const nativeImport = new Function('specifier', 'return import(specifier)') as (s: string) => Promise<{ query(a: { prompt: string; options?: unknown }): AsyncIterable<unknown> }>;

/** Consulta real al Agent SDK de Claude. No se prueba en CI: las pruebas inyectan un `QueryFn` simulado. */
export const sdkQuery: QueryFn = async function* ({ prompt, options }: { prompt: string; options: ClaudeQueryOptions }) {
  const sdk = await nativeImport('@anthropic-ai/claude-agent-sdk');
  for await (const msg of sdk.query({ prompt, options })) yield msg as SdkMessage;
};

type ZodLike = {
  string(): { describe(d: string): unknown; optional(): unknown };
  number(): { describe(d: string): unknown; optional(): unknown };
  boolean(): { describe(d: string): unknown; optional(): unknown };
  array(t: unknown): { describe(d: string): unknown; optional(): unknown };
};

/**
 * Servidor MCP de la app dentro del proceso principal (`createSdkMcpServer`), con sus parámetros como esquemas zod
 * [R29.1]. No se prueba en CI: las pruebas inyectan su propio `CreateAppServer`.
 */
export const sdkCreateAppServer = async (name: string, tools: AppToolDef[]): Promise<unknown> => {
  const sdk = (await nativeImport('@anthropic-ai/claude-agent-sdk')) as unknown as { createSdkMcpServer(o: unknown): unknown };
  const zmod = (await nativeImport('zod')) as unknown as { z?: ZodLike } & ZodLike;
  const z: ZodLike = zmod.z ?? zmod;
  const shape = (params: AppToolDef['params']) =>
    Object.fromEntries(
      Object.entries(params).map(([k, p]) => {
        const base = p.type === 'string' ? z.string() : p.type === 'number' ? z.number() : p.type === 'boolean' ? z.boolean() : z.array(z.string());
        const described = (base as { describe(d: string): { optional(): unknown } }).describe(p.description);
        return [k, p.optional ? described.optional() : described];
      }),
    );
  return sdk.createSdkMcpServer({
    name,
    version: '1.0.0',
    tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: shape(t.params), handler: (args: Record<string, unknown>) => t.handler(args) })),
  });
};
