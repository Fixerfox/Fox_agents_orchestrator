import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AgentError, defaultSettings, newAgent, newContext, newMcpServer, newSkill, type AgentStreamEvent, type ContextDefinition, type KnowledgeExtra, type SkillDefinition } from '@orquestador/core';
import { ClaudeAdapter, INLINE_BUDGET, buildUserPrompt, skillLocation, type ClaudeEnvironment, type ClaudeQueryOptions, type QueryFn, type SdkMessage, promptText } from '../src';
import type { ResolvedMcp } from '../src';

const ok = (text = 'Hecho'): SdkMessage => ({ type: 'result', subtype: 'success', is_error: false, result: text, usage: { input_tokens: 1, output_tokens: 1 }, total_cost_usd: 0 });
const useTool = (name: string, input: Record<string, unknown>): SdkMessage => ({ type: 'assistant', message: { content: [{ type: 'tool_use', id: `t-${name}`, name, input }] } });

function fake(messages: SdkMessage[]): { query: QueryFn; seen: { options?: ClaudeQueryOptions; prompt?: string } } {
  const seen: { options?: ClaudeQueryOptions; prompt?: string } = {};
  const query: QueryFn = async function* ({ prompt, options }) {
    seen.options = options;
    seen.prompt = prompt;
    for (const m of messages) yield m;
  };
  return { query, seen };
}

const skill = (id: string, body = `Cuerpo de ${id}`, name = id): SkillDefinition => ({ ...newSkill(id, name), description: `Descripción de ${id}`, body });
const mcp = (id: string, enabled = true): ResolvedMcp => ({ def: { ...newMcpServer(id, `Servidor ${id}`), enabled, transport: 'stdio', command: 'x' }, secrets: {} });

interface World {
  skills?: SkillDefinition[];
  contexts?: ContextDefinition[];
  mcp?: ResolvedMcp[];
  root?: string;
  folder?: string;
}
function env(w: World = {}): ClaudeEnvironment {
  const a = { ...newAgent('pintor', 'Pintor'), description: 'Dibuja', instructions: 'Usa píxel art' };
  return {
    projectRoot: w.root ?? '/proy',
    settings: () => defaultSettings(),
    apiKey: async () => undefined,
    loadAgent: async (id) => (id === a.id ? a : undefined),
    loadContexts: async (ids) => (w.contexts ?? []).filter((c) => ids.includes(c.id)),
    loadSkills: async (ids) => (w.skills ?? []).filter((s) => ids.includes(s.id)),
    loadMcp: async (ids) => (w.mcp ?? []).filter((m) => ids.includes(m.def.id)),
    ...(w.folder ? { workFolder: async () => w.folder } : {}),
  };
}
const req = (extra?: KnowledgeExtra, over = {}) => ({ nodeId: 'n1', agentId: 'pintor', input: { text: 'Haz las tareas', files: [] }, attempt: 1, ask: async () => '', previousAnswers: [], ...(extra ? { extra } : {}), ...over });
async function collect(it: AsyncIterable<AgentStreamEvent>) {
  const out: AgentStreamEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}
const run = (e: ClaudeEnvironment, q: QueryFn, r = req()) => collect(new ClaudeAdapter(e, q).run(r, new AbortController().signal));
const fail = async (p: Promise<unknown>): Promise<AgentError> => {
  try {
    await p;
  } catch (e) {
    return e as AgentError;
  }
  throw new Error('Se esperaba un error');
};
const knowledge = (evs: AgentStreamEvent[]) => evs.filter((e) => e.type === 'knowledge').map((e) => (e.type === 'knowledge' ? `${e.kind}:${e.id}:${e.via}:${e.required}` : ''));

describe('SPEC-036 · conocimiento obligatorio (adaptador de Claude)', () => {
  it('[R36.5] una skill obligatoria va entera en el prompt; la opcional solo por referencia', async () => {
    const { query, seen } = fake([ok()]);
    const evs = await run(env({ skills: [skill('trazo', 'PASOS DE TRAZO'), skill('paleta', 'SOLO SI LA LEES')] }), query, req({ skillIds: ['trazo', 'paleta'], required: { skillIds: ['trazo'] } }));
    const s = promptText(seen.options!.systemPrompt);
    expect(s).toContain('Skills obligatorias: síguelas en esta tarea');
    expect(s).toContain('PASOS DE TRAZO');
    expect(s).not.toContain('SOLO SI LA LEES');
    expect(s).toContain('paleta: Descripción de paleta');
    expect(s).not.toContain('trazo: Descripción de trazo');
    expect(knowledge(evs)).toEqual(['skill:trazo:inline:true']);
  });

  it('[R36.6] un contexto de texto obligatorio va bajo «Contexto obligatorio» y uno de archivo se incluye con su contenido', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'orq36-'));
    await mkdir(path.join(root, 'docs'));
    await writeFile(path.join(root, 'docs', 'notas.md'), 'CONTENIDO DE LAS NOTAS');
    await writeFile(path.join(root, 'docs', 'foto.bin'), Buffer.from([1, 0, 2, 0]));
    const ctxs: ContextDefinition[] = [
      { ...newContext('t', 'Guía'), value: 'REGLA DE ESTILO' },
      { ...newContext('f', 'Notas', 'file'), value: 'docs/notas.md' },
      { ...newContext('b', 'Foto', 'file'), value: 'docs/foto.bin' },
      { ...newContext('o', 'Opcional', 'file'), value: 'docs/notas.md' },
    ];
    const { query, seen } = fake([useTool('Read', { file_path: 'docs/foto.bin' }), ok()]);
    const evs = await run(env({ contexts: ctxs, root }), query, req({ contextIds: ['t', 'f', 'b', 'o'], required: { contextIds: ['t', 'f', 'b'] } }));
    const s = promptText(seen.options!.systemPrompt);
    expect(s).toContain('Contexto obligatorio');
    expect(s).toContain('REGLA DE ESTILO');
    expect(s).toContain('CONTENIDO DE LAS NOTAS');
    // el binario no se puede incluir: se exige y se comprueba (aquí sí lo leyó)
    expect(s).toContain('Foto: OBLIGATORIO consultarlo antes de responder (docs/foto.bin)');
    // el opcional solo se menciona, sin contenido repetido
    expect(s.split('CONTENIDO DE LAS NOTAS')).toHaveLength(2);
    expect(knowledge(evs).sort()).toEqual(['context:b:read:true', 'context:f:inline:true', 'context:t:inline:true']);
  });

  it('[R36.7] lo incluido comparte un tope: lo que no cabe pasa a «verificado» con su ruta', async () => {
    const big = 'x'.repeat(INLINE_BUDGET - 100);
    const { query, seen } = fake([ok()]);
    const e = new ClaudeAdapter(env({ skills: [skill('grande', big), skill('otra', 'y'.repeat(500))] }), query);
    const err = await fail(collect(e.run(req({ skillIds: ['grande', 'otra'], required: { skillIds: ['grande', 'otra'] } }), new AbortController().signal)));
    const s = promptText(seen.options!.systemPrompt);
    expect(s).toContain(big);
    expect(s).not.toContain('y'.repeat(500));
    expect(s).toContain('otra: léela en .orquestador/skills/otra/SKILL.md');
    expect(err.retriable).toBe(true);
    expect(err.missed).toEqual([{ kind: 'skill', id: 'otra' }]);
  });

  it('[R36.8] URL y MCP obligatorios se exigen con «OBLIGATORIO» en el prompt', async () => {
    const { query, seen } = fake([useTool('WebFetch', { url: 'https://ej.com/ref/' }), useTool('mcp__pixel__dibuja', {}), ok()]);
    const ctx: ContextDefinition = { ...newContext('u', 'Ref', 'url'), value: 'https://ej.com/ref' };
    const evs = await run(env({ contexts: [ctx], mcp: [mcp('pixel')] }), query, req({ contextIds: ['u'], mcpIds: ['pixel'], required: { contextIds: ['u'], mcpIds: ['pixel'] } }));
    const s = promptText(seen.options!.systemPrompt);
    expect(s).toContain('Ref: OBLIGATORIO consultarlo antes de responder (https://ej.com/ref)');
    expect(s).toContain('Servidores MCP obligatorios: OBLIGATORIO usar al menos una de sus herramientas');
    expect(s).toContain('Servidor pixel (herramientas mcp__pixel__*)');
    expect(knowledge(evs)).toEqual(['context:u:tool:true', 'mcp:pixel:tool:true']);
  });

  it('[R36.9] la ruta de la skill es relativa en la raíz del proyecto y absoluta si la carpeta de trabajo es otra', async () => {
    expect(skillLocation('trazo', '/proy', '/proy')).toBe('.orquestador/skills/trazo/SKILL.md');
    expect(skillLocation('trazo', '/proy', '/otra')).toBe(path.join('/proy', '.orquestador', 'skills', 'trazo', 'SKILL.md'));
    const folder = await mkdtemp(path.join(os.tmpdir(), 'orq36-folder-'));
    const { query, seen } = fake([ok()]);
    await run(env({ skills: [skill('trazo')], folder }), query, req({ skillIds: ['trazo'] }));
    expect(promptText(seen.options!.systemPrompt)).toContain(path.join('/proy', '.orquestador', 'skills', 'trazo', 'SKILL.md'));
  });

  it('[R36.10] cuenta como uso leer la carpeta de la skill con ruta relativa, absoluta o con barras de Windows, una sola vez', async () => {
    for (const p of ['.orquestador/skills/trazo/SKILL.md', '/proy/.orquestador/skills/trazo/referencias/a.md', 'D:\\Proy\\.orquestador\\skills\\Trazo\\SKILL.md']) {
      const { query } = fake([useTool('Read', { file_path: p }), useTool('Read', { file_path: p }), ok()]);
      const evs = await run(env({ skills: [skill('trazo')] }), query, req({ skillIds: ['trazo'] }));
      expect(knowledge(evs)).toEqual(['skill:trazo:read:false']);
    }
    // otra skill con prefijo parecido o una herramienta que no lee no cuentan
    const { query } = fake([useTool('Read', { file_path: '.orquestador/skills/trazo-2/SKILL.md' }), useTool('Write', { file_path: '.orquestador/skills/trazo/SKILL.md' }), ok()]);
    expect(knowledge(await run(env({ skills: [skill('trazo')] }), query, req({ skillIds: ['trazo'] })))).toEqual([]);
  });

  it('[R36.11] un obligatorio verificado que no se usó hace fallar el intento de forma recuperable y avisa en el siguiente', async () => {
    const { query } = fake([ok()]);
    const evs: AgentStreamEvent[] = [];
    const adapter = new ClaudeAdapter(env({ mcp: [mcp('pixel')] }), query);
    const err = await fail(
      (async () => {
        for await (const e of adapter.run(req({ mcpIds: ['pixel'], required: { mcpIds: ['pixel'] } }), new AbortController().signal)) evs.push(e);
      })(),
    );
    expect(err).toBeInstanceOf(AgentError);
    expect(err.retriable).toBe(true);
    expect(err.message).toContain('«Servidor pixel» (MCP)');
    expect(err.missed).toEqual([{ kind: 'mcp', id: 'pixel' }]);
    expect(evs).toContainEqual({ type: 'knowledge_unmet', kind: 'mcp', id: 'pixel' });
    expect(evs.find((e) => e.type === 'result')).toBeUndefined();
    // segundo intento: el mensaje de usuario recuerda lo que faltó y, si ya lo usa, termina bien
    const second = fake([useTool('mcp__pixel__dibuja', {}), ok('Listo')]);
    const out = await run(env({ mcp: [mcp('pixel')] }), second.query, req({ mcpIds: ['pixel'], required: { mcpIds: ['pixel'] } }, { attempt: 2, missing: err.missed }));
    expect(second.seen.prompt).toContain('En el intento anterior no usaste: «Servidor pixel» (obligatorio)');
    expect(out.find((e) => e.type === 'result')).toMatchObject({ text: 'Listo' });
    expect(buildUserPrompt({ text: 'a', files: [] }, [], undefined, [])).not.toContain('no usaste');
  });

  it('[R36.20] algo obligatorio que ya no existe o un MCP apagado falla sin reintento', async () => {
    const a = await fail(run(env({ skills: [] }), fake([ok()]).query, req({ skillIds: ['borrada'], required: { skillIds: ['borrada'] } })));
    expect(a.retriable).toBe(false);
    expect(a.message).toContain('skill «borrada»');
    const b = await fail(run(env({ mcp: [mcp('pixel', false)] }), fake([ok()]).query, req({ mcpIds: ['pixel'], required: { mcpIds: ['pixel'] } })));
    expect(b.retriable).toBe(false);
    expect(b.message).toContain('está apagado');
  });

  it('[R36.12] lo opcional se registra si se usa pero nunca hace fallar el paso', async () => {
    const { query } = fake([useTool('mcp__pixel__dibuja', {}), ok()]);
    const evs = await run(env({ mcp: [mcp('pixel'), mcp('otro')], skills: [skill('trazo')] }), query, req({ mcpIds: ['pixel', 'otro'], skillIds: ['trazo'] }));
    expect(knowledge(evs)).toEqual(['mcp:pixel:tool:false']);
    expect(evs.find((e) => e.type === 'result')).toBeDefined();
    expect(evs.some((e) => e.type === 'knowledge_unmet')).toBe(false);
  });

  it('[R36.14] los eventos de conocimiento llevan ids, nunca el contenido incluido', async () => {
    const { query } = fake([ok()]);
    const evs = await run(env({ skills: [skill('trazo', 'SECRETO-INTERNO-DEL-CUERPO')] }), query, req({ skillIds: ['trazo'], required: { skillIds: ['trazo'] } }));
    expect(JSON.stringify(evs)).not.toContain('SECRETO-INTERNO-DEL-CUERPO');
  });
});
