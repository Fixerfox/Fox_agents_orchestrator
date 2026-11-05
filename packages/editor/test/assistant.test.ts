import { describe, expect, it } from 'vitest';
import { ASSISTANT_TOOLS, CHANNELS, ContractError, parseRequest } from '../src';

describe('SPEC-029 · catálogo y contrato del asistente', () => {
  it('[R29.1] el catálogo tiene consultas, cambios y acciones destructivas con nombres únicos', () => {
    const names = ASSISTANT_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(expect.arrayContaining(['list_agents', 'get_diagram', 'create_agent', 'add_step', 'add_parallel', 'create_diagram', 'delete_agent', 'run_diagram']));
    expect(ASSISTANT_TOOLS.filter((t) => t.destructive).map((t) => t.name).sort()).toEqual(['delete_agent', 'delete_context', 'delete_skill', 'open_terminal', 'remove_step', 'resume_run', 'run_diagram', 'test_mcp']);
    for (const t of ASSISTANT_TOOLS) expect(t.name).toMatch(/^[a-z_]+$/);
  });

  it('[R29.4] el contrato valida turnos, mensajes y resultados de herramientas', () => {
    expect(parseRequest(CHANNELS.assistantSend, { turnId: 't1', messages: [{ role: 'user', text: 'hola' }] })).toBeTruthy();
    expect(() => parseRequest(CHANNELS.assistantSend, { turnId: 't1', messages: [] })).toThrow(ContractError);
    expect(() => parseRequest(CHANNELS.assistantSend, { turnId: '../x', messages: [{ role: 'user', text: 'x' }] })).toThrow(ContractError);
    expect(() => parseRequest(CHANNELS.assistantSend, { turnId: 't', messages: [{ role: 'system', text: 'x' }] })).toThrow(ContractError);
    expect(parseRequest(CHANNELS.assistantToolResult, { turnId: 't', callId: 'c', ok: true, result: { id: 'a' } })).toBeTruthy();
    expect(() => parseRequest(CHANNELS.assistantToolResult, { turnId: 't', callId: 'c', ok: true, result: 'x'.repeat(200_001) })).toThrow(ContractError);
    expect(() => parseRequest(CHANNELS.assistantCancel, 'a b')).toThrow(ContractError);
  });
});

describe('SPEC-030 · MCP asistido y terminal en el contrato', () => {
  it('[R30.11][R30.12] el catálogo trae las herramientas de MCP; pedir un secreto es interactivo y abrir la terminal pide permiso', () => {
    const by = (n: string) => ASSISTANT_TOOLS.find((t) => t.name === n);
    for (const n of ['create_mcp', 'update_mcp', 'test_mcp', 'assign_mcp', 'request_secret', 'open_terminal']) expect(by(n)).toBeTruthy();
    expect(by('request_secret')!.interactive).toBe(true);
    expect(Object.keys(by('request_secret')!.params)).not.toContain('value');
    expect(by('open_terminal')!.destructive).toBe(true);
    // probar arranca un programa definido quizá por el propio Claude: siempre con permiso
    expect(by('test_mcp')!.destructive).toBe(true);
    expect(by('create_mcp')!.description).toMatch(/NO van en args/);
  });

  it('[R30.13] la terminal solo admite `claude` o `shell`, sin rutas ni comandos, con tamaño y texto acotados', () => {
    expect(parseRequest(CHANNELS.terminalStart, { program: 'claude', prompt: 'hola', cols: 80, rows: 24 })).toBeTruthy();
    expect(parseRequest(CHANNELS.terminalStart, { program: 'shell', cols: 80, rows: 24 })).toBeTruthy();
    for (const bad of [
      { program: 'bash', cols: 80, rows: 24 },
      { program: 'claude', cols: 80, rows: 24, cwd: '/etc' },
      { program: 'claude', cols: 80, rows: 24, command: 'rm -rf /' },
      { program: 'shell', prompt: 'ls', cols: 80, rows: 24 },
      { program: 'claude', prompt: 'x'.repeat(4001), cols: 80, rows: 24 },
      { program: 'claude', cols: 0, rows: 24 },
      { program: 'claude', cols: 80.5, rows: 24 },
    ]) expect(() => parseRequest(CHANNELS.terminalStart, bad)).toThrow(ContractError);
    expect(parseRequest(CHANNELS.terminalWrite, { id: 'term-1', data: 'ls\r' })).toBeTruthy();
    expect(() => parseRequest(CHANNELS.terminalWrite, { id: 'term-1', data: 'x'.repeat(65_537) })).toThrow(ContractError);
    expect(() => parseRequest(CHANNELS.terminalResize, { id: 'term-1', cols: 80, rows: 201 })).toThrow(ContractError);
    expect(() => parseRequest(CHANNELS.terminalKill, '../x')).toThrow(ContractError);
  });

  it('[R30.9] guardar un MCP admite el ámbito «project» o «app» y nada más', () => {
    const base = { id: 'gh', schemaVersion: 1, name: 'GitHub', description: '', transport: 'http', url: 'https://x.dev/mcp', enabled: true };
    expect(parseRequest(CHANNELS.saveMcp, { ...base, scope: 'app' })).toBeTruthy();
    expect(() => parseRequest(CHANNELS.saveMcp, { ...base, scope: 'global' })).toThrow(ContractError);
  });
});
