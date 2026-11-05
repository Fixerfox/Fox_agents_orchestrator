import { describe, expect, it } from 'vitest';
import { mcpFromImport, newAgent, newMcpServer, validateAgent, validateMcpServer } from '../src';

const ok = { ...newMcpServer('pixel', 'Pixel'), command: 'npx', args: ['-y', 'pixelart-mcp'], secretNames: ['API_KEY'] };

describe('SPEC-030 · servidores MCP en el núcleo', () => {
  it('[R30.2] valida nombre, comando o dirección, argumentos y nombres de secreto', () => {
    expect(validateMcpServer(ok)).toEqual([]);
    expect(validateMcpServer({ ...ok, command: '' })[0]).toMatchObject({ field: 'command' });
    expect(validateMcpServer({ ...ok, transport: 'http', url: 'ftp://x' })[0]).toMatchObject({ field: 'url' });
    expect(validateMcpServer({ ...ok, transport: 'http', url: 'https://mcp.example.com/sse' })).toEqual([]);
    expect(validateMcpServer({ ...ok, args: Array.from({ length: 51 }, () => 'x') })[0]).toMatchObject({ field: 'args' });
    expect(validateMcpServer({ ...ok, secretNames: ['MAL NOMBRE'] })[0]).toMatchObject({ field: 'secretNames' });
    expect(validateMcpServer({ ...ok, secretNames: ['A', 'A'] })[0]).toMatchObject({ field: 'secretNames' });
    expect(validateMcpServer({ ...ok, name: '' })[0]).toMatchObject({ field: 'name' });
  });

  it('[R30.3] un agente solo admite servidores MCP que existen y sin repetir', () => {
    const a = { ...newAgent('pintor', 'Pintor'), mcpIds: ['pixel'] };
    expect(validateAgent(a, { contextIds: new Set(), mcpIds: new Set(['pixel']) })).toEqual([]);
    expect(validateAgent(a, { contextIds: new Set(), mcpIds: new Set() })[0]).toMatchObject({ field: 'mcpIds' });
    expect(validateAgent({ ...a, mcpIds: ['pixel', 'pixel'] }, { contextIds: new Set(), mcpIds: new Set(['pixel']) })[0]).toMatchObject({ field: 'mcpIds' });
  });

  it('[R30.6] lo importado llega apagado, con nombres de secreto y sin valores', () => {
    const def = mcpFromImport({ name: 'pixelart-mcp', command: 'node', args: ['server.js'], secretNames: ['TOKEN', 'mal nombre'] }, new Set());
    expect(def).toMatchObject({ id: 'pixelart-mcp', transport: 'stdio', command: 'node', args: ['server.js'], secretNames: ['TOKEN'], enabled: false });
    expect(validateMcpServer(def)).toEqual([]);
    const web = mcpFromImport({ name: 'Docs', url: 'https://docs.example.com/mcp' }, new Set(['docs']));
    expect(web).toMatchObject({ id: 'docs-2', transport: 'http', url: 'https://docs.example.com/mcp', enabled: false });
  });
});
