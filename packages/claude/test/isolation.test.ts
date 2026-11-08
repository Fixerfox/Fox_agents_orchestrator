import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultSettings, newAgent, type AgentQuestion, type AgentStreamEvent, type AppSettings } from '@orquestador/core';
import { ClaudeAdapter, DENY, ISOLATED_DENY, ISOLATED_GIT_DENY, namesFolder, promptText, writesGit, type ClaudeEnvironment, type ClaudeQueryOptions, type QueryFn, type SdkMessage } from '../src';

let dir: string;
let work: string;
let space: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'orq-iso-'));
  work = join(dir, 'juego');
  space = join(dir, 'espacio');
  await mkdir(work, { recursive: true });
  await mkdir(space, { recursive: true });
  await writeFile(join(space, 'README.md'), '# Copia');
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const ok: SdkMessage = { type: 'result', subtype: 'success', is_error: false, result: 'Hecho', usage: { input_tokens: 1, output_tokens: 1 } };

async function runIn(script: (o: ClaudeQueryOptions) => Promise<void>, settings: Partial<AppSettings> = {}, isolated = true) {
  const seen: { options?: ClaudeQueryOptions; files: unknown[] } = { files: [] };
  const query: QueryFn = async function* ({ options }) {
    seen.options = options;
    await script(options);
    yield ok;
  };
  const env: ClaudeEnvironment = {
    projectRoot: join(dir, 'proyecto'),
    settings: () => ({ ...defaultSettings(), ...settings }),
    apiKey: async () => undefined,
    loadAgent: async () => ({ ...newAgent('dev', 'Dev'), instructions: 'Programa' }),
    loadContexts: async () => [],
    loadSkills: async () => [],
    workFolder: async () => work,
    onFileEvent: (_n, e) => void seen.files.push(e),
  };
  const request = { nodeId: 'n', agentId: 'dev', runId: 'r', input: { text: 'haz', files: [] }, attempt: 1, ask: async (_q: AgentQuestion) => DENY, previousAnswers: [], ...(isolated ? { workspace: { dir: space } } : {}) };
  const out: AgentStreamEvent[] = [];
  for await (const e of new ClaudeAdapter(env, query).run(request, new AbortController().signal)) out.push(e);
  return { seen, out };
}

describe('SPEC-073 · el agente en una rama aislada', () => {
  it('[R73.8] trabaja en su espacio: es su carpeta actual y la raíz de lo que escribe', async () => {
    const { seen } = await runIn(async (o) => {
      expect(await o.canUseTool!('Write', { file_path: 'nuevo.ts', content: 'x' }, { toolUseID: 't1' })).toMatchObject({ behavior: 'allow' });
    });
    expect(seen.options!.cwd).toBe(space);
    expect(promptText(seen.options!.systemPrompt)).toContain('README.md');
  });

  it('[R73.8] escribir en la carpeta original se deniega siempre, también con «Sin preguntar nunca»', async () => {
    const { out, seen } = await runIn(async (o) => {
      expect(await o.canUseTool!('Write', { file_path: join(work, 'x.ts'), content: 'x' }, { toolUseID: 't1' })).toEqual({ behavior: 'deny', message: ISOLATED_DENY });
      expect(await o.canUseTool!('Bash', { command: 'ls' }, { toolUseID: 't2' })).toMatchObject({ behavior: 'allow' });
      expect(await o.canUseTool!('Bash', { command: `cp nuevo.ts ${join(work, 'x.ts')}` }, { toolUseID: 't3' })).toEqual({ behavior: 'deny', message: ISOLATED_DENY });
      expect(await o.canUseTool!('Bash', { command: `cp nuevo.ts ${join(work, 'x.ts').split(sep).join('/')}` }, { toolUseID: 't5' })).toEqual({ behavior: 'deny', message: ISOLATED_DENY });
      expect(await o.canUseTool!('Bash', { command: `ls ${work.split(sep).join('/')}` }, { toolUseID: 't4' })).toMatchObject({ behavior: 'allow' });
    }, { permissions: 'full' });
    expect(seen.files[0]).toEqual(expect.objectContaining({ kind: 'denied', path: join(work, 'x.ts') }));
    // Lo denegado llega al Supervisor como `blocked` tras el siguiente resultado de herramienta (aquí, no hay).
    expect(out.filter((e) => e.type === 'branch')).toEqual([]);
  });

  it('[R73.8] en Windows, la carpeta original cuenta también escrita con «/» o con otras mayúsculas', () => {
    expect(namesFolder('cp a C:/Juego/x.ts', 'C:\\Juego', 'win32')).toBe(true);
    expect(namesFolder('cp a c:\\juego\\x.ts', 'C:\\Juego', 'win32')).toBe(true);
    expect(namesFolder('cp a C:/Otro/x.ts', 'C:\\Juego', 'win32')).toBe(false);
    expect(namesFolder('cp a /home/Juego/x', '/home/juego', 'linux')).toBe(false);
    expect(namesFolder('cp a /home/juego/x', '/home/juego', 'linux')).toBe(true);
  });
  it('[R73.9] git que escribe se deniega con el motivo; el que lee, no', async () => {
    await runIn(async (o) => {
      expect(await o.canUseTool!('Bash', { command: 'git commit -m "x"' }, { toolUseID: 't1' })).toEqual({ behavior: 'deny', message: ISOLATED_GIT_DENY });
      expect(await o.canUseTool!('Bash', { command: 'git status' }, { toolUseID: 't2' })).toMatchObject({ behavior: 'allow' });
    }, { permissions: 'full' });
    expect(ISOLATED_GIT_DENY).toBe('En una rama en paralelo no se cambia git: el commit se hace después de juntar las ramas.');
    for (const c of ['git commit -am x', 'git -C . checkout main', 'npm test && git push', 'git switch -c x', 'git merge dev', 'git rebase main', 'git reset --hard', 'git stash', 'git pull', 'git tag v1', 'git branch nueva', 'git branch -D vieja', 'echo $(git commit -m x)']) expect(writesGit(c), c).toBe(true);
    for (const c of ['git status', 'git log --oneline', 'git diff', 'git branch', 'git branch -a', 'npm run build', 'echo git commit']) expect(writesGit(c), c).toBe(false);
  });

  it('[R73.10] desde un espacio aislado no se siguen las ramas de git', async () => {
    const { out } = await runIn(async (o) => {
      await o.canUseTool!('Bash', { command: 'git status' }, { toolUseID: 't1' });
    });
    expect(out.some((e) => e.type === 'branch' || e.type === 'git_action')).toBe(false);
  });

  it('[R73.8] sin espacio, todo sigue como antes', async () => {
    const { seen } = await runIn(async (o) => {
      expect(await o.canUseTool!('Bash', { command: 'git commit -m x' }, { toolUseID: 't1' })).toMatchObject({ behavior: 'allow' });
    }, { permissions: 'full' }, false);
    expect(seen.options!.cwd).toBe(work);
  });
});
