import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newSkill } from '@orquestador/core';
import { PROJECT_GITIGNORE, ProjectStore, StoreError } from '../src';

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'orq-sec-c-'));
});
afterEach(() => fs.rm(dir, { recursive: true, force: true }));

describe('SPEC-090 · .gitignore de .orquestador', () => {
  it('[R90.7] al crear o abrir se crea con lo de cada equipo; si ya existe, no se toca', async () => {
    const store = await ProjectStore.create(join(dir, 'p'), { name: 'p' });
    const file = join(store.paths.orq, '.gitignore');
    const text = await fs.readFile(file, 'utf8');
    for (const line of ['runs/', 'copias/', 'attachments/', 'supervisor/', 'approved-checks.json']) expect(text.split('\n')).toContain(line);
    expect(PROJECT_GITIGNORE).toContain('runs/');
    await fs.writeFile(file, 'mio/\n');
    await ProjectStore.open(join(dir, 'p'));
    expect(await fs.readFile(file, 'utf8')).toBe('mio/\n');
    await fs.rm(file);
    await ProjectStore.open(join(dir, 'p'));
    expect(await fs.readFile(file, 'utf8')).toContain('runs/');
  });
});

describe('SPEC-090 · enlaces en las skills', () => {
  it('[R90.14] leer, escribir o guardar a través de un enlace que sale de la skill falla', async () => {
    const store = await ProjectStore.create(join(dir, 'p'), { name: 'p' });
    await store.saveSkill({ ...newSkill('guia', 'Guía'), description: 'x', body: '# Pasos' });
    const outside = join(dir, 'fuera');
    await fs.mkdir(outside, { recursive: true });
    await fs.writeFile(join(outside, 'secreto.txt'), 'no');
    await fs.mkdir(join(store.paths.skillDir('guia'), 'referencias'), { recursive: true });
    // Una junction en Windows (sin permisos especiales); un enlace de carpeta en el resto.
    await fs.symlink(outside, join(store.paths.skillDir('guia'), 'referencias', 'fuera'), process.platform === 'win32' ? 'junction' : 'dir');
    const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof StoreError ? e.code : String(e)));
    expect(await code(store.readSkillFile('guia', 'referencias/fuera/secreto.txt'))).toBe('outside-root');
    expect(await code(store.writeSkillFile('guia', 'referencias/fuera/nuevo.txt', new Uint8Array([1])))).toBe('outside-root');
    expect(await code(store.saveSkillText('guia', 'referencias/fuera/secreto.txt', 'x'))).toBe('outside-root');
    expect(await fs.readFile(join(outside, 'secreto.txt'), 'utf8')).toBe('no');
    await store.writeSkillFile('guia', 'referencias/propio.txt', new TextEncoder().encode('sí'));
    expect((await store.readSkillFile('guia', 'referencias/propio.txt')).text).toBe('sí');
  });
});
