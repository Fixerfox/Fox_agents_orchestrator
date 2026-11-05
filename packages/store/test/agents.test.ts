import { promises as fs } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { newAgent, newContext, type Diagram } from '@orquestador/core';
import { ApiKeyVault, ProjectStore, SettingsStore, StoreError, type SecretCipher } from '../src';
import { ENTRY, OUTPUT, cleanupTmp, tmp } from './helpers';

cleanupTmp();

const fake = (on = true): SecretCipher => ({
  available: () => on,
  encrypt: (s) => Buffer.from(s.split('').reverse().join('')),
  decrypt: (b) => b.toString().split('').reverse().join(''),
});

async function project(): Promise<ProjectStore> {
  return ProjectStore.create(await tmp(), { name: 'Prueba' });
}

const diagramWith = (agentId: string, id = 'd1'): Diagram =>
  ({
    id,
    schemaVersion: 1,
    name: `Diagrama ${id}`,
    nodes: [ENTRY, { id: 'a', kind: 'agent', label: 'A', agentId }, OUTPUT],
    edges: [],
  }) as unknown as Diagram;

const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e instanceof StoreError ? e.code : 'otro';
  }
  return 'sin error';
};

describe('SPEC-022 · agentes y contextos guardados', () => {
  it('[R22.3] guarda y lista agentes y contextos como JSON versionado', async () => {
    const p = await project();
    await p.saveContext({ ...newContext('guia', 'Guía', 'text'), value: 'Hola' });
    await p.saveAgent({ ...newAgent('pintor', 'Pintor'), contextIds: ['guia'] });
    expect((await p.listAgents()).map((a) => a.id)).toEqual(['pintor']);
    expect((await p.listContexts()).map((c) => c.id)).toEqual(['guia']);
    const raw = JSON.parse(await fs.readFile(`${p.paths.agentsDir}/pintor.json`, 'utf8'));
    expect(raw.schemaVersion).toBe(1);
  });

  it('[R22.1] rechaza un agente inválido con los campos con problema', async () => {
    const p = await project();
    const err = await p.saveAgent({ ...newAgent('x', '  ') }).catch((e) => e);
    expect(err).toBeInstanceOf(StoreError);
    expect(err.code).toBe('invalid');
    expect(err.fields.some((f: { field: string }) => f.field === 'name')).toBe(true);
  });

  it('[R22.4] no admite contextos que no existen', async () => {
    const p = await project();
    expect(await codeOf(p.saveAgent({ ...newAgent('a', 'A'), contextIds: ['nada'] }))).toBe('invalid');
  });

  it('[R22.3] un contexto con ruta fuera del proyecto se rechaza', async () => {
    const p = await project();
    expect(await codeOf(p.saveContext({ ...newContext('f', 'F', 'file'), value: '../secreto.txt' }))).toBe('invalid');
  });

  it('[R22.4] borrar un contexto lo quita de los agentes que lo usaban', async () => {
    const p = await project();
    await p.saveContext({ ...newContext('guia', 'Guía'), value: 'Texto' });
    await p.saveAgent({ ...newAgent('a', 'A'), contextIds: ['guia'] });
    expect((await p.usageOfContext('guia')).map((u) => u.agentId)).toEqual(['a']);
    expect(await p.deleteContext('guia')).toBe(true);
    expect((await p.listAgents())[0]!.contextIds).toEqual([]);
    expect(await p.deleteContext('guia')).toBe(false);
  });

  it('[R22.4] uso de un agente en diagramas y plantillas; borrarlo lo elimina', async () => {
    const p = await project();
    await p.saveAgent(newAgent('a', 'A'));
    await p.diagrams.save(diagramWith('a'));
    await p.diagrams.save(diagramWith('otro', 'd2'));
    expect((await p.usageOfAgent('a')).map((u) => u.diagramId)).toEqual(['d1']);
    expect(await p.deleteAgent('a')).toBe(true);
    expect(await p.listAgents()).toEqual([]);
  });
});

describe('SPEC-023 · ajustes y clave API', () => {
  it('[R23.1][R23.2] sin archivo devuelve los de por defecto; guarda y recarga', async () => {
    const s = new SettingsStore(await tmp());
    expect((await s.load()).maxParallel).toBe(4);
    await s.save({ ...(await s.load()), maxParallel: 8, authMode: 'api-key' });
    const back = await s.load();
    expect(back.maxParallel).toBe(8);
    expect(back.authMode).toBe('api-key');
  });

  it('[R23.1] rechaza ajustes inválidos y un archivo dañado vuelve a los de por defecto', async () => {
    const dir = await tmp();
    const s = new SettingsStore(dir);
    expect(await codeOf(s.save({ ...(await s.load()), maxParallel: 99 }))).toBe('invalid');
    await fs.writeFile(s.file, '{no es json');
    expect((await s.load()).maxParallel).toBe(4);
  });

  it('[R23.2] el archivo de ajustes no contiene secretos', async () => {
    const s = new SettingsStore(await tmp());
    await s.save(await s.load());
    expect(await fs.readFile(s.file, 'utf8')).not.toMatch(/sk-ant/);
  });

  it('[R23.3] la clave se guarda cifrada y solo se lee en el proceso principal', async () => {
    const dir = await tmp();
    const v = new ApiKeyVault(dir, fake());
    expect(await v.has()).toBe(false);
    await v.set('sk-ant-123');
    expect(await v.has()).toBe(true);
    expect(await fs.readFile(v.file, 'utf8')).not.toContain('sk-ant-123');
    expect(await v.read()).toBe('sk-ant-123');
    expect(await v.clear()).toBe(true);
    expect(await v.has()).toBe(false);
    expect(await v.clear()).toBe(false);
  });

  it('[R23.3] rechaza claves vacías, con espacios o demasiado largas', async () => {
    const v = new ApiKeyVault(await tmp(), fake());
    expect(await codeOf(v.set(''))).toBe('invalid');
    expect(await codeOf(v.set('a b'))).toBe('invalid');
    expect(await codeOf(v.set('x'.repeat(501)))).toBe('invalid');
  });

  it('[R23.3] sin cifrado disponible no se guarda y se explica', async () => {
    const v = new ApiKeyVault(await tmp(), fake(false));
    expect(await codeOf(v.set('sk-ant-1'))).toBe('unavailable');
    expect(await v.has()).toBe(false);
  });
});

describe('SPEC-024 · skills en el proyecto', () => {
  const skill = (id: string, patch = {}) => ({ id, name: `Skill ${id}`, description: 'Cuándo usarla', body: 'Contenido', ...patch });

  it('[R24.2] guarda SKILL.md en formato nativo y la lee igual', async () => {
    const p = await project();
    await p.saveSkill(skill('pixel', { description: 'Usa "comillas": y dos puntos', body: '# Título\n\n- uno' }));
    const raw = await fs.readFile(`${p.paths.skillsDir}/pixel/SKILL.md`, 'utf8');
    expect(raw.startsWith('---\nname: "Skill pixel"\n')).toBe(true);
    expect(await p.loadSkill('pixel')).toEqual({ ...skill('pixel'), description: 'Usa "comillas": y dos puntos', body: '# Título\n\n- uno' });
    expect((await p.listSkills()).map((s) => s.id)).toEqual(['pixel']);
  });

  it('[R24.1] rechaza una skill inválida con los campos; [R24.2] no guarda secretos', async () => {
    const p = await project();
    const err = await p.saveSkill(skill('x', { description: '' })).catch((e) => e);
    expect(err.code).toBe('invalid');
    expect(err.fields[0].field).toBe('description');
    expect(await codeOf(p.saveSkill(skill('y', { body: 'mi clave sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789' })))).toBe('secrets');
    expect(await codeOf(p.saveSkill(skill('../fuera')))).toBe('invalid');
    expect(await p.listSkillIds()).toEqual([]);
  });

  it('[R24.3] editar conserva los demás archivos y borrar se lleva la carpeta entera', async () => {
    const p = await project();
    await p.saveSkill(skill('pixel'));
    await p.writeSkillFile('pixel', 'plantillas/base.txt', Buffer.from('hola'));
    await p.writeSkillFile('pixel', 'run.sh', Buffer.from('echo'));
    await p.saveSkill(skill('pixel', { body: 'Nuevo' }));
    expect(await p.skillFiles('pixel')).toEqual([{ path: 'plantillas/base.txt', size: 4 }, { path: 'run.sh', size: 4 }]);
    expect(await codeOf(p.writeSkillFile('pixel', '../x.txt', Buffer.from('')))).toBe('outside-root');
    expect(await codeOf(p.writeSkillFile('pixel', 'SKILL.md', Buffer.from('')))).toBe('outside-root');
    expect(await p.deleteSkill('pixel')).toBe(true);
    await expect(fs.access(p.paths.skillDir('pixel'))).rejects.toThrow();
    expect(await p.deleteSkill('pixel')).toBe(false);
  });

  it('[R24.4] un agente no puede usar skills inexistentes; los agentes anteriores se leen con skillIds vacío', async () => {
    const p = await project();
    expect(await codeOf(p.saveAgent({ ...newAgent('a', 'A'), skillIds: ['nada'] }))).toBe('invalid');
    await p.saveAgent(newAgent('viejo', 'Viejo'));
    const file = `${p.paths.agentsDir}/viejo.json`;
    const doc = JSON.parse(await fs.readFile(file, 'utf8'));
    delete doc.skillIds;
    await fs.writeFile(file, JSON.stringify(doc));
    expect((await p.listAgents())[0]!.skillIds).toEqual([]);
  });

  it('[R24.4] borrar una skill la quita de los agentes y se puede consultar dónde se usa', async () => {
    const p = await project();
    await p.saveSkill(skill('pixel'));
    await p.saveAgent({ ...newAgent('a', 'Agente A'), skillIds: ['pixel'] });
    expect(await p.usageOfSkill('pixel')).toEqual([{ agentId: 'a', name: 'Agente A' }]);
    expect(await p.deleteSkill('pixel')).toBe(true);
    expect((await p.listAgents())[0]!.skillIds).toEqual([]);
  });
});

describe('SPEC-024 · archivos de referencia', () => {
  const sk = { id: 'pixel', name: 'Pixel', description: 'Cuándo', body: 'x' };
  const f = (path: string, text = 'hola') => ({ path, data: new TextEncoder().encode(text) });

  it('[R24.9] copia los archivos bajo referencias/ sin sobrescribir y avisa de los scripts', async () => {
    const p = await project();
    await p.saveSkill(sk);
    const a = await p.addSkillFiles('pixel', [f('paleta.md'), f('colores/a.csv'), f('run.sh')]);
    expect(a.added.map((x) => x.path)).toEqual(['referencias/paleta.md', 'referencias/colores/a.csv', 'referencias/run.sh']);
    expect(a.scripts).toEqual(['referencias/run.sh']);
    const b = await p.addSkillFiles('pixel', [f('paleta.md', 'otra')]);
    expect(b).toMatchObject({ added: [{ path: 'referencias/paleta-2.md', size: 4 }], renamed: 1 });
    expect(await fs.readFile(`${p.paths.skillDir('pixel')}/referencias/paleta.md`, 'utf8')).toBe('hola');
    expect((await p.skillFiles('pixel')).map((x) => x.path)).toEqual(['referencias/colores/a.csv', 'referencias/paleta-2.md', 'referencias/paleta.md', 'referencias/run.sh']);
  });

  it('[R24.9] una skill que no existe falla con claridad y no escribe nada', async () => {
    const p = await project();
    expect(await codeOf(p.addSkillFiles('nada', [f('a.md')]))).toBe('not-found');
  });

  it('[R24.10] respeta los límites contando lo que ya hay y no copia nada si no caben', async () => {
    const p = await project();
    await p.saveSkill(sk);
    const big = { path: 'grande.bin', data: new Uint8Array(2 * 1024 * 1024 + 1) };
    expect(await codeOf(p.addSkillFiles('pixel', [f('ok.md'), big]))).toBe('invalid');
    expect(await p.skillFiles('pixel')).toEqual([]);
    expect(await codeOf(p.addSkillFiles('pixel', [f('../fuera.md')]))).toBe('invalid');
  });

  it('[R24.10] readFiles y readFolderNamed rechazan enlaces simbólicos y conservan el nombre de la carpeta', async () => {
    const dir = await tmp();
    await fs.mkdir(`${dir}/colores`);
    await fs.writeFile(`${dir}/colores/a.csv`, 'x');
    await fs.writeFile(`${dir}/suelto.md`, 'y');
    const { readFiles, readFolderNamed } = await import('../src');
    expect((await readFiles([`${dir}/suelto.md`])).files.map((x) => x.path)).toEqual(['suelto.md']);
    const named = await readFolderNamed(`${dir}/colores`);
    expect(named.files.map((x) => x.path)).toEqual(['colores/a.csv']);
    await fs.symlink('/etc/hostname', `${dir}/enlace.md`);
    await expect(readFiles([`${dir}/enlace.md`])).rejects.toMatchObject({ code: 'invalid' });
  });

  it('[R24.11] quitar un archivo; SKILL.md y las rutas fuera de la carpeta no se pueden tocar', async () => {
    const p = await project();
    await p.saveSkill(sk);
    await p.addSkillFiles('pixel', [f('a.md')]);
    expect(await p.removeSkillFile('pixel', 'referencias/a.md')).toBe(true);
    expect(await p.removeSkillFile('pixel', 'referencias/a.md')).toBe(false);
    expect(await codeOf(p.removeSkillFile('pixel', 'SKILL.md'))).toBe('outside-root');
    expect(await codeOf(p.removeSkillFile('pixel', '../../project.json'))).toBe('outside-root');
    expect((await p.loadSkill('pixel')).name).toBe('Pixel');
  });

  it('[R24.12] lee archivos de texto, recorta los enormes y rechaza binarios', async () => {
    const p = await project();
    await p.saveSkill(sk);
    await p.writeSkillFile('pixel', 'referencias/a.md', Buffer.from('contenido'));
    await p.writeSkillFile('pixel', 'referencias/grande.txt', Buffer.from('x'.repeat(200_005)));
    await p.writeSkillFile('pixel', 'referencias/img.png', Buffer.from([137, 80, 0, 71]));
    expect(await p.readSkillFile('pixel', 'referencias/a.md')).toEqual({ text: 'contenido', truncated: false });
    expect(await p.readSkillFile('pixel', 'referencias/grande.txt')).toMatchObject({ truncated: true });
    expect(await codeOf(p.readSkillFile('pixel', 'referencias/img.png'))).toBe('invalid');
    expect(await codeOf(p.readSkillFile('pixel', 'referencias/no.md'))).toBe('not-found');
    expect(await codeOf(p.readSkillFile('pixel', 'SKILL.md'))).toBe('outside-root');
  });

  it('[R32.35] crea y reescribe archivos de texto de la skill, sin tocar binarios, SKILL.md ni secretos', async () => {
    const p = await project();
    await p.saveSkill(sk);
    await p.saveSkillText('pixel', 'referencias/guia.md', '# Guía');
    expect(await p.readSkillFile('pixel', 'referencias/guia.md')).toEqual({ text: '# Guía', truncated: false });
    await p.saveSkillText('pixel', 'referencias/guia.md', '# Guía v2');
    expect((await p.readSkillFile('pixel', 'referencias/guia.md')).text).toBe('# Guía v2');
    await p.writeSkillFile('pixel', 'referencias/img.png', Buffer.from([137, 80, 0, 71]));
    expect(await codeOf(p.saveSkillText('pixel', 'referencias/img.png', 'x'))).toBe('invalid');
    expect(await codeOf(p.saveSkillText('pixel', 'SKILL.md', 'x'))).toBe('outside-root');
    expect(await codeOf(p.saveSkillText('pixel', '../fuera.md', 'x'))).toBe('outside-root');
    expect(await codeOf(p.saveSkillText('pixel', 'a.md', 'x'.repeat(200_001)))).toBe('invalid');
    expect(await codeOf(p.saveSkillText('pixel', 'a.md', 'clave sk-ant-api03-' + 'a'.repeat(40)))).toBe('secrets');
    expect(await codeOf(p.saveSkillText('nada', 'a.md', 'x'))).toBe('not-found');
  });
});
