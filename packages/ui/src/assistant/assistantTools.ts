import { COORDINATOR_ID } from '@orquestador/core';
import { canResume, deliverableProblems, validateDiagram, newAgent, newContext, newMcpServer, newSkill, slugify, type AgentDefinition, type DeliverableItem, type DeliverableSpec, type Diagram, type GitAction, type McpServerDefinition, type MemoryKind } from '@orquestador/core';
import { ASSISTANT_TOOLS, deliverableLabel, summarizeRun, t, type EditorSession, type McpView, type ProjectApi, type TerminalProgram } from '@orquestador/editor';
import { nodeLabel } from '../runs';

/** Lo que la interfaz pone a disposición del asistente [R29.2]. */
export interface AssistantHost {
  api: ProjectApi;
  session: EditorSession;
  /** Crea un diagrama nuevo vacío con ese nombre y lo abre. */
  newDiagram: (name: string) => Promise<void>;
  /** Ejecuta el diagrama abierto con una entrada. */
  /** Lanza el diagrama abierto; devuelve el id de la ejecución, o nada si no arrancó [R85.6]. */
  run: (input: string) => Promise<string | undefined>;
  /** Tras cambiar agentes, skills o contextos, para que la interfaz se actualice. */
  refresh: () => void;
  /** Algo nuevo creado por el asistente, para abrirlo si se está viendo esa lista [R38.7]. */
  created?: (kind: 'mcp' | 'agents' | 'skills' | 'contexts', id: string) => void;
  /** Abre una terminal en la carpeta del proyecto [R30.13]. */
  openTerminal?: (program: TerminalProgram, prompt?: string) => Promise<{ external: boolean }>;
}

export interface ToolOutcome {
  ok: boolean;
  /** Lo que se devuelve a Claude. */
  result: unknown;
  /** Una línea para la tarjeta del chat. */
  summary: string;
  /** «Deshacer» en la tarjeta (agentes, skills, contextos) [R29.2]. */
  undo?: () => Promise<void>;
}

export const isDestructive = (name: string) => ASSISTANT_TOOLS.find((x) => x.name === name)?.destructive === true;
/** Pide «Permitir» aunque el proyecto no pida confirmar acciones [R65.9]. */
export const alwaysConfirms = (name: string) => ASSISTANT_TOOLS.find((x) => x.name === name)?.alwaysConfirm === true;
/** Espera a que el usuario escriba algo en la tarjeta (un secreto) [R30.12]. */
export const isInteractive = (name: string) => ASSISTANT_TOOLS.find((x) => x.name === name)?.interactive === true;
/** Solo consulta: varias seguidas se juntan en una línea [R38.3]. */
export const isReadOnly = (name: string) => ASSISTANT_TOOLS.find((x) => x.name === name)?.readOnly === true;

/** Definición guardable a partir de lo que ve la interfaz (sin `secretsSet`). */
const defOf = (v: McpView): McpServerDefinition => {
  const { secretsSet: _s, ...def } = v;
  void _s;
  return def;
};
async function mcpById(api: ProjectApi, id: string): Promise<McpView> {
  const m = must(await api.listMcp()).find((x) => x.id === id);
  if (!m) throw new Error(`No existe el servidor MCP «${id}».`);
  return m;
}

/**
 * Guarda el secreto que el usuario escribe en la tarjeta de `request_secret`: directo al almacén cifrado. A Claude
 * solo vuelve si quedó guardado, nunca el valor [R30.12].
 */
export async function storeAssistantSecret(host: AssistantHost, args: Record<string, unknown>, value: string): Promise<ToolOutcome> {
  const name = str(args['name']);
  try {
    const m = await mcpById(host.api, str(args['mcpId']));
    if (!(m.secretNames ?? []).includes(name)) must(await host.api.saveMcp({ ...defOf(m), secretNames: [...(m.secretNames ?? []), name] }));
    must(await host.api.setMcpSecret({ id: m.id, name, value }));
    host.refresh();
    return { ok: true, summary: t('as.tool.secretSaved', { name }), result: { saved: true, name } };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, summary: message, result: { saved: false, error: message } };
  }
}

/** «Pregunta antes de actuar», icono y tono que pide el asistente [R39.2][R39.8]. */
const lookOf = (args: Record<string, unknown>): Partial<AgentDefinition> => ({
  ...(args['askFirst'] === true ? { askFirst: true } : {}),
  ...(typeof args['icon'] === 'string' && args['icon'] ? { icon: args['icon'] as AgentDefinition['icon'] } : {}),
  ...(typeof args['tone'] === 'string' && args['tone'] ? { tone: args['tone'] as AgentDefinition['tone'] } : {}),
});
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined);
const must = <T,>(r: { ok: true; value: T } | { ok: false; error: { message: string } }): T => {
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
};

/** Conexión donde insertar «después de X» o, si no se dice, la única que llega a Salida [R29.2]. */
function edgeAfter(level: Diagram, after: string): string {
  if (after) {
    const out = level.edges.filter((e) => e.from === after);
    if (out.length === 0) throw new Error(`El paso «${after}» no tiene ninguna conexión de salida.`);
    return out[0]!.id;
  }
  const toOutput = level.edges.filter((e) => level.nodes.find((n) => n.id === e.to)?.kind === 'output');
  // Sin ninguna o con varias, el mensaje dice cuál de las dos pasa [R85.4].
  if (toOutput.length === 0) throw new Error('Ninguna conexión llega a la Salida: indica tras qué paso va (after).');
  if (toOutput.length > 1) throw new Error('Indica tras qué paso va (after): hay varias conexiones que llegan a Salida.');
  return toOutput[0]!.id;
}

/** Quita un paso; si estaba en medio de una cadena, une el anterior con el siguiente [R85.1]–[R85.3]. */
function removeStep(session: AssistantHost['session'], nodeId: string): { reconnected?: { from: string; to: string }; disconnected?: string[] } {
  const level = session.getSnapshot().level;
  const node = level.nodes.find((n) => n.id === nodeId);
  if (!node) throw new Error(`No existe el paso «${nodeId}».`);
  if (node.kind === 'entry' || node.kind === 'output') throw new Error('La Entrada y la Salida no se pueden quitar.');
  const ins = level.edges.filter((e) => e.to === nodeId && e.from !== nodeId);
  const outs = level.edges.filter((e) => e.from === nodeId && e.to !== nodeId);
  session.removeSelection({ nodes: [nodeId] });
  if (ins.length === 1 && outs.length === 1) {
    const [inEdge, outEdge] = [ins[0]!, outs[0]!];
    const after = session.getSnapshot().level;
    if (after.edges.some((e) => e.from === inEdge.from && e.to === outEdge.to && e.port === inEdge.port)) return {};
    const r = session.tryConnect(inEdge.from, outEdge.to, inEdge.port);
    if (r.ok) {
      if (inEdge.condition) session.setCondition(r.edgeId, inEdge.condition);
      return { reconnected: { from: inEdge.from, to: outEdge.to } };
    }
  }
  const after = session.getSnapshot().level;
  const disconnected = [
    ...new Set([
      ...ins.map((e) => e.from).filter((id) => !after.edges.some((e) => e.from === id)),
      ...outs.map((e) => e.to).filter((id) => !after.edges.some((e) => e.to === id)),
    ]),
  ];
  return disconnected.length > 0 ? { disconnected } : {};
}

/** Ejecuta una herramienta del asistente con el mismo contrato que usa el usuario [R29.1][R29.2]. */
export async function runAssistantTool(host: AssistantHost, name: string, args: Record<string, unknown>): Promise<ToolOutcome> {
  const { api, session } = host;
  try {
    switch (name) {
      case 'list_agents': {
        const list = must(await api.listAgents());
        return { ok: true, summary: t('as.tool.read', { what: t('as.what.agents') }), result: list.map((a) => ({ id: a.id, name: a.name, description: a.description, model: a.model, skillIds: a.skillIds, contextIds: a.contextIds, mcpIds: a.mcpIds ?? [] })) };
      }
      case 'get_agent': {
        const a = must(await api.listAgents()).find((x) => x.id === str(args['id']));
        if (!a) throw new Error(`No existe el agente «${str(args['id'])}».`);
        return { ok: true, summary: t('as.tool.readOne', { name: a.name }), result: a };
      }
      case 'list_skills': {
        const list = must(await api.listSkills());
        return { ok: true, summary: t('as.tool.read', { what: t('as.what.skills') }), result: list.map((k) => ({ id: k.id, name: k.name, description: k.description })) };
      }
      case 'get_skill': {
        const k = must(await api.listSkills()).find((x) => x.id === str(args['id']));
        if (!k) throw new Error(`No existe la skill «${str(args['id'])}».`);
        return { ok: true, summary: t('as.tool.readOne', { name: k.name }), result: k };
      }
      case 'list_contexts': {
        const list = must(await api.listContexts());
        return { ok: true, summary: t('as.tool.read', { what: t('as.what.contexts') }), result: list.map((c) => ({ id: c.id, name: c.name, kind: c.kind })) };
      }
      case 'list_mcp': {
        const list = must(await api.listMcp());
        return { ok: true, summary: t('as.tool.read', { what: 'MCP' }), result: list.map((m) => ({ id: m.id, name: m.name, description: m.description, enabled: m.enabled })) };
      }
      case 'list_diagrams': {
        const list = must(await api.listDiagrams());
        return { ok: true, summary: t('as.tool.read', { what: t('as.what.diagrams') }), result: { open: session.diagram.id, diagrams: list } };
      }
      case 'list_runs': {
        const limit = Math.min(30, Math.max(1, typeof args['limit'] === 'number' ? Math.floor(args['limit']) : 10));
        const runs = must(await api.listRuns())
          .slice()
          .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
          .slice(0, limit);
        return {
          ok: true,
          summary: t('as.tool.read', { what: t('as.what.runs') }),
          result: runs.map((r) => ({ runId: r.runId, canResume: canResume(r.status, r.resumedBy), ...(r.resumedFrom ? { resumedFrom: r.resumedFrom } : {}), ...(r.resumedBy ? { resumedBy: r.resumedBy } : {}), diagram: r.diagramName ?? r.diagramId, status: r.status, ...(r.accepted ? { accepted: r.accepted } : {}), startedAt: r.startedAt, finishedAt: r.finishedAt, order: r.order ? r.order.slice(0, 300) : undefined, reason: r.reason, tokens: r.usage.inputTokens + r.usage.outputTokens, costUsd: r.usage.costUsd })),
        };
      }
      case 'get_run': {
        const runs = must(await api.listRuns()).slice().sort((a, b) => b.startedAt.localeCompare(a.startedAt));
        const run = str(args['runId']) ? runs.find((r) => r.runId === str(args['runId'])) : runs[0];
        if (!run) return { ok: false, summary: t('as.noRuns'), result: str(args['runId']) ? `No existe la ejecución «${str(args['runId'])}».` : t('as.noRuns') };
        // Leer el historial no corta la suscripción de la interfaz: una ejecución terminada ya no emite nada.
        const events = must(await api.subscribeRun({ runId: run.runId, fromSeq: 1 }));
        const d = await api.runDiagram(run.runId);
        const diagram = d.ok && d.value ? d.value : undefined;
        const summary = summarizeRun(events, (id, path) => nodeLabel(diagram, id, path), 1500, Date.now(), run.status === 'interrupted');
        const out = await api.listOutput(run.runId);
        return {
          ok: true,
          summary: t('as.tool.readRun', { name: run.diagramName ?? diagram?.name ?? run.diagramId }),
          result: { runId: run.runId, canResume: canResume(run.status, run.resumedBy), diagram: run.diagramName ?? diagram?.name ?? run.diagramId, ...summary, outputFiles: out.ok ? out.value.map((f) => f.path) : [] },
        };
      }
      case 'accept_run': {
        const done = must(await api.acceptRun({ runId: str(args['runId']), by: 'assistant', reason: str(args['reason']) }));
        return done ? { ok: true, summary: t('as.tool.accepted'), result: { accepted: true } } : { ok: false, summary: t('as.tool.notAccepted'), result: t('as.tool.notAccepted') };
      }
      case 'resume_run': {
        const r = must(await api.resumeRun(str(args['runId'])));
        return { ok: true, summary: t('as.tool.resumed'), result: { runId: r.runId } };
      }
      case 'list_memory': {
        const q = str(args['query']).toLowerCase();
        const entries = must(await api.projectMemory()).filter((e) => !q || `${e.title} ${e.text}`.toLowerCase().includes(q));
        return { ok: true, summary: t('as.tool.read', { what: t('pmem.screen') }), result: entries.slice(0, 50).map((e) => ({ id: e.id, kind: e.kind, scope: e.scope, title: e.title, text: e.text, status: e.status })) };
      }
      case 'save_memory': {
        // Lo que guarda el asistente lleva origin 'assistant' [R76.12].
        const status = str(args['status']) === 'archived' ? 'archived' : 'active';
        const id = str(args['id']);
        const entries = must(await api.saveMemoryEntry({ ...(id ? { id } : {}), kind: str(args['kind']) as MemoryKind, scope: str(args['scope']) || 'project', title: str(args['title']), text: str(args['text']), status, by: 'assistant' }));
        return { ok: true, summary: t('pmem.savedBy.assistant'), result: { saved: true, active: entries.filter((e) => e.status === 'active').length } };
      }
      case 'get_diagram': {
        const d = session.diagram;
        return {
          ok: true,
          summary: t('as.tool.readOne', { name: d.name }),
          result: { id: d.id, name: d.name, ...(d.deliverable ? { deliverable: d.deliverable } : {}), nodes: d.nodes.map((n) => ({ id: n.id, kind: n.kind, label: n.label, agentId: n.agentId, task: n.task, ...(n.model ? { model: n.model } : {}), extra: n.extra })), edges: d.edges.map((e) => ({ from: e.from, to: e.to, condition: e.condition })) },
        };
      }
      case 'create_agent': {
        const taken = new Set(must(await api.listAgents()).map((a) => a.id));
        const id = slugify(str(args['name']), taken, 'agente');
        const agent: AgentDefinition = {
          ...newAgent(id, str(args['name'])),
          description: str(args['description']),
          instructions: str(args['instructions']),
          skillIds: strs(args['skillIds']) ?? [],
          contextIds: strs(args['contextIds']) ?? [],
          ...(strs(args['mcpIds']) ? { mcpIds: strs(args['mcpIds'])! } : {}),
          ...lookOf(args),
        };
        must(await api.saveAgent(agent));
        host.refresh();
        return { ok: true, summary: t('as.tool.createdAgent', { name: agent.name }), result: { id }, undo: async () => (must(await api.deleteAgent(id)), host.refresh()) };
      }
      case 'update_agent': {
        const before = must(await api.listAgents()).find((x) => x.id === str(args['id']));
        if (!before) throw new Error(`No existe el agente «${str(args['id'])}».`);
        const next: AgentDefinition = { ...before };
        for (const k of ['name', 'description', 'instructions'] as const) if (typeof args[k] === 'string') next[k] = args[k] as string;
        for (const k of ['skillIds', 'contextIds', 'mcpIds'] as const) if (strs(args[k])) next[k] = strs(args[k])!;
        Object.assign(next, lookOf(args));
        if (args['askFirst'] === false) delete next.askFirst;
        must(await api.saveAgent(next));
        host.refresh();
        return { ok: true, summary: t('as.tool.updatedAgent', { name: next.name }), result: { id: next.id }, undo: async () => (must(await api.saveAgent(before)), host.refresh()) };
      }
      case 'create_skill': {
        const taken = new Set(must(await api.listSkills()).map((k) => k.id));
        const id = slugify(str(args['name']), taken, 'skill');
        must(await api.saveSkill({ ...newSkill(id, str(args['name'])), description: str(args['description']), body: str(args['body']) }));
        host.refresh();
        return { ok: true, summary: t('as.tool.createdSkill', { name: str(args['name']) }), result: { id }, undo: async () => (must(await api.deleteSkill(id)), host.refresh()) };
      }
      case 'create_context': {
        const taken = new Set(must(await api.listContexts()).map((c) => c.id));
        const id = slugify(str(args['name']), taken, 'contexto');
        must(await api.saveContext({ ...newContext(id, str(args['name'])), value: str(args['text']) }));
        host.refresh();
        return { ok: true, summary: t('as.tool.createdContext', { name: str(args['name']) }), result: { id }, undo: async () => (must(await api.deleteContext(id)), host.refresh()) };
      }
      case 'add_step': {
        const edgeId = edgeAfter(session.getSnapshot().level, str(args['after']));
        const id = session.insertOnEdge(edgeId, { kind: 'agent', agentId: str(args['agentId']) });
        if (str(args['task']).trim()) session.updateNode(id, { task: str(args['task']) });
        return { ok: true, summary: t('as.tool.addedStep', { name: str(args['agentId']) }), result: { nodeId: id } };
      }
      case 'set_deliverable': {
        if (args['clear'] === true) {
          session.setDeliverable(undefined);
          return { ok: true, summary: t('as.tool.deliverable.off'), result: { deliverable: null } };
        }
        const spec = deliverableFromArgs(args);
        // Las mismas comprobaciones que en el panel de la Salida [R46.16].
        const problems = deliverableProblems(spec);
        if (problems.length > 0) throw new Error(`Entregable no válido: ${problems.map((p) => p.message).join('; ')}`);
        session.setDeliverable(spec);
        return { ok: true, summary: t('as.tool.deliverable', { what: deliverableLabel(spec) ?? '' }), result: { deliverable: spec } };
      }
      case 'add_coordinator': {
        const edgeId = edgeAfter(session.getSnapshot().level, str(args['after']));
        const id = session.insertOnEdge(edgeId, { kind: 'agent', agentId: COORDINATOR_ID });
        session.updateNode(id, { label: t('pal.step.coordinator'), ...(str(args['task']).trim() ? { task: str(args['task']) } : {}) });
        return { ok: true, summary: t('as.tool.coordinator'), result: { nodeId: id } };
      }
      case 'set_task':
        session.updateNode(str(args['nodeId']), { task: str(args['task']) });
        return { ok: true, summary: t('as.tool.task', { node: str(args['nodeId']) }), result: { ok: true } };
      case 'connect': {
        const r = session.tryConnect(str(args['from']), str(args['to']));
        if (!r.ok) throw new Error(r.message);
        return { ok: true, summary: t('as.tool.connected', { from: str(args['from']), to: str(args['to']) }), result: { edgeId: r.edgeId } };
      }
      case 'add_parallel': {
        const edgeId = edgeAfter(session.getSnapshot().level, str(args['after']));
        const ids = strs(args['agentIds']) ?? [];
        const join = str(args['joinAgentId']);
        const r = session.insertParallel(edgeId, {
          branches: ids.map((agentId) => ({ agentId })),
          ...(join ? { join: { agentId: join, label: t('parallel.join.label'), task: str(args['joinTask']) || t('parallel.join.task') } } : {}),
        });
        return { ok: true, summary: t('as.tool.parallel', { count: ids.length }), result: r };
      }
      case 'create_diagram':
        await host.newDiagram(str(args['name']));
        return { ok: true, summary: t('as.tool.newDiagram', { name: str(args['name']) }), result: { id: session.diagram.id } };
      case 'remove_step': {
        const r = removeStep(session, str(args['nodeId']));
        return { ok: true, summary: t('as.tool.removedStep', { node: str(args['nodeId']) }), result: { ok: true, ...r } };
      }
      case 'delete_agent':
        must(await api.deleteAgent(str(args['id'])));
        host.refresh();
        return { ok: true, summary: t('as.tool.deleted', { name: str(args['id']) }), result: { ok: true } };
      case 'delete_skill':
        must(await api.deleteSkill(str(args['id'])));
        host.refresh();
        return { ok: true, summary: t('as.tool.deleted', { name: str(args['id']) }), result: { ok: true } };
      case 'delete_context':
        must(await api.deleteContext(str(args['id'])));
        host.refresh();
        return { ok: true, summary: t('as.tool.deleted', { name: str(args['id']) }), result: { ok: true } };
      case 'create_mcp': {
        const taken = new Set(must(await api.listMcp()).map((m) => m.id));
        const id = slugify(str(args['name']), taken, 'mcp');
        const transport = str(args['transport']) === 'http' ? 'http' : 'stdio';
        const scope = str(args['scope']) === 'app' ? 'app' : 'project';
        const base = newMcpServer(id, str(args['name']));
        const def: McpServerDefinition = {
          ...base,
          description: str(args['description']),
          transport,
          ...(transport === 'stdio' ? { command: str(args['command']), args: strs(args['args']) ?? [] } : { url: str(args['url']) }),
          ...(strs(args['secretNames'])?.length ? { secretNames: strs(args['secretNames'])! } : {}),
          scope,
        };
        if (transport === 'http') {
          delete def.args;
          delete def.command;
        }
        must(await api.saveMcp(def));
        host.refresh();
        host.created?.('mcp', id);
        return {
          ok: true,
          summary: t('as.tool.createdMcp', { name: def.name, where: scope === 'app' ? t('as.tool.where.app') : '' }),
          result: { id, secretNames: def.secretNames ?? [] },
          undo: async () => (must(await api.deleteMcp(id)), host.refresh()),
        };
      }
      case 'update_mcp': {
        const before = defOf(await mcpById(api, str(args['id'])));
        const next: McpServerDefinition = { ...before };
        for (const k of ['name', 'description', 'command', 'url'] as const) if (typeof args[k] === 'string') next[k] = args[k] as string;
        for (const k of ['args', 'secretNames'] as const) if (strs(args[k])) next[k] = strs(args[k])!;
        if (args['scope'] === 'app' || args['scope'] === 'project') next.scope = args['scope'];
        if (typeof args['enabled'] === 'boolean') next.enabled = args['enabled'];
        must(await api.saveMcp(next));
        host.refresh();
        return { ok: true, summary: t('as.tool.updatedMcp', { name: next.name }), result: { id: next.id }, undo: async () => (must(await api.saveMcp(before)), host.refresh()) };
      }
      case 'test_mcp': {
        const m = await mcpById(api, str(args['id']));
        const r = must(await api.testMcp(m.id));
        return { ok: true, summary: r.ok ? t('as.tool.testOk', { name: m.name, tools: r.tools.join(', ') || '—' }) : t('as.tool.testFail', { name: m.name, message: r.message }), result: r };
      }
      case 'assign_mcp': {
        const m = await mcpById(api, str(args['mcpId']));
        const nodeId = str(args['nodeId']);
        if (nodeId) {
          const node = session.getSnapshot().level.nodes.find((n) => n.id === nodeId);
          if (!node) throw new Error(`No existe el paso «${nodeId}» en el diagrama abierto.`);
          const list = node.extra?.mcpIds ?? [];
          if (!list.includes(m.id)) session.updateNode(nodeId, { extra: { ...node.extra, mcpIds: [...list, m.id] } });
          return { ok: true, summary: t('as.tool.assignedStep', { mcp: m.name, name: node.label ?? nodeId }), result: { ok: true } };
        }
        const before = must(await api.listAgents()).find((x) => x.id === str(args['agentId']));
        if (!before) throw new Error(`Indica agentId o nodeId: no existe el agente «${str(args['agentId'])}».`);
        const list = before.mcpIds ?? [];
        if (!list.includes(m.id)) must(await api.saveAgent({ ...before, mcpIds: [...list, m.id] }));
        host.refresh();
        return { ok: true, summary: t('as.tool.assignedAgent', { mcp: m.name, name: before.name }), result: { ok: true }, undo: async () => (must(await api.saveAgent(before)), host.refresh()) };
      }
      case 'open_terminal': {
        const program = str(args['program']) === 'shell' ? 'shell' : 'claude';
        if (!host.openTerminal) throw new Error('La terminal no está disponible aquí.');
        const r = await host.openTerminal(program, program === 'claude' ? str(args['prompt']) : undefined);
        return { ok: true, summary: t(r.external ? 'as.tool.terminalExternal' : 'as.tool.terminal'), result: { opened: true, external: r.external } };
      }
      case 'git_status': {
        const o = must(await api.gitOverview());
        if (!o) return { ok: true, summary: t('as.git.read'), result: { repo: false } };
        return {
          ok: true,
          summary: t('as.git.read'),
          result: {
            repo: true,
            branch: o.state.branch ?? null,
            ...(o.state.busy ? { busy: o.state.busy } : {}),
            changes: o.changes.slice(0, 100).map((c) => ({ path: c.path, status: c.status })),
            branches: o.branches.filter((b) => !b.remote).map((b) => ({ name: b.name, ...(b.current ? { current: true } : {}), ...(b.upstream ? { upstream: b.upstream, ahead: b.ahead, behind: b.behind } : {}), ...(o.origins[b.name] ? { createdBy: o.origins[b.name] } : {}) })),
            stashes: o.stashes,
            runningExecutions: o.running,
          },
        };
      }
      case 'git_history': {
        const limit = Math.min(100, Math.max(1, typeof args['limit'] === 'number' ? Math.floor(args['limit']) : 20));
        const h = must(await api.gitHistory({ limit }));
        return { ok: true, summary: t('as.git.read'), result: h.commits.map((c) => ({ sha: c.sha.slice(0, 7), subject: c.subject, author: c.author, date: c.date, ...(c.refs.length > 0 ? { refs: c.refs } : {}), ...(h.origins[c.sha] ? { madeBy: h.origins[c.sha] } : {}) })) };
      }
      case 'git_create_branch':
      case 'git_switch_branch':
      case 'git_commit':
      case 'git_push':
      case 'git_pull':
      case 'git_merge_branch':
      case 'git_delete_branch':
      case 'git_stash': {
        const branch = str(args['name']);
        const action: GitAction =
          name === 'git_create_branch'
            ? { kind: 'create', name: branch, ...(str(args['from']) ? { from: str(args['from']) } : {}) }
            : name === 'git_switch_branch'
              ? { kind: 'switch', name: branch }
              : name === 'git_commit'
                ? { kind: 'commit', message: str(args['message']) }
                : name === 'git_push'
                  ? { kind: 'push' }
                  : name === 'git_pull'
                    ? { kind: 'pull' }
                    : name === 'git_merge_branch'
                      ? { kind: 'merge', name: branch }
                      : name === 'git_delete_branch'
                        ? { kind: 'delete', name: branch }
                        : { kind: 'stash', ...(str(args['label']) ? { label: str(args['label']) } : {}) };
        const before = must(await api.gitOverview());
        const o = must(await api.gitAct(action));
        host.refresh();
        const now = o.state.branch ?? '';
        const summary =
          action.kind === 'create'
            ? t('as.git.created', { branch: action.name, from: action.from ?? before?.state.branch ?? '' })
            : action.kind === 'switch'
              ? t('as.git.switched', { branch: action.name })
              : action.kind === 'commit'
                ? t('as.git.committed', { n: before?.changes.length ?? 0, branch: now })
                : action.kind === 'push'
                  ? t('as.git.pushed', { branch: now })
                  : action.kind === 'pull'
                    ? t('as.git.pulled', { branch: now })
                    : action.kind === 'merge'
                      ? t('as.git.merged', { branch: action.name, into: now })
                      : action.kind === 'delete'
                        ? t('as.git.deleted', { branch: action.name })
                        : t('as.git.stashed');
        return { ok: true, summary, result: { done: true, branch: o.state.branch ?? null, changes: o.changes.length, ...(o.state.commit ? { commit: o.state.commit } : {}) } };
      }
      case 'git_list_reviews': {
        const v = must(await api.gitReviews());
        if (!v) return { ok: true, summary: t('as.git.reviews', { word: 'PR' }), result: { available: false } };
        return { ok: true, summary: t('as.git.reviews', { word: v.word }), result: { available: true, provider: v.provider, project: v.project, connected: v.via ?? false, ...(v.error ? { error: v.error } : {}), reviews: v.reviews } };
      }
      case 'git_create_review': {
        const v = must(await api.gitReviews());
        if (!v) return { ok: false, summary: t('as.git.review.none'), result: { error: t('as.git.review.none') } };
        const head = str(args['head']) || (must(await api.gitOverview())?.state.branch ?? '');
        const base = str(args['base']) || (v.base ?? '');
        if (!head || !base) return { ok: false, summary: t('as.git.review.branches'), result: { error: t('as.git.review.branches') } };
        const made = must(await api.gitCreateReview({ title: str(args['title']), head, base, ...(str(args['body']) ? { body: str(args['body']) } : {}), ...(args['draft'] === true ? { draft: true } : {}) }));
        host.refresh();
        return { ok: true, summary: t('as.git.review.made', { word: v.word, n: made.number, base }), result: made };
      }
      case 'run_diagram': {
        // Lo mismo que comprueba el lanzador, con todos los problemas [R85.5].
        const issues = validateDiagram(session.diagram);
        if (issues.length > 0) throw new Error(`El diagrama no se puede ejecutar:\n${issues.map((i) => `- ${i.message}`).join('\n')}`);
        const runId = await host.run(str(args['input']));
        if (!runId) throw new Error('No se pudo lanzar la ejecución: la app enseña el motivo.');
        return { ok: true, summary: t('as.tool.ran'), result: { started: true, runId } };
      }
      default:
        throw new Error(`Herramienta desconocida: ${name}`);
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, summary: message, result: message };
  }
}

/** Entregable a partir de los argumentos de `set_deliverable` [R46.16]. */
export function deliverableFromArgs(args: Record<string, unknown>): DeliverableSpec {
  const items: DeliverableItem[] = [];
  const text = (k: string) => (typeof args[k] === 'string' && (args[k] as string).trim() ? (args[k] as string).trim() : undefined);
  if (args['links'] === true) items.push({ kind: 'links' });
  if (args['summary'] === true || text('summaryInstructions')) items.push({ kind: 'summary', ...(text('summaryInstructions') ? { instructions: text('summaryInstructions')! } : {}) });
  if (args['json'] === true || text('jsonSchema') || text('jsonInstructions')) items.push({ kind: 'json', ...(text('jsonSchema') ? { schema: text('jsonSchema')! } : {}), ...(text('jsonInstructions') ? { instructions: text('jsonInstructions')! } : {}) });
  for (const sec of strs(args['sections']) ?? []) {
    const i = sec.indexOf(':');
    items.push({ kind: 'custom', title: (i > 0 ? sec.slice(0, i) : sec).trim(), instructions: (i > 0 ? sec.slice(i + 1) : '').trim() });
  }
  return {
    items,
    ...(text('notify') ? { notify: text('notify') as DeliverableSpec['notify'] } : {}),
    ...(text('onMissing') ? { onMissing: text('onMissing') as DeliverableSpec['onMissing'] } : {}),
    ...(text('fileName') ? { fileName: text('fileName')! } : {}),
  };
}
