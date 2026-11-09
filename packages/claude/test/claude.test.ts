import { describe, expect, it } from 'vitest';
import { AgentError, defaultSettings, newAgent, newContext, type AgentDefinition, type AgentStreamEvent, type AppSettings, type ContextDefinition, type SkillDefinition } from '@orquestador/core';
import { ClaudeAdapter, ClaudeDecider, QUESTION_RULE, buildEnv, buildSystemPrompt, permissionPolicy, testConnection, extractJson, type ClaudeEnvironment, type ClaudeQueryOptions, type QueryFn, type SdkMessage, promptText } from '../src';

const throwing = (message: string): QueryFn => () => ({ [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(new Error(message)) }) });
const KEY = 'sk-ant-api03-SECRETSECRETSECRET';
const ok = (text = 'Hecho', extra: Partial<SdkMessage> = {}): SdkMessage => ({ type: 'result', subtype: 'success', is_error: false, result: text, usage: { input_tokens: 10, output_tokens: 5 }, total_cost_usd: 0.01, ...extra });
const assistant = (...content: unknown[]): SdkMessage => ({ type: 'assistant', message: { content } });

function fake(messages: SdkMessage[] | ((o: ClaudeQueryOptions, prompt: string) => SdkMessage[]), seen: { options?: ClaudeQueryOptions; prompt?: string; calls: number } = { calls: 0 }): { query: QueryFn; seen: typeof seen } {
  const query: QueryFn = async function* ({ prompt, options }) {
    seen.options = options;
    seen.prompt = prompt;
    seen.calls++;
    for (const m of typeof messages === 'function' ? messages(options, prompt) : messages) yield m;
  };
  return { query, seen };
}

function env(over: Partial<ClaudeEnvironment> = {}, settings: Partial<AppSettings> = {}, agent?: Partial<AgentDefinition>, contexts: ContextDefinition[] = [], skills: SkillDefinition[] = []): ClaudeEnvironment {
  const a: AgentDefinition = { ...newAgent('pintor', 'Pintor'), description: 'Dibuja', instructions: 'Usa píxel art', model: 'claude-opus-5-5', ...agent };
  return {
    projectRoot: '/proy',
    settings: () => ({ ...defaultSettings(), ...settings }),
    apiKey: async () => undefined,
    loadAgent: async (id) => (id === a.id ? a : undefined),
    loadContexts: async () => contexts,
    loadSkills: async () => skills,
    ...over,
  };
}
const req = (over = {}) => ({ nodeId: 'n1', agentId: 'pintor', input: { text: 'Dibuja un héroe', files: ['boceto.png'] }, attempt: 1, ask: async () => '', previousAnswers: [], ...over });
async function collect(it: AsyncIterable<AgentStreamEvent>) {
  const out: AgentStreamEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}
const fail = async (p: Promise<unknown>): Promise<AgentError> => {
  try {
    await p;
  } catch (e) {
    return e as AgentError;
  }
  throw new Error('Se esperaba un error');
};
const run = (e: ClaudeEnvironment, q: QueryFn, r = req(), signal = new AbortController().signal) => collect(new ClaudeAdapter(e, q).run(r, signal));

describe('SPEC-027 · adaptador de Claude', () => {
  it('[R27.2][R22.10][R50.1][R50.3] el prompt de Claude Code lleva nombre, descripción, instrucciones; usa el modelo y los turnos del agente, la entrada del nodo y la configuración de Claude Code', async () => {
    const { query, seen } = fake([ok()]);
    await run(env({}, {}, { maxTurns: 7 }), query, req({ previousAnswers: [{ question: '¿Estilo?', answer: 'Pixel art' }] }));
    const system = promptText(seen.options!.systemPrompt);
    expect(system).toContain('Pintor');
    expect(system).toContain('Dibuja');
    expect(system).toContain('Usa píxel art');
    expect(seen.options).toMatchObject({ model: 'claude-opus-5-5', maxTurns: 7, cwd: '/proy', persistSession: false, settingSources: ['user', 'project', 'local'], strictMcpConfig: true });
    expect(seen.options!.systemPrompt).toMatchObject({ type: 'preset', preset: 'claude_code' });
    expect(seen.prompt).toContain('Dibuja un héroe');
    expect(seen.prompt).toContain('boceto.png');
    expect(seen.prompt).toContain('¿Estilo? → Pixel art');
  });

  it('[R40.4] el modelo del paso sustituye al de la ficha; sin él, se usa el de la ficha', async () => {
    const a = fake([ok()]);
    await run(env(), a.query, req({ model: 'claude-haiku-5-5' }));
    expect(a.seen.options!.model).toBe('claude-haiku-5-5');
    const b = fake([ok()]);
    await run(env(), b.query);
    expect(b.seen.options!.model).toBe('claude-opus-5-5');
  });

  it('[R27.13] el prompt exige preguntar con la herramienta antes de terminar, nunca dejar decisiones pendientes en la respuesta', async () => {
    const { query, seen } = fake([ok()]);
    await run(env(), query);
    const system = promptText(seen.options!.systemPrompt);
    expect(system).toContain(QUESTION_RULE);
    expect(QUESTION_RULE).toMatch(/AskUserQuestion/);
    expect(QUESTION_RULE).toMatch(/Nunca acabes tu respuesta con preguntas o decisiones pendientes/);
    // La herramienta que nombra la regla está entre las que el agente puede usar.
    expect(seen.options!.tools).toContain('AskUserQuestion');
    // También sin carpeta de trabajo.
    expect(buildSystemPrompt(newAgent('x', 'X'), [], [])).toContain(QUESTION_RULE);
  });

  it('[R27.3][R22.10] los contextos van por referencia: texto incluido, URL y archivo solo mencionados', async () => {
    const ctxs: ContextDefinition[] = [
      { ...newContext('t', 'Guía de estilo'), value: 'Paleta de 16 colores' },
      { ...newContext('u', 'Referencia', 'url'), value: 'https://ejemplo.com/ref' },
      { ...newContext('f', 'Notas', 'file'), value: 'docs/notas.md' },
    ];
    const { query, seen } = fake([ok()]);
    await run(env({}, {}, {}, ctxs), query);
    const s = promptText(seen.options!.systemPrompt);
    expect(s).toContain('Paleta de 16 colores');
    expect(s).toContain('https://ejemplo.com/ref');
    expect(s).toContain('docs/notas.md');
    expect(s).not.toContain('contenido leído');
  });

  it('[R27.4][R24.8] las skills asignadas se listan con descripción y ruta de su SKILL.md', async () => {
    const skills: SkillDefinition[] = [{ id: 'pixel-art', name: 'Pixel art', description: 'Para dibujar sprites', body: 'NO DEBE IR' }];
    const { query, seen } = fake([ok()]);
    await run(env({}, {}, {}, [], skills), query);
    const s = promptText(seen.options!.systemPrompt);
    expect(s).toContain('Pixel art');
    expect(s).toContain('Para dibujar sprites');
    expect(s).toContain('.orquestador/skills/pixel-art/SKILL.md');
    expect(s).toContain('referencias/');
    expect(s).not.toContain('NO DEBE IR');
  });

  it('[R27.5] traduce texto, herramientas, uso y resultado en eventos', async () => {
    const { query } = fake([
      assistant({ type: 'text', text: 'Pensando' }, { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'a.md' } }),
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: 'contenido' }], is_error: false }] } },
      { type: 'system', subtype: 'init' },
      ok('Listo'),
    ]);
    expect(await run(env(), query)).toEqual([
      { type: 'token', text: 'Pensando' },
      { type: 'tool_call', tool: 'Read', input: { file_path: 'a.md' } },
      { type: 'tool_result', tool: 'Read', ok: true, output: 'contenido', id: 't1' },
      { type: 'usage', inputTokens: 10, outputTokens: 5, costUsd: 0.01 },
      { type: 'result', text: 'Listo' },
    ]);
  });

  it('[R27.5] un resultado de herramienta con error se marca como fallido', async () => {
    const { query } = fake([
      assistant({ type: 'tool_use', id: 't1', name: 'Read', input: {} }),
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'no existe', is_error: true }] } },
      ok(),
    ]);
    const ev = await run(env(), query);
    expect(ev[1]).toMatchObject({ type: 'tool_result', ok: false, output: 'no existe' });
  });

  it('[R27.6] los errores del resultado se explican en español y distinguen los reintentables', async () => {
    const cases: [SdkMessage, RegExp, boolean][] = [
      [{ type: 'result', subtype: 'error_max_turns', is_error: true }, /máximo de turnos/, false],
      [{ type: 'result', subtype: 'error_max_budget_usd', is_error: true }, /presupuesto/, false],
      [{ type: 'result', subtype: 'error_during_execution', is_error: true, errors: ['fetch failed'] }, /Claude terminó con un error/, true],
      [{ type: 'result', subtype: 'success', is_error: true, result: 'algo falló' }, /algo falló/, false],
      [{ type: 'assistant', error: 'authentication_failed', message: { content: [] } }, /sesión válida/, false],
      [{ type: 'assistant', error: 'rate_limit', message: { content: [] } }, /límite de uso/, true],
      [{ type: 'assistant', error: 'server_error', message: { content: [] } }, /temporal/, true],
    ];
    for (const [msg, re, retriable] of cases) {
      const err = await fail(run(env(), fake([msg]).query));
      expect(err).toBeInstanceOf(AgentError);
      expect(err.message).toMatch(re);
      expect(err.retriable).toBe(retriable);
    }
  });

  it('[R27.6] una excepción del SDK se traduce y la falta de Claude Code se explica', async () => {
    const boom = throwing;
    const a = await fail(run(env(), boom('ECONNRESET socket')));
    expect(a).toMatchObject({ retriable: true });
    const b = await fail(run(env(), boom('spawn claude ENOENT')));
    expect(b.message).toMatch(/No se encontró Claude Code/);
    const c = await fail(run(env(), boom('401 invalid x-api-key')));
    expect(c.message).toMatch(/sesión válida/);
    const d = await fail(run(env(), fake([assistant({ type: 'text', text: 'sin cierre' })]).query));
    expect(d.message).toMatch(/sin devolver un resultado/);
  });

  it('[R27.7] cancelar aborta la consulta y deja de emitir', async () => {
    const ac = new AbortController();
    let aborted = false;
    const query: QueryFn = async function* ({ options }) {
      options.abortController!.signal.addEventListener('abort', () => (aborted = true));
      yield assistant({ type: 'text', text: 'uno' });
      ac.abort();
      yield assistant({ type: 'text', text: 'dos' });
      yield ok();
    };
    const ev = await run(env(), query, req(), ac.signal);
    expect(aborted).toBe(true);
    expect(ev).toEqual([{ type: 'token', text: 'uno' }]);
  });

  it('[R27.7] si ya estaba cancelado no llega a lanzar la consulta', async () => {
    const ac = new AbortController();
    ac.abort();
    const { query, seen } = fake([ok()]);
    expect(await run(env(), query, req(), ac.signal)).toEqual([]);
    expect(seen.calls).toBe(0);
  });

  it('[R27.8] claude-code no pasa clave y api-key la pasa solo en el entorno del SDK', async () => {
    const base = { PATH: '/bin', ANTHROPIC_API_KEY: 'otra-clave-del-sistema' };
    expect(buildEnv({ ...defaultSettings(), authMode: 'claude-code' }, KEY, base)['ANTHROPIC_API_KEY']).toBeUndefined();
    expect(buildEnv({ ...defaultSettings(), authMode: 'api-key' }, KEY, base)['ANTHROPIC_API_KEY']).toBe(KEY);
    expect(() => buildEnv({ ...defaultSettings(), authMode: 'api-key' }, undefined, base)).toThrow(/Falta la clave API/);
    const { query, seen } = fake([ok()]);
    await run(env({ apiKey: async () => KEY }, { authMode: 'api-key' }), query);
    expect(seen.options!.env!['ANTHROPIC_API_KEY']).toBe(KEY);
    expect(JSON.stringify({ ...seen.options, env: undefined })).not.toContain(KEY);
  });

  it('[R27.8] sin clave guardada en modo api-key falla con un mensaje claro', async () => {
    const err = await fail(run(env({}, { authMode: 'api-key' }), fake([ok()]).query));
    expect(err.message).toMatch(/Falta la clave API/);
  });

  it('[R27.8] la clave nunca aparece en eventos ni errores', async () => {
    const leak = fake([assistant({ type: 'text', text: `mi clave es ${KEY}` }), ok(`resultado con ${KEY}`)]).query;
    const ev = await run(env({ apiKey: async () => KEY }, { authMode: 'api-key' }), leak);
    expect(JSON.stringify(ev)).not.toContain('SECRETSECRET');
    const boom = throwing(`falló con ${KEY}`);
    const err = await fail(run(env({ apiKey: async () => KEY }, { authMode: 'api-key' }), boom));
    expect(err.message).not.toContain('SECRETSECRET');
  });

  it('[R27.9][R31.11] los agentes tienen herramientas de lectura y de escritura con política; el resto se deniega con motivo', async () => {
    const { query, seen } = fake([ok()]);
    await run(env(), query);
    expect(seen.options!.tools).toEqual(['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash', 'AskUserQuestion', 'Agent', 'TodoWrite', 'Skill']);
    expect(seen.options!.permissionMode).toBe('default');
    expect(await permissionPolicy('Read', { file_path: 'a' })).toEqual({ behavior: 'allow', updatedInput: { file_path: 'a' } });
    for (const t of ['Bash', 'Write', 'Edit']) expect(await permissionPolicy(t, {})).toMatchObject({ behavior: 'deny', message: expect.stringContaining('solo pueden leer') });
    expect(await seen.options!.canUseTool!('Teleport', {})).toMatchObject({ behavior: 'deny' });
  });

  it('[R27.10] un agente que no existe falla sin reintentos y explica cómo crearlo', async () => {
    const { query, seen } = fake([ok()]);
    const err = await fail(run(env(), query, req({ agentId: 'fantasma' })));
    expect(err).toMatchObject({ retriable: false });
    expect(err.message).toMatch(/«fantasma» no existe en el proyecto.*pantalla Agentes/);
    expect(seen.calls).toBe(0);
  });

  it('[R27.10] cada ejecución relee el agente', async () => {
    let instructions = 'v1';
    const e = env({ loadAgent: async () => ({ ...newAgent('pintor', 'Pintor'), instructions }) });
    const { query, seen } = fake([ok()]);
    await run(e, query);
    expect(promptText(seen.options!.systemPrompt)).toContain('v1');
    instructions = 'v2';
    await run(e, query);
    expect(promptText(seen.options!.systemPrompt)).toContain('v2');
  });
});

describe('SPEC-027 · decisiones con Claude', () => {
  const decider = (text: string | (() => string), seen = { calls: 0 }) =>
    new ClaudeDecider({
      query: fake(() => [ok(typeof text === 'function' ? text() : text)], seen).query,
      projectRoot: '/proy',
      settings: () => defaultSettings(),
      apiKey: async () => undefined,
    });
  const sig = new AbortController().signal;
  const cands = [
    { edgeId: 'e1', to: 'a', label: 'Arte' },
    { edgeId: 'e2', to: 'b', label: 'Sonido' },
  ];
  const input = { text: 'Hace falta arte', files: [] };

  it('[R27.11] el enrutado tolera texto y vallas alrededor del JSON y descarta aristas inexistentes', async () => {
    const d = decider('Claro:\n```json\n{"edges":["e2","zzz","e2"],"reason":"Solo sonido"}\n```');
    expect(await d.route({ nodeId: 'r', candidates: cands, input }, sig)).toMatchObject({ edgeIds: ['e2'], reason: 'Solo sonido' });
  });

  it('[R27.11] sin ninguna arista válida o sin JSON falla con error claro, no inventa una decisión', async () => {
    await expect(decider('{"edges":["zzz"]}').route({ nodeId: 'r', candidates: cands, input }, sig)).rejects.toThrow(/ninguna conexión válida/);
    await expect(decider('no sé').route({ nodeId: 'r', candidates: cands, input }, sig)).rejects.toThrow(/decisión legible/);
  });

  it('[R27.11] evaluador y condición exigen booleanos', async () => {
    expect(await decider('{"done":true,"reason":"ok"}').judge({ prompt: 'p', output: input, iteration: 1 }, sig)).toMatchObject({ done: true, reason: 'ok' });
    await expect(decider('{"done":"sí"}').judge({ prompt: 'p', output: input, iteration: 1 }, sig)).rejects.toThrow(/cumple lo pedido/);
    expect(await decider('{"result":false}').condition({ condition: 'c', input }, sig)).toBe(false);
    await expect(decider('{"result":1}').condition({ condition: 'c', input }, sig)).rejects.toThrow(/condición/);
  });

  it('[R53.17] «blame» devuelve un paso de la lista y su motivo; un paso que no está falla', async () => {
    const steps = [
      { nodeId: 'a', label: 'Analista', task: 'Analiza', output: { text: 'plan', files: [] } },
      { nodeId: 'b', label: 'Builder' },
    ];
    expect(await decider('{"nodeId":"a","reason":"faltan tareas"}').blame({ feedback: 'Falta la US3', candidates: steps }, sig)).toEqual({ nodeId: 'a', reason: 'faltan tareas' });
    await expect(decider('{"nodeId":"zzz"}').blame({ feedback: 'x', candidates: steps }, sig)).rejects.toThrow(/paso válido/);
  });

  it('[R27.11] las consultas de decisión no llevan herramientas y usan un solo turno', async () => {
    const seen: { options?: ClaudeQueryOptions; calls: number } = { calls: 0 };
    const d = new ClaudeDecider({ query: fake([ok('{"result":true}')], seen).query, projectRoot: '/proy', settings: () => defaultSettings(), apiKey: async () => undefined });
    await d.condition({ condition: 'c', input }, sig);
    expect(seen.options).toMatchObject({ tools: [], allowedTools: [], maxTurns: 1 });
  });

  it('[R27.11] extractJson ignora llaves dentro de cadenas y rechaza lo que no es un objeto', () => {
    expect(extractJson('x {"a":"}{","b":1} y')).toEqual({ a: '}{', b: 1 });
    expect(extractJson('[1,2]')).toBeUndefined();
    expect(extractJson('{"a":')).toBeUndefined();
  });
});

describe('SPEC-037 · transformar con Claude', () => {
  const sig = new AbortController().signal;
  const make = (text: string) => {
    const seen: { options?: ClaudeQueryOptions; prompt?: string; calls: number } = { calls: 0 };
    const d = new ClaudeDecider({ query: fake([ok(text)], seen).query, projectRoot: '/proy', settings: () => defaultSettings(), apiKey: async () => undefined });
    return { d, seen };
  };

  it('[R37.6] un turno sin herramientas con formato, instrucciones, esquema, corrección y entrada', async () => {
    const { d, seen } = make('```json\n{"a":1}\n```');
    const r = await d.transform({ nodeId: 't', format: 'json', instructions: 'Saca la lista', schema: '{"type":"object"}', input: { text: 'datos', files: ['x.md'] }, attempt: 2, previousError: '$.a: falta' }, sig);
    expect(r.text).toContain('"a":1');
    expect(seen.options).toMatchObject({ tools: [], allowedTools: [], maxTurns: 1 });
    expect(seen.prompt).toContain('Convierte la entrada a JSON.');
    expect(seen.prompt).toContain('Instrucciones: Saca la lista');
    expect(seen.prompt).toContain('{"type":"object"}');
    expect(seen.prompt).toContain('Tu respuesta anterior no valía: $.a: falta');
    expect(seen.prompt).toContain('datos\nArchivos: x.md');
  });

  it('[R37.6] en Markdown quita la valla que envuelve toda la respuesta', async () => {
    const { d } = make('```markdown\n# Hola\n- uno\n```');
    expect((await d.transform({ nodeId: 't', format: 'markdown', instructions: 'x', input: { text: 'y', files: [] }, attempt: 1 }, sig)).text).toBe('# Hola\n- uno');
  });
});

describe('SPEC-027 · probar conexión', () => {
  const args = (query: QueryFn, settings: Partial<AppSettings> = {}, apiKey?: string) => ({ query, settings: { ...defaultSettings(), ...settings }, apiKey, cwd: '/proy' });

  it('[R27.12] devuelve éxito con el modelo y el tiempo', async () => {
    const r = await testConnection(args(fake([ok('OK')]).query));
    expect(r).toMatchObject({ ok: true, model: defaultSettings().defaultModel, message: 'Claude responde correctamente.' });
    expect(r.ms).toBeGreaterThanOrEqual(0);
  });

  it('[R27.12] nunca lanza: explica el fallo y no filtra la clave', async () => {
    const boom = throwing(`401 invalid x-api-key ${KEY}`);
    const r = await testConnection(args(boom, { authMode: 'api-key' }, KEY));
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/sesión válida/);
    expect(r.message).not.toContain('SECRETSECRET');
    const noKey = await testConnection(args(fake([ok()]).query, { authMode: 'api-key' }));
    expect(noKey).toMatchObject({ ok: false });
    expect(noKey.message).toMatch(/Falta la clave API/);
  });
});

describe('SPEC-032 · tarea del nodo en el prompt', () => {
  it('[R32.2] con tarea, el mensaje empieza por la tarea y pone la entrada debajo; sin tarea es la entrada sola', async () => {
    const { buildUserPrompt } = await import('../src/prompt');
    const withTask = buildUserPrompt({ text: 'babosa, dron', files: [] }, [], 'Dibuja cada enemigo');
    expect(withTask.indexOf('Tu tarea en este paso:\nDibuja cada enemigo')).toBe(0);
    expect(withTask).toContain('Entrada recibida:\nbabosa, dron');
    expect(buildUserPrompt({ text: 'hola', files: [] }, [])).toBe('hola');
    const seen = { calls: 0 } as { prompt?: string; calls: number };
    const { query } = fake([ok()], seen);
    const adapter = new ClaudeAdapter(env(), query);
    for await (const _ of adapter.run({ nodeId: 'n', agentId: 'pintor', input: { text: 'x', files: [] }, task: 'Pinta', attempt: 1, ask: async () => '', previousAnswers: [] }, new AbortController().signal)) void _;
    expect(seen.prompt).toContain('Tu tarea en este paso:\nPinta');
  });
});

describe('SPEC-033 · conocimiento añadido en el adaptador', () => {
  it('[R33.3] carga las skills y contextos del agente más los del diagrama y el paso, sin repetir', async () => {
    const asked: { skills?: string[]; contexts?: string[] } = {};
    const { query } = fake([ok()]);
    const adapter = new ClaudeAdapter(
      env(
        {
          loadSkills: async (ids) => ((asked.skills = ids), []),
          loadContexts: async (ids) => ((asked.contexts = ids), []),
        },
        {},
        { skillIds: ['paleta'], contextIds: ['glosario'] },
      ),
      query,
    );
    await collect(adapter.run(req({ extra: { skillIds: ['paleta', 'trazo'], contextIds: ['mundo'], mcpIds: ['pixelart'] } }), new AbortController().signal));
    expect(asked.skills).toEqual(['paleta', 'trazo']);
    expect(asked.contexts).toEqual(['glosario', 'mundo']);
  });
});

describe('SPEC-080 · su sitio en el flujo en el prompt', () => {
  it('[R80.9] va en el mensaje del usuario, después de la memoria y antes de la tarea; el prompt de sistema no cambia', async () => {
    const { buildUserPrompt } = await import('../src/prompt');
    const flow = '## Tu sitio en el flujo\n\nDespués de ti, tu salida la recibe:\n- La salida final de la ejecución.';
    const text = buildUserPrompt({ text: 'x', files: [] }, [], 'Pinta', [], undefined, '- Plan: hecho', flow);
    expect(text.indexOf('## Memoria de la ejecución')).toBeLessThan(text.indexOf('## Tu sitio en el flujo'));
    expect(text.indexOf('## Tu sitio en el flujo')).toBeLessThan(text.indexOf('Tu tarea en este paso:'));
    const systems: unknown[] = [];
    for (const f of [flow, undefined]) {
      const seen = { calls: 0 } as { options?: ClaudeQueryOptions; prompt?: string; calls: number };
      const { query } = fake([ok()], seen);
      const adapter = new ClaudeAdapter(env(), query);
      for await (const _ of adapter.run({ nodeId: 'n', agentId: 'pintor', input: { text: 'x', files: [] }, task: 'Pinta', ...(f ? { flow: f } : {}), attempt: 1, ask: async () => '', previousAnswers: [] }, new AbortController().signal)) void _;
      if (f) expect(seen.prompt).toContain(flow);
      else expect(seen.prompt).not.toContain('## Tu sitio en el flujo');
      systems.push(JSON.stringify(seen.options?.systemPrompt));
    }
    expect(systems[0]).toBe(systems[1]);
  });
});
