import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { newAgent, newMcpServer } from '@orquestador/core';
import { McpSecretVault, ProjectStore, StoreError, type SecretCipher } from '../src';
import { cleanupTmp, tmp } from './helpers';

cleanupTmp();

const fake = (on = true): SecretCipher => ({
  available: () => on,
  encrypt: (s) => Buffer.from(s.split('').reverse().join('')),
  decrypt: (b) => b.toString().split('').reverse().join(''),
});
const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e instanceof StoreError ? e.code : 'otro';
  }
  return 'sin error';
};
const server = { ...newMcpServer('pixel', ' Pixel '), command: 'npx', args: ['-y', 'pixelart-mcp'], secretNames: ['API_KEY'] };

describe('SPEC-030 · servidores MCP en el proyecto', () => {
  it('[R30.1][R30.2] guarda y lista servidores validados, sin valores secretos', async () => {
    const p = await ProjectStore.create(await tmp(), { name: 'P' });
    await p.saveMcp(server);
    expect(await p.listMcp()).toEqual([{ ...server, name: 'Pixel', schemaVersion: 1, scope: 'project' }]);
    const raw = await fs.readFile(join(p.paths.mcpDir, 'pixel.json'), 'utf8');
    expect(raw).toContain('"API_KEY"');
    expect(await codeOf(p.saveMcp({ ...server, command: '' }))).toBe('invalid');
    expect(await codeOf(p.saveMcp({ ...server, args: ['--token', 'sk-ant-api03-' + 'x'.repeat(40)] }))).toBe('secrets');
  });

  it('[R30.3] los agentes se asignan servidores que existen; borrar uno lo quita de ellos', async () => {
    const p = await ProjectStore.create(await tmp(), { name: 'P' });
    await p.saveMcp(server);
    await p.saveAgent({ ...newAgent('pintor', 'Pintor'), mcpIds: ['pixel'] });
    expect(await codeOf(p.saveAgent({ ...newAgent('otro', 'Otro'), mcpIds: ['nada'] }))).toBe('invalid');
    expect(await p.usageOfMcp('pixel')).toEqual([{ agentId: 'pintor', name: 'Pintor' }]);
    expect(await p.deleteMcp('pixel')).toBe(true);
    expect((await p.listAgents())[0]!.mcpIds).toEqual([]);
  });

  it('[R30.8] los secretos se guardan cifrados por proyecto y servidor; solo se ven sus nombres', async () => {
    const dir = await tmp();
    const v = new McpSecretVault(dir, fake());
    await v.set('p1:pixel', 'API_KEY', 'secreto-123');
    await v.set('p2:pixel', 'API_KEY', 'otro');
    expect(await v.names('p1:pixel')).toEqual(['API_KEY']);
    expect(await v.read('p1:pixel')).toEqual({ API_KEY: 'secreto-123' });
    expect(await fs.readFile(v.file, 'utf8')).not.toContain('secreto-123');
    await v.remove('p1:pixel', 'API_KEY');
    expect(await v.names('p1:pixel')).toEqual([]);
    expect(await v.read('p2:pixel')).toEqual({ API_KEY: 'otro' });
    await v.remove('p2:pixel');
    expect(await v.names('p2:pixel')).toEqual([]);
    expect(await codeOf(new McpSecretVault(await tmp(), fake(false)).set('k', 'A', 'x'))).toBe('unavailable');
    expect(await codeOf(v.set('k', 'A', ''))).toBe('invalid');
  });

  it('[R30.9] un servidor «para todos mis proyectos» se guarda en la app, se ve en cada proyecto y se puede mover', async () => {
    const appDir = join(await tmp(), 'mcp');
    const a = await ProjectStore.create(await tmp(), { name: 'A' });
    const b = await ProjectStore.create(await tmp(), { name: 'B' });
    a.useAppMcp(appDir);
    b.useAppMcp(appDir);
    await a.saveMcp({ ...server, scope: 'app' });
    expect(await a.mcp.list()).toEqual([]);
    expect((await b.listMcp()).map((m) => [m.id, m.scope])).toEqual([['pixel', 'app']]);
    expect(await b.scopeOfMcp('pixel')).toBe('app');
    // un agente de otro proyecto puede usarlo
    await b.saveAgent({ ...newAgent('pintor', 'Pintor'), mcpIds: ['pixel'] });
    // pasarlo a «solo este proyecto» lo mueve
    await b.saveMcp({ ...server, scope: 'project' });
    expect(await b.scopeOfMcp('pixel')).toBe('project');
    expect(await a.listMcp()).toEqual([]);
    // si un id está en los dos, gana el del proyecto
    await a.saveMcp({ ...server, name: 'De la app', scope: 'app' });
    expect((await b.listMcp()).map((m) => [m.name, m.scope])).toEqual([['Pixel', 'project']]);
    // borrar uno de la app
    expect(await a.deleteMcp('pixel')).toBe(true);
    expect(await a.listMcp()).toEqual([]);
    // sin carpeta de la app no se puede guardar para todos
    const c = await ProjectStore.create(await tmp(), { name: 'C' });
    expect(await codeOf(c.saveMcp({ ...server, scope: 'app' }))).toBe('unavailable');
  });

  it('[R30.9] los secretos se mueven de clave al cambiar el ámbito', async () => {
    const v = new McpSecretVault(await tmp(), fake());
    await v.set('p1:pixel', 'API_KEY', 's');
    await v.move('p1:pixel', 'app:pixel');
    expect(await v.read('app:pixel')).toEqual({ API_KEY: 's' });
    expect(await v.names('p1:pixel')).toEqual([]);
  });
});
