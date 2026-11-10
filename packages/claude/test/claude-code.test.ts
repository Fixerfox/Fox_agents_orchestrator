import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultSettings, loadsClaudeConfig, newAgent, normalizeSettings, validateSettings, type AgentDefinition, type AgentQuestion, type AgentStreamEvent, type AppSettings } from '@orquestador/core';
import {
  ALLOW_ONCE,
  APP_DIR_DENY,
  ClaudeAdapter,
  ClaudeDecider,
  DENY,
  HOOK_TIMEOUT_S,
  agentTools,
  createWritePolicy,
  folderRule,
  guardedPolicy,
  promptText,
  type ClaudeEnvironment,
  type ClaudeQueryOptions,
  type QueryFn,
  type SdkMessage,
} from '../src';

let dir: string;
let work: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'orq-cc-'));
  work = join(dir, 'juego');
  await mkdir(join(work, 'src'), { recursive: true });
  await writeFile(join(work, 'README.md'), '# Juego');
  await writeFile(join(work, 'src', 'viejo.ts'), 'original');
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const ok: SdkMessage = { type: 'result', subtype: 'success', is_error: false, result: 'Hecho', usage: { input_tokens: 1, output_tokens: 1 } };
const hookOpts = { signal: new AbortController().signal };

function setup(over: { settings?: Partial<AppSettings>; agent?: Partial<AgentDefinition>; script?: (o: ClaudeQueryOptions) => Promise<void>; projectRoot?: string } = {}) {
  const seen: { options?: ClaudeQueryOptions; backups: string[]; files: unknown[]; asked: AgentQuestion[] } = { backups: [], files: [], asked: [] };
  const answers: string[] = [];
  const query: QueryFn = async function* ({ options }) {
    seen.options = options;
    await over.script?.(options);
    yield ok;
  };
  const agent = { ...newAgent('dev', 'Dev'), instructions: 'Programa', ...over.agent };
  const env: ClaudeEnvironment = {
    projectRoot: over.projectRoot ?? join(dir, 'proyecto'),
    settings: () => ({ ...defaultSettings(), ...over.settings }),
    apiKey: async () => undefined,
    loadAgent: async () => agent,
    loadContexts: async () => [],
    loadSkills: async () => [],
    workFolder: async () => work,
    backup: async (run, _abs, rel) => void seen.backups.push(`${run}:${rel}`),
    onFileEvent: (n, e) => void seen.files.push({ n, ...e }),
  };
  const request = {
    nodeId: 'n1',
    agentId: 'dev',
    runId: 'r1',
    input: { text: 'haz', files: [] },
    attempt: 1,
    ask: async (q: AgentQuestion) => (seen.asked.push(q), answers.shift() ?? DENY),
    previousAnswers: [],
  };
  const run = async () => {
    const out: AgentStreamEvent[] = [];
    for await (const e of new ClaudeAdapter(env, query).run(request, new AbortController().signal)) out.push(e);
    return out;
  };
  return { seen, run, answers };
}

describe('SPEC-050 · agentes con Claude Code completo', () => {
  it('[R50.1] el paso usa el prompt de Claude Code con lo del agente al final; las consultas de un turno, el suyo', async () => {
    const { seen, run } = setup({ agent: { name: 'Implementador', instructions: 'Usa TypeScript' } });
    await run();
    expect(seen.options!.systemPrompt).toEqual({ type: 'preset', preset: 'claude_code', append: expect.stringContaining('Eres «Implementador»') });
    expect(promptText(seen.options!.systemPrompt)).toContain('Usa TypeScript');
    let other: ClaudeQueryOptions | undefined;
    const q: QueryFn = async function* ({ options }) {
      other = options;
      yield { type: 'result', subtype: 'success', is_error: false, result: '{"text":"x"}' } as SdkMessage;
    };
    const decider = new ClaudeDecider({ query: q, settings: () => defaultSettings(), apiKey: async () => undefined, projectRoot: work });
    await decider.transform({ nodeId: 't', input: { text: 'hola', files: [] }, target: 'text', instructions: 'Resume' } as never, new AbortController().signal).catch(() => undefined);
    expect(typeof other?.systemPrompt).toBe('string');
    expect(other?.settingSources).toEqual([]);
    expect(promptText('texto')).toBe('texto');
    expect(promptText(undefined)).toBe('');
  });

  it('[R50.2][R87.3] los agentes tienen subagentes, lista de tareas y skills, que se aprueban sin preguntar; leer ya no', async () => {
    const { seen, run } = setup();
    await run();
    expect(seen.options!.tools).toEqual(agentTools(true));
    expect(seen.options!.tools).toEqual(expect.arrayContaining(['Agent', 'TodoWrite', 'Skill', 'Bash', 'Write']));
    expect(seen.options!.allowedTools).toEqual(['Agent', 'TodoWrite', 'Skill']);
    expect(seen.options!.allowedTools).not.toContain('Write');
    expect(seen.options!.allowedTools).not.toContain('Bash');
    for (const t of ['Agent', 'TodoWrite', 'Skill']) expect(await seen.options!.canUseTool!(t, {})).toMatchObject({ behavior: 'allow' });
    expect(seen.asked).toHaveLength(0);
  });

  it('[R50.2] lo que escribe un subagente pasa por la misma política: se registra y se copia antes de modificar', async () => {
    const { seen, run, answers } = setup({
      settings: { permissions: 'ask' },
      script: async (o) => {
        expect(await o.canUseTool!('Write', { file_path: 'src/nuevo.ts', content: 'x' }, { toolUseID: 's1', agentID: 'sub-1' })).toMatchObject({ behavior: 'allow' });
        await writeFile(join(work, 'src', 'nuevo.ts'), 'x');
        answers.push(ALLOW_ONCE);
        expect(await o.canUseTool!('Edit', { file_path: 'src/viejo.ts' }, { toolUseID: 's2', agentID: 'sub-1' })).toMatchObject({ behavior: 'allow' });
      },
    });
    const out = await run();
    expect(seen.asked.map((q) => q.text)).toEqual(['¿Puedo modificar src/viejo.ts?']);
    expect(seen.backups).toEqual(['r1:src/viejo.ts']);
    expect(out.filter((e) => e.type === 'file')).toEqual([
      { type: 'file', path: 'src/nuevo.ts', change: 'created' },
      { type: 'file', path: 'src/viejo.ts', change: 'modified' },
    ]);
  });

  it('[R50.3] «Cargar la configuración de Claude Code» está activado por defecto; apagado, no carga .claude ni Skill', async () => {
    expect(loadsClaudeConfig(defaultSettings())).toBe(true);
    expect(loadsClaudeConfig({ claudeConfig: false })).toBe(false);
    expect(normalizeSettings({ ...defaultSettings(), claudeConfig: false }).claudeConfig).toBe(false);
    expect(normalizeSettings({ ...defaultSettings(), claudeConfig: 'sí' }).claudeConfig).toBeUndefined();
    expect(validateSettings({ ...defaultSettings(), claudeConfig: 'sí' } as unknown as AppSettings)).toContainEqual(expect.objectContaining({ field: 'claudeConfig' }));
    expect(validateSettings({ ...defaultSettings(), claudeConfig: true })).toEqual([]);
    const on = setup();
    await on.run();
    expect(on.seen.options).toMatchObject({ settingSources: ['user', 'project', 'local'], strictMcpConfig: true });
    const off = setup({ settings: { claudeConfig: false } });
    await off.run();
    expect(off.seen.options!.settingSources).toEqual([]);
    expect(off.seen.options!.tools).not.toContain('Skill');
    expect(off.seen.options!.tools).toEqual(expect.arrayContaining(['Agent', 'TodoWrite']));
  });

  it('[R50.4][R87.3] la política corre también en el gancho PreToolUse y decide una sola vez por llamada', async () => {
    const { seen, run, answers } = setup({
      settings: { permissions: 'ask' },
      script: async (o) => {
        const hook = o.hooks!.PreToolUse![0]!.hooks[0]!;
        expect(o.hooks!.PreToolUse![0]!.matcher).toBeUndefined();
        expect(o.hooks!.PreToolUse![0]!.timeout).toBe(HOOK_TIMEOUT_S);
        answers.push(ALLOW_ONCE);
        // el gancho pregunta y copia; canUseTool con la misma llamada reutiliza la decisión
        expect(await hook({ tool_name: 'Edit', tool_input: { file_path: 'src/viejo.ts' } }, 'e1', hookOpts)).toEqual({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' } });
        expect(await o.canUseTool!('Edit', { file_path: 'src/viejo.ts' }, { toolUseID: 'e1' })).toMatchObject({ behavior: 'allow' });
        // una regla allow de .claude no llama a canUseTool: el gancho deniega igual
        expect(await hook({ tool_name: 'Edit', tool_input: { file_path: 'README.md' } }, 'e2', hookOpts)).toEqual({
          hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: expect.stringContaining('README.md') },
        });
        // un MCP que no es del agente también se deniega en el gancho
        expect(await hook({ tool_name: 'mcp__ajeno__x', tool_input: {} }, 'm1', hookOpts)).toMatchObject({ hookSpecificOutput: { permissionDecision: 'deny' } });
        // preguntas y herramientas automáticas se dejan a canUseTool; las lecturas pasan por el gancho [R87.3]
        for (const t of ['AskUserQuestion', 'Agent', 'TodoWrite', 'Skill']) expect(await hook({ tool_name: t, tool_input: {} }, `x-${t}`, hookOpts)).toEqual({});
        expect(await hook({ tool_name: 'Read', tool_input: { file_path: '.env' } }, 'x-env', hookOpts)).toMatchObject({ hookSpecificOutput: { permissionDecision: 'deny' } });
      },
    });
    await run();
    expect(seen.asked.map((q) => q.text)).toEqual(['¿Puedo modificar src/viejo.ts?', '¿Puedo modificar README.md?']);
    expect(seen.backups).toEqual(['r1:src/viejo.ts']);
  });

  it('[R50.4] sin id de llamada no se guarda la decisión', async () => {
    let n = 0;
    const g = guardedPolicy(async (_t, input) => (n++, { behavior: 'allow', updatedInput: input }));
    await g.canUseTool('Bash', {});
    await g.canUseTool('Bash', {});
    await g.canUseTool('Bash', {}, { toolUseID: 'a' });
    await g.hook({ tool_name: 'Bash', tool_input: {} }, 'a', hookOpts);
    expect(n).toBe(3);
  });

  it('[R50.5] con «Sin preguntar nunca» se escribe fuera, sin copia ni registro; nunca en .orquestador del proyecto ni de la carpeta', async () => {
    const project = join(dir, 'proyecto');
    const { seen, run } = setup({
      projectRoot: project,
      settings: { permissions: 'full' },
      script: async (o) => {
        expect(await o.canUseTool!('Write', { file_path: join(dir, 'compartido', 'notas.md'), content: 'x' })).toMatchObject({ behavior: 'allow' });
        expect(await o.canUseTool!('Edit', { file_path: 'src/viejo.ts' })).toMatchObject({ behavior: 'allow' });
        expect(await o.canUseTool!('Write', { file_path: join(project, '.orquestador', 'diagrams', 'x.json'), content: '{}' })).toMatchObject({ behavior: 'deny', message: APP_DIR_DENY });
        expect(await o.canUseTool!('Write', { file_path: '.orquestador/x.json', content: '{}' })).toMatchObject({ behavior: 'deny', message: APP_DIR_DENY });
      },
    });
    const out = await run();
    expect(seen.asked).toHaveLength(0);
    expect(seen.backups).toEqual(['r1:src/viejo.ts']);
    expect(out.filter((e) => e.type === 'file')).toEqual([{ type: 'file', path: 'src/viejo.ts', change: 'modified' }]);
    // la política sola: sin appDirs, protege el .orquestador de la carpeta
    const canUse = createWritePolicy({ root: work, level: 'full', ask: async () => DENY, backup: async () => {} });
    expect(await canUse('Write', { file_path: join(work, '.orquestador', 'a'), content: '' })).toMatchObject({ behavior: 'deny' });
    expect(await canUse('Write', { file_path: join(work, '.orquestador-viejo', 'a'), content: '' })).toMatchObject({ behavior: 'allow' });
  });

  it('[R50.6] el texto de la carpeta dice lo que permite el nivel del agente', async () => {
    expect(folderRule('readonly')).toMatch(/solo lectura/);
    expect(folderRule('ask')).toMatch(/se le pregunta al usuario/);
    expect(folderRule('auto')).toMatch(/modificar archivos existentes sin preguntar/);
    expect(folderRule('auto')).toMatch(/No puedes escribir fuera de la carpeta/);
    expect(folderRule('full')).toMatch(/también puedes escribir fuera de la carpeta, salvo en \.orquestador/);
    const ro = setup({ agent: { permissions: 'readonly' } });
    await ro.run();
    expect(promptText(ro.seen.options!.systemPrompt)).toContain(folderRule('readonly'));
    const full = setup({ settings: { permissions: 'full' } });
    await full.run();
    expect(promptText(full.seen.options!.systemPrompt)).toContain(folderRule('full'));
  });
});
