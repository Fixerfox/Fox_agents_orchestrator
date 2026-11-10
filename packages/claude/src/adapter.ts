import { BranchTracker } from './git-branch';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AgentError, effectivePermission, loadsClaudeConfig, mergeExtra, type FileChange, type AgentAdapter, type AgentRequest, type AgentStreamEvent, type AgentDefinition, type AppSettings, type ContextDefinition, type SkillDefinition } from '@orquestador/core';
import { baseOptions } from './connection';
import { explainThrown } from './errors';
import { MessageMapper } from './mapper';
import { buildSystemPrompt, buildUserPrompt, claudeCodePrompt } from './prompt';
import type { PermissionResult, QueryFn, SdkMcpServer } from './sdk-types';
import { createMcpPolicy, sdkMcpConfig, type ResolvedMcp } from './mcp';
import { KnowledgeTracker, describeKnowledge, planKnowledge } from './knowledge';
import { agentTools, createWritePolicy, withIsolation, withScope, withSelfProtection, withVerifier, guardedPolicy, summarizeFolder, type WritePolicyDeps } from './workfolder';
import { CommandWatch } from './changes';
import { classifyCommand } from './commands';

/** Lo que el adaptador necesita del proyecto y de Ajustes; se lee al empezar cada ejecución del nodo [R27.10]. */
export interface ClaudeEnvironment {
  projectRoot: string;
  settings(): AppSettings;
  apiKey(): Promise<string | undefined>;
  /** `runId`: la ejecución lee la copia que se hizo al lanzarla [R52.1]. */
  loadAgent(id: string, runId?: string): Promise<AgentDefinition | undefined>;
  loadContexts(ids: string[], runId?: string): Promise<ContextDefinition[]>;
  loadSkills(ids: string[], runId?: string): Promise<SkillDefinition[]>;
  /** Carpeta de trabajo elegida por el usuario [R31.1]; si falta, se trabaja en la carpeta del proyecto. */
  workFolder?(): Promise<string | undefined>;
  /** Carpeta de datos de la app (clave, secretos): los agentes no la leen fuera de su carpeta de trabajo [R87.4]. */
  appDataDir?: string;
  /** ¿Se carga la configuración de Claude Code del proyecto para un paso que trabaja en `dir`? Sin valor, sí [R88.4]. */
  projectConfigTrusted?(dir: string): Promise<boolean>;
  /** Copia de seguridad antes de modificar un archivo existente [R31.6]. */
  backup?(runId: string, abs: string, rel: string): Promise<void>;
  /** Servidores MCP del agente con sus secretos (solo en el proceso principal) [R30.4]. */
  loadMcp?(ids: string[], runId?: string): Promise<ResolvedMcp[]>;
  /** Archivos creados, cambiados o denegados, para el registro [R31.7]. */
  onFileEvent?(nodeId: string, event: Parameters<NonNullable<WritePolicyDeps['note']>>[0]): void;
  /** Servidor MCP en proceso `memoria_proyecto`, de solo lectura, con los ámbitos del paso [R76.15]. */
  memoryServer?(runId: string | undefined, scopes: readonly string[]): Promise<unknown | undefined>;
}

/** Nombre del servidor de la memoria del proyecto y prefijo de sus herramientas [R76.15]. */
export const MEMORY_SERVER = 'memoria_proyecto';
const MEMORY_TOOL = `mcp__${MEMORY_SERVER}__`;

/** Las herramientas MCP pasan por su política; el resto, por la de escritura [R30.4]. */
const withMcp =
  (mcp: ReturnType<typeof createMcpPolicy>, rest: (tool: string, input: Record<string, unknown>) => Promise<PermissionResult>) =>
  async (tool: string, input: Record<string, unknown>): Promise<PermissionResult> =>
    (await mcp(tool, input)) ?? rest(tool, input);

export class ClaudeAdapter implements AgentAdapter {
  /** Comandos permitidos «en esta ejecución», por ejecución; se olvidan las más antiguas [R47.3]. */
  private readonly grants = new Map<string, Set<string>>();

  private grantsFor(runId: string): Set<string> {
    let set = this.grants.get(runId);
    if (!set) {
      set = new Set();
      this.grants.set(runId, set);
      if (this.grants.size > 50) this.grants.delete(this.grants.keys().next().value!);
    }
    return set;
  }

  constructor(
    private readonly env: ClaudeEnvironment,
    private readonly query: QueryFn,
  ) {}

  async *run(request: AgentRequest, signal: AbortSignal): AsyncIterable<AgentStreamEvent> {
    const agent = await this.env.loadAgent(request.agentId, request.runId);
    if (!agent) {
      throw new AgentError(`El agente «${request.agentId}» no existe en el proyecto. Créalo en la pantalla Agentes o cambia el motor a simulado en Ajustes.`, false);
    }
    // Lo del agente más lo añadido por el diagrama y por el paso, sin repetir [R33.3].
    const known = mergeExtra({ skillIds: agent.skillIds, contextIds: agent.contextIds, mcpIds: agent.mcpIds ?? [], ...(agent.required ? { required: agent.required } : {}) }, request.extra);
    const [contexts, skills, apiKey, mcp] = await Promise.all([
      this.env.loadContexts(known.contextIds ?? [], request.runId),
      this.env.loadSkills(known.skillIds ?? [], request.runId),
      this.env.apiKey(),
      known.mcpIds && this.env.loadMcp ? this.env.loadMcp(known.mcpIds, request.runId) : Promise.resolve([] as ResolvedMcp[]),
    ]);
    const mcpServers: Record<string, SdkMcpServer> = sdkMcpConfig(mcp);
    // La memoria del proyecto, para leer bajo demanda lo que no cabe en el prompt [R76.15].
    const memoryServer = request.projectMemory && this.env.memoryServer ? await this.env.memoryServer(request.runId, request.projectMemory.scopes ?? ['project']).catch(() => undefined) : undefined;
    if (memoryServer) mcpServers[MEMORY_SERVER] = memoryServer as SdkMcpServer;
    const mcpPolicy = createMcpPolicy(mcp, request.ask, { noAsk: effectivePermission(agent, this.env.settings()) === 'full' });
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal.aborted) return;
    signal.addEventListener('abort', abort, { once: true });
    const mapper = new MessageMapper(apiKey, request.maxCostUsd);
    const chosen = await this.env.workFolder?.();
    // En una rama en paralelo, el paso trabaja en su espacio y la carpeta original queda fuera [R73.8].
    const original = request.workspace ? (chosen ?? this.env.projectRoot) : undefined;
    const folder = request.workspace?.dir ?? chosen;
    const summary = folder ? await summarizeFolder(folder) : undefined;
    let finished = false;
    const root = folder ?? this.env.projectRoot;
    // Archivos que la política dejó crear o modificar; pasan a la salida del nodo [R31.12].
    const touched = new Map<string, FileChange>();
    const sent = new Set<string>();
    // Lo que cambian los comandos (un script que genera páginas, un build…) también se registra [R55.1].
    const watch = new CommandWatch(root);
    // Qué rama de git crea o toca el agente [R58.2]; desde un espacio aislado, nada [R73.10].
    const branches = request.workspace ? silentBranches : new BranchTracker(root);
    /** El agente ha preguntado y tiene respuesta en este intento [R39.4]. */
    let asked = false;
    /** Acciones frenadas, para el Supervisor [R60.16]. */
    const blocked: string[] = [];
    const note: WritePolicyDeps['note'] = (e) => {
      if (e.kind !== 'denied' && touched.get(e.path) !== 'created') touched.set(e.path, e.kind);
      if (e.kind === 'denied') blocked.push(`${e.path}: ${e.reason ?? 'denegado'}`);
      this.env.onFileEvent?.(request.nodeId, e);
    };
    try {
      // Cómo se entrega cada skill, contexto y MCP, y qué obligatorios hay que cumplir [R36.5–R36.12].
      const plan = await planKnowledge({ known, contexts, skills, mcp, projectRoot: this.env.projectRoot, cwd: folder ?? this.env.projectRoot });
      const tracker = new KnowledgeTracker(plan.items);
      const missed = (request.missing ?? []).map((m) => plan.items.find((i) => i.kind === m.kind && i.id === m.id)).filter((i) => i !== undefined);
      const settings = this.env.settings();
      const level = effectivePermission(agent, settings);
      // La política corre en canUseTool y en el gancho, con una sola decisión por llamada [R50.4].
      const guard = guardedPolicy(
        withPause(request.whilePaused, withSelfProtection(note, watchCommands(
          watch,
          root,
          withMcp(
            async (tool, input) => (tool.startsWith(MEMORY_TOOL) ? { behavior: 'allow' as const, updatedInput: input } : mcpPolicy(tool, input)),
            withVerifier(request.verify, note, withIsolation(original, note, withScope(request.scope, root, note, createWritePolicy({
            root,
            level,
            appDirs: [...new Set([path.join(root, '.orquestador'), path.join(this.env.projectRoot, '.orquestador')])],
            // Se lee sin preguntar en la carpeta del proyecto y en lo de Claude Code del usuario [R87.5].
            readRoots: [this.env.projectRoot, path.join(os.homedir(), '.claude')],
            ...(this.env.appDataDir ? { protectedDirs: [this.env.appDataDir] } : {}),
            commandGrants: this.grantsFor(request.runId ?? request.nodeId),
            ask: request.ask,
            backup: async (abs, rel) => this.env.backup?.(request.runId ?? 'sin-ejecucion', abs, rel),
            note,
            ...(agent.askFirst ? { askFirst: true } : {}),
            onAsked: () => {
              asked = true;
            },
          })), root)),
          ),
        ))),
      );
      const options = {
        ...baseOptions({
          settings,
          apiKey,
          cwd: folder ?? this.env.projectRoot,
          // El modelo del paso manda sobre el de la ficha [R40.4].
          model: request.model ?? agent.model,
          ...(agent.maxTurns !== undefined ? { maxTurns: agent.maxTurns } : {}),
          // El tope del paso o de la ficha lo aplica el SDK [R77.9].
          ...(request.maxCostUsd !== undefined ? { maxBudgetUsd: request.maxCostUsd } : {}),
          controller,
          toolList: agentTools(loadsClaudeConfig(settings)),
          canUseTool: guard.canUseTool,
          claudeCode: true,
          projectTrusted: (await this.env.projectConfigTrusted?.(folder ?? this.env.projectRoot)) ?? true,
        }),
        ...(Object.keys(mcpServers).length > 0 ? { mcpServers } : {}),
        // El prompt de Claude Code, con lo del agente al final [R50.1].
        systemPrompt: claudeCodePrompt(
          buildSystemPrompt(agent, contexts, skills, summary ?? { text: '(carpeta del proyecto)' }, plan, {
            ...(request.confirm ? { confirm: true } : {}),
            ...(request.split ? { split: request.split } : {}),
            ...(request.deliverable ? { deliverable: request.deliverable } : {}),
            ...(request.projectMemory ? { projectMemory: request.projectMemory.text } : {}),
            level,
            projectRoot: this.env.projectRoot,
          }),
        ),
        // Sin tope práctico: el gancho puede estar esperando a que el usuario responda un permiso [R50.4].
        hooks: { PreToolUse: [{ hooks: [guard.hook], timeout: HOOK_TIMEOUT_S }] },
      };
      await branches.start();
      for (const u of tracker.inlined()) yield { type: 'knowledge', kind: u.item.kind, id: u.item.id, via: u.via, required: true };
      for await (const msg of this.query({ prompt: buildUserPrompt(request.input, request.previousAnswers, request.task, missed.map((i) => `«${i.name}»`), request.previousAttempt, request.memory, request.loop, request.flow), options })) {
        if (signal.aborted) return;
        let mapped: AgentStreamEvent[];
        try {
          mapped = mapper.map(msg);
        } catch (err) {
          // Lo gastado en un intento que falla también cuenta [R77.9].
          yield* mapper.usageOf(msg);
          throw err;
        }
        for (const ev of mapped) {
          if (ev.type === 'tool_call') {
            branches.called(ev.tool, ev.input);
            for (const u of tracker.observe(ev.tool, ev.input)) yield { type: 'knowledge', kind: u.item.kind, id: u.item.id, via: u.via, required: u.item.required };
          }
          if (ev.type === 'result') {
            const unmet = tracker.unmet();
            if (unmet.length > 0) {
              for (const i of unmet) yield { type: 'knowledge_unmet', kind: i.kind, id: i.id };
              throw new AgentError(`Claude terminó sin usar lo obligatorio: ${describeKnowledge(unmet)}.`, true, unmet.map((i) => ({ kind: i.kind, id: i.id })));
            }
            // Terminó sin consultar: la app pregunta por él antes de seguir [R39.4].
            if (agent.askFirst && !asked) {
              const answer = (await request.ask({ text: askFirstGate(agent.name), options: [ASK_FIRST_OK, ASK_FIRST_REDO], kind: 'gate', fallback: ASK_FIRST_REDO })).trim();
              if (answer !== ASK_FIRST_OK) throw new AgentError(answer === ASK_FIRST_REDO || answer === '' ? 'El usuario pide que lo rehaga consultándole antes.' : `El usuario pide que lo rehaga: ${answer}`, true);
            }
            finished = true;
            yield* touchedFiles(root, touched, sent, true);
            yield* commandFiles(await watch.closing('final'), touched, sent);
            yield* branches.finished();
          }
          yield ev;
          if (ev.type === 'tool_result') {
            yield* branches.settled(ev.tool, ev.ok, ev.output);
            for (const detail of blocked.splice(0)) yield { type: 'blocked', detail };
            yield* touchedFiles(root, touched, sent, false);
            if (ev.tool === 'Bash') yield* commandFiles(await watch.closing('done', ev.id), touched, sent);
            else if (ev.tool === 'Agent' || ev.tool === 'Task') yield* commandFiles(await watch.closing('flush'), touched, sent);
          }
        }
        // Con el resultado, el paso ha terminado: no se espera a lo que quede en segundo plano [R92.5].
        if (finished) break;
      }
      if (!finished && !signal.aborted) throw new AgentError('Claude terminó sin devolver un resultado.', true);
    } catch (e) {
      // Lo que ya escribió queda registrado también si el intento falla [R45.2].
      yield* touchedFiles(root, touched, sent, true);
      yield* commandFiles(await watch.closing('final').catch(() => []), touched, sent);
      yield* branches.finished();
      if (signal.aborted) return;
      throw explainThrown(e, apiKey);
    } finally {
      signal.removeEventListener('abort', abort);
      // Cierra la sesión del SDK y lo que el agente dejara en marcha [R92.5].
      if (finished) controller.abort();
    }
  }
}

/**
 * Eventos `file` de lo tocado que aún no se han enviado. Se llama tras cada resultado de herramienta, así lo escrito
 * queda registrado aunque el paso se pare, falle o se cancele después [R45.2]. Un archivo nuevo que todavía no existe
 * espera a la siguiente vez; en la última (`final`) se descarta porque no llegó a crearse [R31.12].
 */
async function* touchedFiles(root: string, touched: Map<string, FileChange>, sent: Set<string>, final: boolean): AsyncIterable<AgentStreamEvent> {
  for (const [rel, change] of [...touched]) {
    if (sent.has(rel)) {
      touched.delete(rel);
      continue;
    }
    if (change === 'created') {
      try {
        await fs.stat(path.join(root, rel));
      } catch {
        if (final) touched.delete(rel);
        continue;
      }
    }
    touched.delete(rel);
    sent.add(rel);
    yield { type: 'file', path: rel, change };
  }
}

/**
 * Eventos `file` de lo que ha cambiado un comando [R55.3]. Lo que ya salió o va a salir por la política de escritura
 * no se repite: allí está la copia y el tipo exacto.
 */
function* commandFiles(changes: readonly { path: string; change: FileChange }[], touched: ReadonlyMap<string, FileChange>, sent: Set<string>): Iterable<AgentStreamEvent> {
  for (const { path: rel, change } of changes) {
    if (sent.has(rel) || touched.has(rel)) continue;
    sent.add(rel);
    yield { type: 'file', path: rel, change, via: 'command' };
  }
}

/** Antes de ejecutar un comando permitido se hace la foto de la carpeta [R55.2]. */
const watchCommands =
  (watch: CommandWatch, root: string, policy: (tool: string, input: Record<string, unknown>) => Promise<PermissionResult>) =>
  async (tool: string, input: Record<string, unknown>, id?: string): Promise<PermissionResult> => {
    const r = await policy(tool, input);
    if (r.behavior !== 'allow' || tool !== 'Bash') return r;
    // Lo que solo lee (ls, grep, cat…) no cambia nada: no hace falta foto.
    const command = typeof input['command'] === 'string' ? (input['command'] as string) : '';
    if (!(await classifyCommand(command, root, root, { readOnly: true })).safe) await watch.opening(id);
    return r;
  };

/** Seguimiento de ramas que no registra nada (rama en paralelo) [R73.10]. */
const silentBranches: Pick<BranchTracker, 'start' | 'called' | 'settled' | 'finished'> = {
  start: async () => undefined,
  called: () => undefined,
  settled: async function* () {},
  finished: async function* () {},
};

/** Segundos que el SDK espera al gancho de permisos: un día [R50.4]. */
export const HOOK_TIMEOUT_S = 24 * 60 * 60;

export const ASK_FIRST_OK = 'Dar por bueno';
export const ASK_FIRST_REDO = 'Que lo rehaga';
/** Pregunta que hace la app cuando un agente que debía consultar no lo ha hecho [R39.4]. */
export const askFirstGate = (name: string) => `«${name}» ha terminado sin consultarte. ¿Doy por bueno su resultado?`;

/** En pausa, la herramienta espera a que se reanude antes de decidir nada: no empieza ninguna nueva [R77.12]. */
export function withPause<P extends (tool: string, input: Record<string, unknown>, id?: string) => Promise<PermissionResult>>(whilePaused: ((tool: string) => Promise<void>) | undefined, policy: P): P {
  if (!whilePaused) return policy;
  return (async (tool: string, input: Record<string, unknown>, id?: string) => {
    await whilePaused(tool);
    return policy(tool, input, id);
  }) as P;
}
