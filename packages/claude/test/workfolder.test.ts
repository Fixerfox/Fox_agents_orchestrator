import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultSettings, newAgent, type AgentQuestion, type AgentStreamEvent, type AppSettings } from '@orquestador/core';
import { ALLOW_ONCE, ALLOW_RUN, ClaudeAdapter, DENY, WORK_TOOLS, confine, createWritePolicy, permissionPolicy, summarizeFolder, type ClaudeEnvironment, type ClaudeQueryOptions, type QueryFn, type SdkMessage, promptText, agentTools } from '../src';

let dir: string;
let work: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'orq-work-'));
  work = join(dir, 'juego');
  await mkdir(join(work, 'src'), { recursive: true });
  await writeFile(join(work, 'README.md'), '# Mi juego\nUn juego de naves.');
  await writeFile(join(work, 'src', 'main.ts'), 'export {}');
  await writeFile(join(work, 'src', 'viejo.ts'), 'original');
});
afterEach(() => rm(dir, { recursive: true, force: true }));

function policy(over: { answers?: string[]; auto?: boolean } = {}) {
  const asked: AgentQuestion[] = [];
  const backups: string[] = [];
  const notes: unknown[] = [];
  const answers = [...(over.answers ?? [])];
  const canUse = createWritePolicy({
    root: work,
    level: over.auto ? 'auto' : 'ask',
    ask: async (q) => {
      asked.push(q);
      return answers.shift() ?? DENY;
    },
    backup: async (_abs, rel) => void backups.push(rel),
    note: (e) => void notes.push(e),
  });
  return { canUse, asked, backups, notes };
}

describe('SPEC-031 · carpeta de trabajo: resumen', () => {
  it('[R31.2] el resumen lista dos niveles, cuenta archivos y recorta README, sin ocultas ni binarios', async () => {
    await mkdir(join(work, 'node_modules', 'x'), { recursive: true });
    await writeFile(join(work, 'node_modules', 'x', 'i.js'), '1');
    await mkdir(join(work, '.git'), { recursive: true });
    await writeFile(join(work, '.git', 'HEAD'), 'ref');
    await writeFile(join(work, 'logo.png'), Buffer.from([0, 1, 2]));
    await writeFile(join(work, 'CLAUDE.md'), 'x'.repeat(5000));
    const s = await summarizeFolder(work);
    expect(s.name).toBe('juego');
    expect(s.files).toBe(4);
    expect(s.text).toContain('src/main.ts');
    expect(s.text).toContain('Un juego de naves.');
    expect(s.text).toMatch(/--- CLAUDE\.md ---\nx{2000}…/);
    expect(s.text).not.toContain('node_modules');
    expect(s.text).not.toContain('HEAD');
    expect(s.text).not.toContain('logo.png');
    expect(s.text).not.toContain(dir);
  });

  it('[R31.2] una carpeta vacía lo dice', async () => {
    const empty = join(dir, 'vacia');
    await mkdir(empty);
    expect((await summarizeFolder(empty)).text).toContain('carpeta vacía');
  });
});

describe('SPEC-031 · confinamiento', () => {
  it('[R31.5] acepta rutas relativas y absolutas dentro de la carpeta, también las que aún no existen', async () => {
    expect(await confine(work, 'src/nuevo/a.ts')).toMatchObject({ rel: 'src/nuevo/a.ts' });
    expect(await confine(work, join(work, 'src', 'main.ts'))).toMatchObject({ rel: 'src/main.ts' });
  });

  it('[R31.5] deniega «..», rutas ajenas, la propia raíz, .git, node_modules y .orquestador', async () => {
    for (const p of ['../fuera.txt', 'src/../../fuera.txt', join(dir, 'otra', 'a.txt'), '.', '', '.git/config', 'node_modules/x/a.js', '.orquestador/agents/a.json', 'a\0b']) {
      expect(await confine(work, p), p).toBeNull();
    }
  });

  it('[R31.5] un enlace simbólico que sale de la carpeta se deniega', async () => {
    await mkdir(join(dir, 'secreto'));
    try {
      await symlink(join(dir, 'secreto'), join(work, 'atajo'), 'junction');
    } catch {
      return; // el sistema no permite crear enlaces: no se puede probar aquí
    }
    expect(await confine(work, 'atajo/nuevo.txt')).toBeNull();
  });
});

describe('SPEC-031 · política de herramientas', () => {
  it('[R31.11] leer y buscar siempre se permite', async () => {
    const { canUse, asked } = policy();
    for (const t of ['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch']) expect(await canUse(t, { file_path: '/cualquiera' })).toMatchObject({ behavior: 'allow' });
    expect(asked).toHaveLength(0);
  });

  it('[R31.3] crear un archivo nuevo dentro de la carpeta se permite sin preguntar', async () => {
    const { canUse, asked, notes } = policy();
    expect(await canUse('Write', { file_path: join(work, 'src', 'nave.ts'), content: 'x' })).toMatchObject({ behavior: 'allow' });
    expect(await canUse('Write', { file_path: 'docs/nuevo/guia.md', content: 'x' })).toMatchObject({ behavior: 'allow' });
    expect(asked).toHaveLength(0);
    expect(notes).toEqual([
      { kind: 'created', path: 'src/nave.ts' },
      { kind: 'created', path: 'docs/nuevo/guia.md' },
    ]);
  });

  it('[R31.4] modificar uno existente pregunta con tres opciones; Permitir guarda copia y deja pasar', async () => {
    const { canUse, asked, backups } = policy({ answers: [ALLOW_ONCE, DENY] });
    expect(await canUse('Edit', { file_path: 'src/viejo.ts' })).toMatchObject({ behavior: 'allow' });
    expect(asked[0]).toEqual({ text: '¿Puedo modificar src/viejo.ts?', options: ['Permitir', 'Permitir en esta ejecución', 'Denegar'], kind: 'permission', fallback: 'Denegar' });
    expect(backups).toEqual(['src/viejo.ts']);
    expect(await canUse('Edit', { file_path: 'src/viejo.ts' })).toMatchObject({ behavior: 'deny' });
    expect(asked).toHaveLength(2);
  });

  it('[R31.4] «Permitir en esta ejecución» no vuelve a preguntar por otros archivos', async () => {
    const { canUse, asked, backups } = policy({ answers: [ALLOW_RUN] });
    expect(await canUse('Write', { file_path: 'src/viejo.ts', content: 'n' })).toMatchObject({ behavior: 'allow' });
    expect(await canUse('Edit', { file_path: 'src/main.ts' })).toMatchObject({ behavior: 'allow' });
    expect(asked).toHaveLength(1);
    expect(backups).toEqual(['src/viejo.ts', 'src/main.ts']);
  });

  it('[R31.4] si el usuario escribe otra cosa, se deniega y el agente recibe lo que dijo', async () => {
    const { canUse, backups } = policy({ answers: ['mejor crea src/nuevo.ts'] });
    const r = await canUse('Write', { file_path: 'src/viejo.ts', content: 'n' });
    expect(r).toMatchObject({ behavior: 'deny', message: expect.stringContaining('mejor crea src/nuevo.ts') });
    expect(backups).toHaveLength(0);
  });

  it('[R31.4] el modo automático modifica sin preguntar, pero guarda copia', async () => {
    const { canUse, asked, backups } = policy({ auto: true });
    expect(await canUse('Edit', { file_path: 'src/viejo.ts' })).toMatchObject({ behavior: 'allow' });
    expect(asked).toHaveLength(0);
    expect(backups).toEqual(['src/viejo.ts']);
  });

  it('[R31.5] fuera de la carpeta se deniega con un motivo, sin preguntar ni siquiera en modo automático', async () => {
    const { canUse, asked, notes } = policy({ auto: true });
    const r = await canUse('Write', { file_path: join(dir, 'fuera.txt'), content: 'x' });
    expect(r).toMatchObject({ behavior: 'deny', message: expect.stringContaining('dentro de la carpeta de trabajo') });
    expect(await canUse('Write', { content: 'sin ruta' })).toMatchObject({ behavior: 'deny' });
    expect(await canUse('Write', { file_path: '.orquestador/agents/a.json' })).toMatchObject({ behavior: 'deny' });
    expect(asked).toHaveLength(0);
    expect(notes[0]).toMatchObject({ kind: 'denied' });
  });

  it('[R31.5] en «Preguntar», los comandos que no son sencillos preguntan', async () => {
    const { canUse, asked } = policy({ answers: [ALLOW_ONCE, DENY] });
    expect(await canUse('Bash', { command: 'npm test' })).toMatchObject({ behavior: 'allow' });
    expect(asked[0]).toEqual({ text: '¿Puedo ejecutar este comando?\nnpm test', options: ['Permitir', 'Denegar'], kind: 'permission', fallback: 'Denegar' });
    expect(await canUse('Bash', { command: 'rm -rf src' })).toMatchObject({ behavior: 'deny' });
  });

  it('[R31.11] una herramienta desconocida se deniega', async () => {
    expect(await policy().canUse('Teleport', {})).toMatchObject({ behavior: 'deny' });
  });

  it('[R31.9] AskUserQuestion se contesta por el chat del nodo y la respuesta vuelve al agente', async () => {
    const { canUse, asked } = policy({ answers: ['Pixel art', 'Pequeño'] });
    const r = await canUse('AskUserQuestion', {
      questions: [
        { question: '¿Qué estilo?', options: [{ label: 'Pixel art' }, { label: 'Vectorial' }] },
        { question: '¿Qué tamaño?' },
      ],
    });
    expect(asked).toEqual([{ text: '¿Qué estilo?', options: ['Pixel art', 'Vectorial'], kind: 'question' }, { text: '¿Qué tamaño?', kind: 'question' }]);
    expect(r).toMatchObject({ behavior: 'allow', updatedInput: { answers: { '¿Qué estilo?': 'Pixel art', '¿Qué tamaño?': 'Pequeño' } } });
  });

  it('[R27.9] las consultas sin escritura (decisiones, borradores) siguen en solo lectura', async () => {
    expect(await permissionPolicy('Write', {})).toMatchObject({ behavior: 'deny' });
    expect(WORK_TOOLS).toContain('Write');
  });
});

describe('SPEC-031 · el adaptador usa la carpeta de trabajo', () => {
  const ok: SdkMessage = { type: 'result', subtype: 'success', is_error: false, result: 'Hecho', usage: { input_tokens: 1, output_tokens: 1 } };
  function setup(settings: Partial<AppSettings> = {}, withFolder = true) {
    const seen: { options?: ClaudeQueryOptions; backups: string[]; files: unknown[] } = { backups: [], files: [] };
    const query: QueryFn = async function* ({ options }) {
      seen.options = options;
      yield ok;
    };
    const agent = { ...newAgent('dev', 'Dev'), instructions: 'Programa' };
    const env: ClaudeEnvironment = {
      projectRoot: join(dir, 'proyecto'),
      settings: () => ({ ...defaultSettings(), ...settings }),
      apiKey: async () => undefined,
      loadAgent: async () => agent,
      loadContexts: async () => [],
      loadSkills: async () => [],
      ...(withFolder ? { workFolder: async () => work } : {}),
      backup: async (run, _abs, rel) => void seen.backups.push(`${run}:${rel}`),
      onFileEvent: (n, e) => void seen.files.push({ n, ...e }),
    };
    const answers: string[] = [];
    const request = { nodeId: 'n1', agentId: 'dev', runId: 'r1', input: { text: 'haz', files: [] }, attempt: 1, ask: async () => answers.shift() ?? DENY, previousAnswers: [] };
    const run = async () => {
      const out: AgentStreamEvent[] = [];
      for await (const e of new ClaudeAdapter(env, query).run(request, new AbortController().signal)) out.push(e);
      return out;
    };
    return { seen, run, answers };
  }

  it('[R31.2] usa la carpeta como directorio de trabajo y le cuenta al agente qué contiene y qué puede hacer', async () => {
    const { seen, run } = setup();
    await run();
    expect(seen.options?.cwd).toBe(work);
    const system = promptText(seen.options?.systemPrompt);
    expect(system).toContain('src/main.ts');
    expect(system).toContain('Un juego de naves.');
    expect(system).toContain('crear archivos y carpetas nuevos');
    expect(system).not.toContain('Solo puedes leer');
    expect(system).not.toContain(dir);
  });

  it('[R31.11] ofrece herramientas de escritura y la política corresponde a la carpeta', async () => {
    const { seen, run, answers } = setup();
    await run();
    expect(seen.options?.tools).toEqual(agentTools(true));
    const canUse = seen.options!.canUseTool!;
    expect(await canUse('Write', { file_path: 'nuevo.ts' })).toMatchObject({ behavior: 'allow' });
    answers.push(ALLOW_ONCE);
    expect(await canUse('Edit', { file_path: 'src/viejo.ts' })).toMatchObject({ behavior: 'allow' });
    expect(seen.backups).toEqual(['r1:src/viejo.ts']);
    expect(seen.files).toEqual([
      { n: 'n1', kind: 'created', path: 'nuevo.ts' },
      { n: 'n1', kind: 'modified', path: 'src/viejo.ts' },
    ]);
  });

  it('[R31.4] el nivel «Automático» de Ajustes se respeta', async () => {
    const { seen, run } = setup({ permissions: 'auto' });
    await run();
    expect(await seen.options!.canUseTool!('Edit', { file_path: 'src/viejo.ts' })).toMatchObject({ behavior: 'allow' });
    expect(seen.backups).toEqual(['r1:src/viejo.ts']);
  });

  it('[R31.5] sin carpeta de trabajo se usa la del proyecto y su .orquestador queda protegido', async () => {
    const { seen, run } = setup({}, false);
    await run();
    expect(seen.options?.cwd).toBe(join(dir, 'proyecto'));
    expect(await seen.options!.canUseTool!('Write', { file_path: '.orquestador/agents/x.json' })).toMatchObject({ behavior: 'deny' });
  });
});
