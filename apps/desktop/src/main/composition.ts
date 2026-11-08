import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { claudePathPolicy, createClaudeEngine, type ClaudeEnvironment, type QueryFn } from '@orquestador/claude';
import type { AppSettings, LibraryReader, Orchestrator } from '@orquestador/core';
import { createEngineOrchestrator, snapshotLibrary, withBuiltinAgents, type RunPorts, type RunSnapshots } from '@orquestador/runtime';
import { ProjectStore, libraryReaderOf, runRepositoryOf } from '@orquestador/store';
import { BranchSpaceManager, cleanupBranchSpaces, workspaceFiles } from '@orquestador/workspace';
import { tmpdir } from 'node:os';

/** Único lugar que crea los adaptadores concretos y los conecta con los puertos [R56.5]. */

/** Lo que el orquestador necesita saber del proyecto abierto y de Ajustes, siempre al día [R27.1]. */
export interface OrchestratorContext {
  store: ProjectStore;
  projectRoot: string;
  settings(): AppSettings;
  apiKey(): Promise<string | undefined>;
  /** Secretos de un servidor MCP del proyecto; solo en el proceso principal [R30.4]. */
  mcpSecrets?(id: string, scope?: 'project' | 'app'): Promise<Record<string, string>>;
  /** Copias de las ejecuciones en marcha: sus pasos leen de ahí y no del disco [R52.1]. */
  snapshots?: RunSnapshots;
  /** Carpeta de los espacios de las ramas en paralelo, fuera de la de trabajo (datos de la app) [R73.6]. */
  spacesRoot?: string;
}

/** Espacios abiertos de cada ejecución en marcha, para la vista previa [R73.19]. */
const liveSpaces = new Map<string, BranchSpaceManager>();

/** Carpeta en la que trabaja ahora un paso de una rama aislada [R73.19]. */
export const stepSpaceDir = (runId: string, key: string): string | undefined => liveSpaces.get(runId)?.dirForStep(key);

/** Espacios de las ramas en paralelo de una ejecución; se olvidan al cerrarlos todos [R73.2][R73.18]. */
export function branchSpacesFor(ctx: Pick<OrchestratorContext, 'store' | 'projectRoot' | 'spacesRoot'>) {
  return (runId: string): BranchSpaceManager => {
    const m = new BranchSpaceManager({ workRoot: async () => (await ctx.store.getWorkFolder()) ?? ctx.projectRoot, runDir: ctx.store.paths.runDir(runId), spacesRoot: ctx.spacesRoot ?? path.join(tmpdir(), 'orquestador-spaces') });
    liveSpaces.set(runId, m);
    const closeAll = m.closeAll.bind(m);
    m.closeAll = async () => {
      try {
        await closeAll();
      } finally {
        liveSpaces.delete(runId);
      }
    };
    return m;
  };
}

export const createProject = (root: string, init: { name: string }): Promise<ProjectStore> => ProjectStore.create(root, init);
export const openProject = (root: string): Promise<ProjectStore> => ProjectStore.open(root);

/** Biblioteca del proyecto, leída de la copia de la ejecución si la tiene [R52.1]. */
const libraryOf = (ctx: Pick<OrchestratorContext, 'store' | 'snapshots'>): LibraryReader => withBuiltinAgents(snapshotLibrary(libraryReaderOf(ctx.store), ctx.snapshots));

/** Entorno del adaptador de Claude: lee agentes, contextos y skills del proyecto [R27.10] o de la copia [R52.1]. */
export function claudeEnvironment(ctx: OrchestratorContext): ClaudeEnvironment {
  const library = libraryOf(ctx);
  return {
    projectRoot: ctx.projectRoot,
    settings: ctx.settings,
    apiKey: ctx.apiKey,
    workFolder: () => ctx.store.getWorkFolder(),
    backup: (runId, abs, rel) => ctx.store.backupFile(runId, abs, rel),
    async loadAgent(id, runId) {
      return (await library.agents(runId)).find((a) => a.id === id);
    },
    async loadContexts(ids, runId) {
      const all = await library.contexts(runId);
      return ids.flatMap((id) => all.filter((c) => c.id === id));
    },
    async loadSkills(ids, runId) {
      const all = await library.skills(runId);
      return ids.flatMap((id) => all.filter((s) => s.id === id));
    },
    async loadMcp(ids, runId) {
      const all = await library.mcp(runId);
      const picked = ids.flatMap((id) => all.filter((m) => m.id === id && m.enabled));
      return Promise.all(picked.map(async (def) => ({ def, secrets: (await ctx.mcpSecrets?.(def.id, def.scope)) ?? {} })));
    },
  };
}

/**
 * Devuelve al punto de partida lo que tocó un intento fallido [R71.10]: lo modificado desde la copia de la ejecución
 * (R31.6) y lo creado se borra. Nunca sale de la carpeta de trabajo.
 */
export function restoreAttemptFiles(store: Pick<ProjectStore, 'restoreBackup' | 'getWorkFolder'>, projectRoot: string) {
  return async (runId: string, files: { path: string; change?: 'created' | 'modified' }[], dir?: string) => {
    const restored: string[] = [];
    const removed: string[] = [];
    const failed: { path: string; reason: string }[] = [];
    // En una rama aislada se devuelve en su espacio [R73.8].
    const root = path.resolve(dir ?? (await store.getWorkFolder()) ?? projectRoot);
    for (const f of files) {
      const abs = path.resolve(root, ...f.path.split('/'));
      if (abs !== root && !abs.startsWith(root + path.sep)) {
        failed.push({ path: f.path, reason: 'fuera de la carpeta de trabajo' });
        continue;
      }
      try {
        if (f.change === 'created') {
          await fsp.rm(abs, { force: true });
          removed.push(f.path);
        } else if (await store.restoreBackup(runId, f.path, dir)) restored.push(f.path);
        else failed.push({ path: f.path, reason: 'no hay copia' });
      } catch (e) {
        failed.push({ path: f.path, reason: e instanceof Error ? e.message : String(e) });
      }
    }
    return { restored, removed, failed };
  };
}

/** Orquestador del proyecto con el motor de Claude y el de demostración [R27.1][R56.5]. */
export function composeOrchestrator(ctx: OrchestratorContext, query: QueryFn): Orchestrator {
  return createEngineOrchestrator({ library: libraryOf(ctx), settings: ctx.settings, restoreFiles: restoreAttemptFiles(ctx.store, ctx.projectRoot), spaces: branchSpacesFor(ctx) }, [createClaudeEngine(claudeEnvironment(ctx), query)]);
}

/** Puertos del servicio de ejecución para un proyecto [R56.5]. */
export function composeRunPorts(store: ProjectStore): RunPorts {
  return { runs: runRepositoryOf(store), library: libraryReaderOf(store), policy: claudePathPolicy, files: workspaceFiles, stepDir: stepSpaceDir };
}

/** Biblioteca del proyecto sin copias, para listar trabajos [R52.4]. */
export const composeLibrary = (store: ProjectStore): LibraryReader => libraryReaderOf(store);

/** Al arrancar la app: borra los espacios de un cierre inesperado y lo que git recuerda de ellos [R73.18]. */
export const cleanupSpaces = (spacesRoot: string, roots: readonly string[]): Promise<number> => cleanupBranchSpaces(spacesRoot, roots).catch(() => 0);
