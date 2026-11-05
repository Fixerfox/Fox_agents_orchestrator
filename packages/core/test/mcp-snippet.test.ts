import { describe, expect, it } from 'vitest';
import { parseMcpSnippet, splitCommandLine } from '../src';

describe('SPEC-038 · pegar la configuración de un servidor MCP', () => {
  it('[R38.8] parte una línea de comando con comillas y escapes', () => {
    expect(splitCommandLine(`npx -y "@scope/pkg" --root 'C:\\Mis cosas' a\\ b ""`)).toEqual(['npx', '-y', '@scope/pkg', '--root', 'C:\\Mis cosas', 'a b', '']);
    expect(splitCommandLine('  uvx   mcp-server-fetch  ')).toEqual(['uvx', 'mcp-server-fetch']);
  });

  it('[R38.8] una línea de comando con variables delante solo guarda sus nombres', () => {
    expect(parseMcpSnippet('$ GITHUB_TOKEN=ghp_123 DEBUG= npx -y @modelcontextprotocol/server-github')).toEqual({
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      secretNames: ['GITHUB_TOKEN', 'DEBUG'],
      droppedValues: true,
    });
    expect(JSON.stringify(parseMcpSnippet('GITHUB_TOKEN=ghp_123 npx x'))).not.toContain('ghp_123');
  });

  it('[R38.8] un JSON mcpServers trae nombre, comando y nombres de secretos, nunca valores', () => {
    const r = parseMcpSnippet(JSON.stringify({ mcpServers: { notion: { command: 'npx', args: ['-y', '@notionhq/notion-mcp-server'], env: { NOTION_TOKEN: 'ntn_secreto' } } } }));
    expect(r).toEqual({ name: 'notion', transport: 'stdio', command: 'npx', args: ['-y', '@notionhq/notion-mcp-server'], secretNames: ['NOTION_TOKEN'], droppedValues: true });
    expect(JSON.stringify(r)).not.toContain('ntn_secreto');
    // un solo servidor, web, con cabecera y valor de plantilla (no cuenta como valor)
    expect(parseMcpSnippet('{"type":"http","url":"https://mcp.example.com/mcp","headers":{"Authorization":"${TOKEN}"}}')).toEqual({ transport: 'http', url: 'https://mcp.example.com/mcp', secretNames: ['Authorization'], droppedValues: false });
    expect(parseMcpSnippet('{"figma": {"url": "https://figma.example/mcp"}}')).toMatchObject({ name: 'figma', transport: 'http' });
  });

  it('[R38.8] una dirección y «claude mcp add» se entienden', () => {
    expect(parseMcpSnippet('https://mcp.notion.com/mcp')).toEqual({ transport: 'http', url: 'https://mcp.notion.com/mcp', secretNames: [], droppedValues: false });
    expect(parseMcpSnippet('claude mcp add --transport http notion https://mcp.notion.com/mcp')).toEqual({ name: 'notion', transport: 'http', url: 'https://mcp.notion.com/mcp', secretNames: [], droppedValues: false });
    expect(parseMcpSnippet('claude mcp add -s user -e API_KEY=abc pixel -- npx -y pixel-mcp --port 3')).toEqual({ name: 'pixel', transport: 'stdio', command: 'npx', args: ['-y', 'pixel-mcp', '--port', '3'], secretNames: ['API_KEY'], droppedValues: true });
    expect(parseMcpSnippet('claude mcp add --transport http gh https://api.example.com/mcp -H "Authorization: Bearer x"')).toMatchObject({ name: 'gh', url: 'https://api.example.com/mcp', secretNames: ['Authorization'], droppedValues: true });
  });

  it('[R38.8] lo que no se entiende devuelve undefined', () => {
    for (const bad of ['', '   ', '{roto', '[1,2]', '{"a":1}', '--solo-opciones', 'X=1']) expect(parseMcpSnippet(bad)).toBeUndefined();
  });
});
