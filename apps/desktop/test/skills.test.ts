import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newAgent, type ImportReport } from '@orquestador/core';
import { CHANNELS, parseRequest } from '@orquestador/editor';
import { createDemoOrchestrator } from '@orquestador/runtime';
import { DesktopHandlers } from '../src/main/handlers';

let dir: string;
let picks: (string | null)[];
let imports: (string | null)[];
let refPicks: (string[] | null)[];
let h: DesktopHandlers;
const enc = new TextEncoder();
const AGENT = '---\nname: revisor\ndescription: Revisa\nskills: pixel-art\n---\nRevisa.\n';
const SKILL = '---\nname: pixel-art\ndescription: Dibuja sprites\n---\n# Pasos\n';
const value = <T,>(r: { ok: boolean }) => (r as unknown as { value: T }).value;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'orq-skills-'));
  picks = [];
  imports = [];
  refPicks = [];
  h = new DesktopHandlers({ pickFolder: async () => picks.shift() ?? null, pickImport: async () => imports.shift() ?? null, pickSkillFiles: async () => refPicks.shift() ?? null, createOrchestrator: createDemoOrchestrator });
});
afterEach(() => rm(dir, { recursive: true, force: true }));

async function open() {
  picks.push(join(dir, 'proy'));
  await h.invoke(CHANNELS.createProject, undefined);
}
async function packageDir(files: Record<string, string>) {
  const root = await mkdtemp(join(dir, 'pkg-'));
  for (const [p, text] of Object.entries(files)) {
    await mkdir(join(root, p, '..'), { recursive: true });
    await writeFile(join(root, p), text);
  }
  return root;
}
const FILES = { 'agents/revisor.md': AGENT, 'skills/pixel-art/SKILL.md': SKILL, 'skills/pixel-art/run.sh': 'echo' };

describe('SPEC-024 · IPC de skills', () => {
  it('[R24.5] guardar, listar, consultar usos, archivos y borrar', async () => {
    await open();
    const skill = { id: 'pixel', name: 'Pixel', description: 'Cuándo', body: 'Texto' };
    expect(await h.invoke(CHANNELS.saveSkill, skill)).toMatchObject({ ok: true });
    expect(await h.invoke(CHANNELS.saveAgent, { ...newAgent('a', 'A'), skillIds: ['pixel'] })).toMatchObject({ ok: true });
    expect(value(await h.invoke(CHANNELS.listSkills, undefined))).toEqual([skill]);
    expect(value(await h.invoke(CHANNELS.skillUsage, 'pixel'))).toEqual([{ agentId: 'a', name: 'A' }]);
    expect(value(await h.invoke(CHANNELS.skillFiles, 'pixel'))).toEqual([]);
    expect(value(await h.invoke(CHANNELS.deleteSkill, 'pixel'))).toBe(true);
    expect(value<{ skillIds: string[] }[]>(await h.invoke(CHANNELS.listAgents, undefined))[0]!.skillIds).toEqual([]);
  });

  it('[R24.5] una skill inválida devuelve los campos; sin proyecto falla con claridad', async () => {
    expect(await h.invoke(CHANNELS.listSkills, undefined)).toMatchObject({ ok: false, error: { code: 'not-found' } });
    await open();
    const r = await h.invoke(CHANNELS.saveSkill, { id: 'x', name: 'X', description: '', body: '' });
    expect(r).toMatchObject({ ok: false, error: { code: 'invalid', fields: [{ field: 'description' }] } });
    expect(await h.invoke(CHANNELS.saveAgent, { ...newAgent('a', 'A'), skillIds: ['nada'] })).toMatchObject({ ok: false, error: { code: 'invalid' } });
  });

  it('[R24.5] la petición se valida: campos extra, ids con rutas y tipos erróneos', () => {
    const s = { id: 'a', name: 'A', description: 'd', body: '' };
    expect(parseRequest(CHANNELS.saveSkill, s)).toBe(s);
    expect(() => parseRequest(CHANNELS.saveSkill, { ...s, files: [] })).toThrow();
    expect(() => parseRequest(CHANNELS.saveSkill, { ...s, id: '../x' })).toThrow();
    expect(() => parseRequest(CHANNELS.saveSkill, { ...s, body: 3 })).toThrow();
    expect(() => parseRequest(CHANNELS.skillFiles, 'a/b')).toThrow();
    expect(() => parseRequest(CHANNELS.saveAgent, { ...newAgent('a', 'A'), skillIds: ['../x'] })).toThrow();
  });
});

describe('SPEC-025 · IPC de instalación', () => {
  it('[R25.8] valida la forma de las peticiones', () => {
    expect(parseRequest(CHANNELS.inspectImport, 'zip')).toBe('zip');
    expect(() => parseRequest(CHANNELS.inspectImport, '/etc')).toThrow();
    expect(() => parseRequest(CHANNELS.inspectImport, { path: '/etc' })).toThrow();
    expect(() => parseRequest(CHANNELS.confirmImport, { importId: 'a', keys: [], ruta: '/x' })).toThrow();
    expect(() => parseRequest(CHANNELS.confirmImport, { importId: '../a', keys: [] })).toThrow();
    expect(() => parseRequest(CHANNELS.confirmImport, { importId: 'a', keys: [3] })).toThrow();
    expect(parseRequest(CHANNELS.confirmImport, { importId: 'a-1', keys: ['k'] })).toEqual({ importId: 'a-1', keys: ['k'] });
  });

  it('[R25.1] cancelar el diálogo no hace nada', async () => {
    await open();
    expect(value(await h.invoke(CHANNELS.inspectImport, 'folder'))).toBeNull();
  });

  it('[R25.1][R25.7] analizar una carpeta devuelve el informe sin instalar; confirmar instala lo marcado una sola vez', async () => {
    await open();
    imports.push(await packageDir(FILES));
    const res = value<{ importId: string; report: ImportReport }>(await h.invoke(CHANNELS.inspectImport, 'folder'));
    expect(res.report.items.map((i) => i.key).sort()).toEqual(['agent:agents/revisor.md', 'skill:skills/pixel-art']);
    expect(res.report.items.find((i) => i.kind === 'skill')!.warnings.some((w) => w.code === 'script')).toBe(true);
    expect(value(await h.invoke(CHANNELS.listAgents, undefined))).toEqual([]);
    const done = await h.invoke(CHANNELS.confirmImport, { importId: res.importId, keys: res.report.items.map((i) => i.key) });
    expect(done).toMatchObject({ ok: true, value: { agents: ['revisor'], skills: ['pixel-art'], failed: [] } });
    expect(value<{ skillIds: string[] }[]>(await h.invoke(CHANNELS.listAgents, undefined))[0]!.skillIds).toEqual(['pixel-art']);
    expect(await h.invoke(CHANNELS.skillFiles, 'pixel-art')).toMatchObject({ ok: true, value: [{ path: 'run.sh', size: 4 }] });
    expect(await h.invoke(CHANNELS.confirmImport, { importId: res.importId, keys: [] })).toMatchObject({ ok: false, error: { code: 'not-found' } });
  });

  it('[R25.1] analiza un Zip elegido con el diálogo', async () => {
    await open();
    const file = join(dir, 'paquete.zip');
    await writeFile(file, zipSync({ 'agents/revisor.md': enc.encode(AGENT) }));
    imports.push(file);
    const res = value<{ report: ImportReport }>(await h.invoke(CHANNELS.inspectImport, 'zip'));
    expect(res.report.items.map((i) => i.id)).toEqual(['revisor']);
  });

  it('[R25.3] un Zip peligroso o un enlace simbólico se rechazan con un mensaje sin rutas', async () => {
    await open();
    const bad = join(dir, 'malo.zip');
    await writeFile(bad, zipSync({ '../fuera.md': enc.encode('x') }));
    imports.push(bad);
    const r = await h.invoke(CHANNELS.inspectImport, 'zip');
    expect(r).toMatchObject({ ok: false, error: { code: 'invalid' } });
    expect(JSON.stringify(r)).not.toContain(dir);
    const pkg = await packageDir(FILES);
    await symlink('/etc/hostname', join(pkg, 'enlace.md'));
    imports.push(pkg);
    const s = await h.invoke(CHANNELS.inspectImport, 'folder');
    expect(s).toMatchObject({ ok: false, error: { code: 'invalid' } });
    expect(JSON.stringify(s)).not.toContain(dir);
  });

  it('[R25.7] cancelar, analizar otra o cambiar de proyecto descarta la importación anterior', async () => {
    await open();
    imports.push(await packageDir(FILES));
    const a = value<{ importId: string }>(await h.invoke(CHANNELS.inspectImport, 'folder'));
    expect(await h.invoke(CHANNELS.cancelImport, a.importId)).toMatchObject({ ok: true });
    expect(await h.invoke(CHANNELS.confirmImport, { importId: a.importId, keys: ['skill:skills/pixel-art'] })).toMatchObject({ ok: false });
    imports.push(await packageDir(FILES));
    const b = value<{ importId: string }>(await h.invoke(CHANNELS.inspectImport, 'folder'));
    imports.push(await packageDir(FILES));
    const c = value<{ importId: string }>(await h.invoke(CHANNELS.inspectImport, 'folder'));
    expect(await h.invoke(CHANNELS.confirmImport, { importId: b.importId, keys: [] })).toMatchObject({ ok: false });
    picks.push(join(dir, 'otro'));
    await h.invoke(CHANNELS.createProject, undefined);
    expect(await h.invoke(CHANNELS.confirmImport, { importId: c.importId, keys: [] })).toMatchObject({ ok: false });
  });
});

describe('SPEC-024 · IPC de archivos de referencia', () => {
  const skill = { id: 'pixel', name: 'Pixel', description: 'Cuándo', body: 'Texto' };
  async function withSkill() {
    await open();
    await h.invoke(CHANNELS.saveSkill, skill);
  }

  it('[R24.9] añade archivos sueltos y una carpeta bajo referencias/', async () => {
    await withSkill();
    const src = await packageDir({ 'nota.txt': 'hola', 'run.sh': 'echo' });
    refPicks.push([join(src, 'nota.txt'), join(src, 'run.sh')]);
    const r = value<{ added: { path: string }[]; scripts: string[]; renamed: number }>(await h.invoke(CHANNELS.addSkillFiles, { id: 'pixel', kind: 'files' }));
    expect(r.added.map((f) => f.path).sort()).toEqual(['referencias/nota.txt', 'referencias/run.sh']);
    expect(r.scripts).toEqual(['referencias/run.sh']);
    const folder = await packageDir({ 'sub/uno.md': '# uno' });
    refPicks.push([folder]);
    const f = value<{ added: { path: string }[] }>(await h.invoke(CHANNELS.addSkillFiles, { id: 'pixel', kind: 'folder' }));
    expect(f.added[0]!.path).toMatch(/^referencias\/pkg-[^/]+\/sub\/uno\.md$/);
    const listed = value<{ path: string }[]>(await h.invoke(CHANNELS.skillFiles, 'pixel'));
    expect(listed).toHaveLength(3);
  });

  it('[R24.9] cancelar el diálogo devuelve null y una skill inexistente falla sin abrir el diálogo', async () => {
    await withSkill();
    expect(value(await h.invoke(CHANNELS.addSkillFiles, { id: 'pixel', kind: 'files' }))).toBeNull();
    refPicks.push(['x']);
    expect(await h.invoke(CHANNELS.addSkillFiles, { id: 'nada', kind: 'files' })).toMatchObject({ ok: false });
    expect(refPicks).toHaveLength(1);
  });

  it('[R24.10] rechaza enlaces simbólicos y archivos enormes sin filtrar rutas', async () => {
    await withSkill();
    const src = await packageDir({ 'real.txt': 'x' });
    await symlink(join(src, 'real.txt'), join(src, 'enlace.txt'));
    refPicks.push([join(src, 'enlace.txt')]);
    const r = await h.invoke(CHANNELS.addSkillFiles, { id: 'pixel', kind: 'files' });
    expect(r).toMatchObject({ ok: false, error: { code: 'invalid' } });
    expect(JSON.stringify(r)).not.toContain(dir);
    await writeFile(join(src, 'grande.bin'), new Uint8Array(2 * 1024 * 1024 + 1));
    refPicks.push([join(src, 'grande.bin')]);
    const g = await h.invoke(CHANNELS.addSkillFiles, { id: 'pixel', kind: 'files' });
    expect(g).toMatchObject({ ok: false });
    expect(JSON.stringify(g)).not.toContain(dir);
    expect(value(await h.invoke(CHANNELS.skillFiles, 'pixel'))).toEqual([]);
  });

  it('[R24.11] quita un archivo; SKILL.md y rutas fuera de la skill no se tocan', async () => {
    await withSkill();
    const src = await packageDir({ 'a.txt': 'x' });
    refPicks.push([join(src, 'a.txt')]);
    await h.invoke(CHANNELS.addSkillFiles, { id: 'pixel', kind: 'files' });
    expect(await h.invoke(CHANNELS.removeSkillFile, { id: 'pixel', path: 'SKILL.md' })).toMatchObject({ ok: false });
    expect(value(await h.invoke(CHANNELS.removeSkillFile, { id: 'pixel', path: 'referencias/a.txt' }))).toBe(true);
    expect(value(await h.invoke(CHANNELS.skillFiles, 'pixel'))).toEqual([]);
  });

  it('[R24.12] lee texto, recorta lo enorme y rechaza binarios', async () => {
    await withSkill();
    const src = await packageDir({ 'a.txt': 'hola', 'b.bin': '\u0000\u0001' });
    refPicks.push([join(src, 'a.txt'), join(src, 'b.bin')]);
    await h.invoke(CHANNELS.addSkillFiles, { id: 'pixel', kind: 'files' });
    expect(value(await h.invoke(CHANNELS.readSkillFile, { id: 'pixel', path: 'referencias/a.txt' }))).toEqual({ text: 'hola', truncated: false });
    expect(await h.invoke(CHANNELS.readSkillFile, { id: 'pixel', path: 'referencias/b.bin' })).toMatchObject({ ok: false });
  });

  it('[R24.13] la petición se valida: ids, rutas, tipos y campos extra', () => {
    const ok = { id: 'pixel', kind: 'files' };
    expect(parseRequest(CHANNELS.addSkillFiles, ok)).toBe(ok);
    expect(() => parseRequest(CHANNELS.addSkillFiles, { id: 'pixel', kind: 'zip' })).toThrow();
    expect(() => parseRequest(CHANNELS.addSkillFiles, { id: 'pixel', kind: 'files', path: '/etc' })).toThrow();
    expect(() => parseRequest(CHANNELS.addSkillFiles, { id: '../x', kind: 'files' })).toThrow();
    for (const ch of [CHANNELS.removeSkillFile, CHANNELS.readSkillFile]) {
      const good = { id: 'pixel', path: 'referencias/a.txt' };
      expect(parseRequest(ch, good)).toBe(good);
      for (const path of ['../a.txt', '/etc/passwd', 'C:\\x.txt', 'a/../../b', '']) expect(() => parseRequest(ch, { id: 'pixel', path })).toThrow();
      expect(() => parseRequest(ch, { id: 'pixel', path: 'a.txt', extra: 1 })).toThrow();
    }
  });
});
