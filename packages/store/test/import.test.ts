import { promises as fs } from 'node:fs';
import path from 'node:path';
import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { analyzeImport, installImport, newAgent } from '@orquestador/core';
import { ProjectStore, StoreError, readFolder, readZip } from '../src';
import { cleanupTmp, tmp } from './helpers';

cleanupTmp();
const enc = new TextEncoder();
const AGENT = '---\nname: revisor\ndescription: Revisa sprites\nskills: pixel-art\n---\nRevisa.\n';
const SKILL = '---\nname: pixel-art\ndescription: Dibuja sprites\n---\n# Pasos\n';
const PKG = { 'agents/revisor.md': AGENT, 'skills/pixel-art/SKILL.md': SKILL, 'skills/pixel-art/plantillas/base.txt': 'base', 'skills/pixel-art/run.sh': 'echo' };
const zip = (o: Record<string, string>) => zipSync(Object.fromEntries(Object.entries(o).map(([k, v]) => [k, enc.encode(v)])));
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof StoreError ? `${e.code}: ${e.message}` : 'otro';
  }
  return 'sin error';
};

async function project() {
  return ProjectStore.create(await tmp(), { name: 'P' });
}
async function plan(store: ProjectStore, files: Record<string, string> = PKG) {
  return analyzeImport(readZip(zip(files)), { agentIds: new Set((await store.listAgents()).map((a) => a.id)), skillIds: new Set(await store.listSkillIds()) });
}

describe('SPEC-025 · lectura segura de paquetes', () => {
  it('[R25.3] lee un Zip a memoria sin escribir nada y salta las carpetas', () => {
    const tree = readZip(zipSync({ 'a/': new Uint8Array(), 'a/b.md': enc.encode('hola') }));
    expect(tree.files.map((f) => f.path)).toEqual(['a/b.md']);
  });

  it('[R25.3] rechaza rutas absolutas, con .. y letras de unidad (zip-slip) sin revelar rutas', () => {
    for (const name of ['../fuera.md', 'a/../../fuera.md', '/etc/passwd', 'C:/x.md', 'C:\\x.md']) {
      const r = code(() => readZip(zipSync({ [name]: enc.encode('x') })));
      expect(r).toMatch(/^invalid: El Zip contiene rutas no permitidas/);
      expect(r).not.toContain('fuera');
    }
  });

  it('[R25.3] rechaza paquetes con demasiados archivos o archivos enormes', () => {
    const many = Object.fromEntries(Array.from({ length: 501 }, (_, i) => [`f${i}.txt`, enc.encode('x')]));
    expect(code(() => readZip(zipSync(many)))).toMatch(/demasiado grande/);
    expect(code(() => readZip(zipSync({ 'a.bin': new Uint8Array(2 * 1024 * 1024 + 1) })))).toMatch(/demasiado grande/);
    expect(code(() => readZip(zipSync(Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`f${i}.bin`, new Uint8Array(1_900_000)])))))).toMatch(/demasiado grande/);
  });

  it('[R25.3] un archivo que no es un Zip da un error claro', () => {
    expect(code(() => readZip(enc.encode('esto no es un zip')))).toBe('invalid: El archivo no es un Zip válido');
  });

  it('[R25.3] lee carpetas, rechaza enlaces simbólicos y respeta los límites', async () => {
    const dir = await tmp();
    await fs.mkdir(path.join(dir, 'agents'), { recursive: true });
    await fs.writeFile(path.join(dir, 'agents', 'a.md'), AGENT);
    await fs.mkdir(path.join(dir, '.git'));
    await fs.writeFile(path.join(dir, '.git', 'config'), 'x');
    expect((await readFolder(dir)).files.map((f) => f.path)).toEqual(['agents/a.md']);
    await fs.symlink('/etc/hostname', path.join(dir, 'enlace.md'));
    await expect(readFolder(dir)).rejects.toMatchObject({ code: 'invalid', message: expect.stringMatching(/enlace simbólico/) });
    const big = await tmp();
    await fs.writeFile(path.join(big, 'a.bin'), new Uint8Array(2 * 1024 * 1024 + 1));
    await expect(readFolder(big)).rejects.toMatchObject({ code: 'invalid' });
  });
});

describe('SPEC-025 · instalación', () => {
  it('[R25.7] analizar no escribe nada en el proyecto', async () => {
    const p = await project();
    await plan(p);
    expect(await p.listSkillIds()).toEqual([]);
    expect(await p.listAgents()).toEqual([]);
  });

  it('[R25.6] instala solo lo marcado, con los archivos de la skill y las referencias entre ambos', async () => {
    const p = await project();
    const pl = await plan(p);
    const res = await installImport(p, pl, pl.report.items.map((i) => i.key));
    expect(res).toMatchObject({ agents: ['revisor'], skills: ['pixel-art'], failed: [] });
    expect((await p.listAgents())[0]).toMatchObject({ id: 'revisor', skillIds: ['pixel-art'], instructions: 'Revisa.' });
    expect((await p.loadSkill('pixel-art')).description).toBe('Dibuja sprites');
    expect(await p.skillFiles('pixel-art')).toEqual([{ path: 'plantillas/base.txt', size: 4 }, { path: 'run.sh', size: 4 }]);
  });

  it('[R25.6] si el agente se instala sin su skill, se quita la referencia y se avisa', async () => {
    const p = await project();
    const pl = await plan(p);
    const res = await installImport(p, pl, ['agent:agents/revisor.md']);
    expect(res.agents).toEqual(['revisor']);
    expect((await p.listAgents())[0]!.skillIds).toEqual([]);
    expect(res.notes[0]).toMatch(/skills que no se instalaron/);
    expect(await p.listSkillIds()).toEqual([]);
  });

  it('[R25.6] un id ocupado desde el análisis se sustituye por uno libre, nunca se sobrescribe', async () => {
    const p = await project();
    const pl = await plan(p);
    await p.saveAgent({ ...newAgent('revisor', 'Mío'), instructions: 'original' });
    const res = await installImport(p, pl, ['agent:agents/revisor.md']);
    expect(res.agents).toEqual(['revisor-2']);
    expect(res.notes.join()).toMatch(/se instaló como «revisor-2»/);
    expect((await p.listAgents()).find((a) => a.id === 'revisor')!.instructions).toBe('original');
  });

  it('[R25.6] un elemento que falla no detiene a los demás y no deja restos', async () => {
    const p = await project();
    const pl = await plan(p, {
      'skills/mala/SKILL.md': '---\nname: mala\ndescription: d\n---\nclave sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789',
      'skills/buena/SKILL.md': '---\nname: buena\ndescription: d\n---\nok',
      'agents/sin-desc.md': '---\nname: sin-desc\n---\n' + 'x'.repeat(20_001),
    });
    const res = await installImport(p, pl, pl.report.items.map((i) => i.key).concat('skill:inventada'));
    expect(res.skills).toEqual(['buena']);
    expect(res.failed.map((f) => f.key).sort()).toEqual(['agent:agents/sin-desc.md', 'skill:inventada', 'skill:skills/mala']);
    expect(await p.listSkillIds()).toEqual(['buena']);
  });

  it('[R25.7] una importación sin elementos marcados no instala nada', async () => {
    const p = await project();
    const res = await installImport(p, await plan(p), []);
    expect(res).toEqual({ agents: [], skills: [], failed: [], notes: [] });
    expect(await p.listAgents()).toEqual([]);
  });
});
