import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultSettings } from '@orquestador/core';
import { MCP_SECRETS_UNREADABLE, McpSecretVault, SettingsStore, type SecretCipher } from '../src';

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'orq-sec-b-'));
});
afterEach(() => fs.rm(dir, { recursive: true, force: true }));

const fake: SecretCipher = {
  available: () => true,
  encrypt: (s) => Buffer.from(s.split('').reverse().join('')),
  decrypt: (b) => b.toString().split('').reverse().join(''),
};

describe('SPEC-089 · ajustes dañados', () => {
  it('[R89.5] E89.b: un settings.json dañado se copia, se arranca con «Preguntar» y así sigue hasta guardar', async () => {
    const store = new SettingsStore(dir);
    expect((await store.load()).permissions).toBe(defaultSettings().permissions);
    await fs.writeFile(store.file, '{ esto no es json');
    const s = await store.load();
    expect(s.permissions).toBe('ask');
    expect(store.recovered).toBe(true);
    expect(await fs.readFile(`${store.file}.danado`, 'utf8')).toBe('{ esto no es json');
    // Otro arranque sin guardar: sigue dañado y sigue preguntando.
    const again = new SettingsStore(dir);
    expect((await again.load()).permissions).toBe('ask');
    await again.save({ ...s, permissions: 'auto' });
    expect(again.recovered).toBe(false);
    expect((await new SettingsStore(dir).load()).permissions).toBe('auto');
  });
});

describe('SPEC-089 · secretos MCP', () => {
  it('[R89.7] si no se pueden leer, leer da vacío y cambiar falla sin tocar el archivo', async () => {
    const v = new McpSecretVault(dir, fake);
    await v.set('p:github', 'TOKEN', 'uno');
    const broken = new McpSecretVault(dir, { ...fake, decrypt: () => '{roto' });
    expect(await broken.read('p:github')).toEqual({});
    expect(await broken.names('p:github')).toEqual([]);
    const before = await fs.readFile(v.file, 'utf8');
    await expect(broken.set('p:notion', 'KEY', 'dos')).rejects.toThrow(MCP_SECRETS_UNREADABLE);
    await expect(broken.remove('p:github')).rejects.toThrow(MCP_SECRETS_UNREADABLE);
    await expect(broken.move('p:github', 'app:github')).rejects.toThrow(MCP_SECRETS_UNREADABLE);
    expect(await fs.readFile(v.file, 'utf8')).toBe(before);
    expect(await v.read('p:github')).toEqual({ TOKEN: 'uno' });
  });

  it('[R89.8] dos escrituras seguidas conservan las dos y antes de escribir queda copia del anterior', async () => {
    const v = new McpSecretVault(dir, fake);
    await Promise.all([v.set('p:a', 'X', '1'), v.set('p:b', 'Y', '2'), v.set('p:a', 'Z', '3')]);
    expect(await v.read('p:a')).toEqual({ X: '1', Z: '3' });
    expect(await v.read('p:b')).toEqual({ Y: '2' });
    const bak = JSON.parse(fake.decrypt(Buffer.from(await fs.readFile(`${v.file}.bak`, 'utf8'), 'base64'))) as Record<string, unknown>;
    expect(Object.keys(bak).sort()).toEqual(['p:a', 'p:b']);
  });
});
