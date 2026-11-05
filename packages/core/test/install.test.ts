import { describe, expect, it } from 'vitest';
import { analyzeImport, isSafePackagePath, type SourceTree } from '../src';

const enc = new TextEncoder();
const tree = (o: Record<string, string>): SourceTree => ({ files: Object.entries(o).map(([path, text]) => ({ path, data: enc.encode(text) })) });
const none = { agentIds: new Set<string>(), skillIds: new Set<string>() };
const AGENT = '---\nname: revisor\ndescription: Revisa sprites\ntools: Read, Bash\nmodel: opus\nskills: pixel-art\n---\nRevisa todo con cuidado.\n';
const SKILL = '---\nname: pixel-art\ndescription: Dibuja sprites\n---\n# Pasos\n1. Uno\n';

describe('SPEC-025 · análisis de paquetes', () => {
  it('[R25.2] reconoce agentes, skills y servidores MCP en formato Claude Code', () => {
    const plan = analyzeImport(
      tree({ 'agents/revisor.md': AGENT, 'skills/pixel-art/SKILL.md': SKILL, 'skills/pixel-art/plantilla.txt': 'x', '.mcp.json': '{"mcpServers":{"git":{"command":"npx","env":{"TOKEN":"abc"}}}}', 'docs/leeme.png': 'x' }),
      none,
    );
    const r = plan.report;
    expect(r.items.map((i) => [i.kind, i.id])).toEqual([['skill', 'pixel-art'], ['agent', 'revisor']]);
    expect(r.items[0]!.files).toEqual([{ path: 'plantilla.txt', size: 1 }]);
    // el valor del secreto nunca se lee, solo su nombre [R30.6]
    expect(r.mcp).toEqual([{ name: 'git', command: 'npx', secretNames: ['TOKEN'] }]);
    expect(JSON.stringify(r.mcp)).not.toContain('abc');
    expect(JSON.stringify(r)).not.toContain('abc');
    expect(r.ignored).toBe(1);
    const agent = plan.agents.get('agent:agents/revisor.md')!;
    expect(agent.agent).toMatchObject({ name: 'revisor', description: 'Revisa sprites', model: 'claude-opus-5-5', instructions: 'Revisa todo con cuidado.' });
    expect(agent.skillNames).toEqual(['skill:skills/pixel-art']);
  });

  it('[R25.2] acepta la carpeta envolvente, el prefijo .claude/ y agentes en la raíz', () => {
    const a = analyzeImport(tree({ 'repo-main/.claude/agents/revisor.md': AGENT, 'repo-main/.claude/skills/pixel-art/SKILL.md': SKILL }), none);
    expect(a.report.items.map((i) => i.id).sort()).toEqual(['pixel-art', 'revisor']);
    const b = analyzeImport(tree({ 'revisor.md': AGENT, 'README.md': '# Hola' }), none);
    expect(b.report.items.map((i) => i.id)).toEqual(['revisor']);
    expect(analyzeImport(tree({ 'README.md': '# Hola' }), none).report.items).toEqual([]);
  });

  it('[R25.2] una skill suelta en la raíz del paquete también se reconoce', () => {
    const r = analyzeImport(tree({ 'SKILL.md': SKILL, 'ayuda.txt': 'x' }), none).report;
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ kind: 'skill', id: 'pixel-art' });
    expect(r.items[0]!.files).toEqual([{ path: 'ayuda.txt', size: 1 }]);
  });

  it('[R25.4] avisa de scripts, herramientas, secretos, modelo desconocido y skills que faltan', () => {
    const r = analyzeImport(
      tree({
        'agents/x.md': '---\nname: x\ndescription: d\nmodel: gpt-9\ntools: Bash\nskills: otra\n---\nclave sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789',
        'skills/s/SKILL.md': SKILL,
        'skills/s/run.sh': 'echo',
        'skills/s/bin/herramienta.exe': 'MZ',
        'skills/s/sin-ext': '#!/bin/sh\nls',
      }),
      none,
    ).report;
    const agent = r.items.find((i) => i.kind === 'agent')!;
    expect(agent.warnings.map((w) => w.code).sort()).toEqual(['missing-skill', 'model', 'secrets', 'tools']);
    const skill = r.items.find((i) => i.kind === 'skill')!;
    const script = skill.warnings.find((w) => w.code === 'script')!;
    expect(script.message).toContain('3 scripts o ejecutables');
    expect(script.message).toContain('run.sh');
  });

  it('[R25.4] un id que ya existe es conflicto y se propone uno libre', () => {
    const r = analyzeImport(tree({ 'agents/revisor.md': AGENT, 'agents/otro.md': AGENT, 'skills/pixel-art/SKILL.md': SKILL }), {
      agentIds: new Set(['revisor']),
      skillIds: new Set(['pixel-art']),
    }).report;
    const byKind = (k: string) => r.items.filter((i) => i.kind === k);
    expect(byKind('skill')[0]).toMatchObject({ id: 'pixel-art-2', conflictWith: 'pixel-art' });
    expect(byKind('agent').map((i) => i.id).sort()).toEqual(['revisor-2', 'revisor-3']);
    expect(byKind('agent')[0]!.warnings.some((w) => w.code === 'conflict')).toBe(true);
  });

  it('[R25.4] recorta nombres largos y bloquea lo que no se puede instalar', () => {
    const r = analyzeImport(
      tree({
        'agents/largo.md': `---\nname: ${'n'.repeat(80)}\ndescription: ${'d'.repeat(400)}\n---\nok`,
        'agents/enorme.md': `---\nname: enorme\ndescription: d\n---\n${'x'.repeat(20_001)}`,
        'skills/sin-desc/SKILL.md': '---\nname: sin-desc\n---\ncuerpo',
      }),
      none,
    ).report;
    const get = (id: string) => r.items.find((i) => i.id === id || i.name.startsWith(id))!;
    expect(get('nnnn').warnings.some((w) => w.code === 'trimmed')).toBe(true);
    expect(get('nnnn').name).toHaveLength(60);
    expect(get('enorme').blocked).toMatch(/Las instrucciones admiten/);
    expect(get('sin-desc').blocked).toMatch(/Describe/);
  });

  it('[R25.5] un .mcp.json ilegible no rompe el análisis', () => {
    expect(analyzeImport(tree({ '.mcp.json': '{no' }), none).report.mcp).toEqual([]);
  });

  it('[R25.3] isSafePackagePath rechaza rutas absolutas, con .., unidad o nulos', () => {
    for (const bad of ['/etc/passwd', '\\x', 'C:\\x', '../x', 'a/../../x', 'a\\..\\x', 'a\0b', '']) expect(isSafePackagePath(bad)).toBe(false);
    for (const ok of ['a.md', 'skills/a/SKILL.md', 'a/b/c.txt', 'a..b/c']) expect(isSafePackagePath(ok)).toBe(true);
  });
});

import { planSkillFiles, isScriptPath } from '../src';

describe('SPEC-024 · archivos de referencia de una skill', () => {
  const f = (path: string, size = 1) => ({ path, data: new Uint8Array(size) });

  it('[R24.9] los archivos van bajo referencias/ y una carpeta conserva su estructura', () => {
    const r = planSkillFiles([], [f('paleta.md'), f('imagenes/a.png'), f('imagenes/sub/b.png')]);
    expect(r).toMatchObject({ ok: true, renamed: 0 });
    expect(r.ok && r.add.map((x) => x.path)).toEqual(['referencias/paleta.md', 'referencias/imagenes/a.png', 'referencias/imagenes/sub/b.png']);
  });

  it('[R24.9] un archivo que ya existe no se sobrescribe: recibe sufijo, también entre los nuevos', () => {
    const r = planSkillFiles([{ path: 'referencias/paleta.md', size: 1 }], [f('paleta.md'), f('paleta.md'), f('LEEME')]);
    expect(r.ok && r.add.map((x) => x.path)).toEqual(['referencias/paleta-2.md', 'referencias/paleta-3.md', 'referencias/LEEME']);
    expect(r.ok && r.renamed).toBe(2);
    const dup = planSkillFiles([{ path: 'Referencias/Paleta.md', size: 1 }], [f('paleta.md')]);
    expect(dup.ok && dup.add[0]!.path).toBe('referencias/paleta-2.md');
  });

  it('[R24.10] ignora basura del sistema y rechaza rutas peligrosas o una selección vacía', () => {
    expect(planSkillFiles([], [f('.DS_Store'), f('a/Thumbs.db')])).toEqual({ ok: false, message: 'No hay archivos que añadir' });
    expect(planSkillFiles([], [f('../x.md')])).toMatchObject({ ok: false, message: expect.stringMatching(/rutas no permitidas/) });
    expect(planSkillFiles([], [f('/etc/x')])).toMatchObject({ ok: false });
  });

  it('[R24.10] aplica los límites contando lo que la skill ya tiene', () => {
    expect(planSkillFiles([], [f('a.bin', 2 * 1024 * 1024 + 1)])).toMatchObject({ ok: false, message: expect.stringMatching(/No caben/) });
    expect(planSkillFiles(Array.from({ length: 500 }, (_, i) => ({ path: `x${i}`, size: 1 })), [f('a')])).toMatchObject({ ok: false });
    expect(planSkillFiles([{ path: 'x', size: 20 * 1024 * 1024 }], [f('a')])).toMatchObject({ ok: false });
    expect(planSkillFiles([{ path: 'x', size: 100 }], [f('a')])).toMatchObject({ ok: true });
  });

  it('[R24.12] señala scripts y ejecutables', () => {
    const r = planSkillFiles([], [f('run.sh'), f('datos.csv'), f('bin/herramienta.exe')]);
    expect(r.ok && r.scripts).toEqual(['referencias/run.sh', 'referencias/bin/herramienta.exe']);
    expect(isScriptPath('a/b.PY')).toBe(true);
    expect(isScriptPath('a/b.md')).toBe(false);
  });
});

describe('SPEC-032 · skills de cada agente en el informe', () => {
  it('[R32.17] el informe dice qué skills del paquete recibirá cada agente; sin skills no hay campo', () => {
    const plan = analyzeImport(tree({ 'agents/revisor.md': AGENT, 'agents/solo.md': '---\nname: solo\ndescription: Nada\n---\nHola\n', 'skills/pixel-art/SKILL.md': SKILL }), none);
    const revisor = plan.report.items.find((i) => i.name === 'revisor')!;
    expect(revisor.skills).toEqual(['skill:skills/pixel-art']);
    expect(plan.report.items.find((i) => i.name === 'solo')).not.toHaveProperty('skills');
  });
});
