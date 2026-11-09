import { randomUUID } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import { basename, join } from 'node:path';
import { summarizeFolder } from '@orquestador/claude';
import { analyzeImport, defaultSettings, folderLabel, type RecentView } from '@orquestador/core';
import { CHANNELS, installSpecKitInto, type ProjectInfo, type SpecKitTarget, type TerminalStartRequest } from '@orquestador/editor';
import { RunService, RunSnapshots, runDefaultsFrom } from '@orquestador/runtime';
import { StoreError, readFolder, type ProjectStore } from '@orquestador/store';
import { composeRunPorts, createProject, openProject } from '../composition';
import { UNHANDLED, disposeHandlers, mcpVaultKey, requireStore, type HandlerState } from './state';

/** Documentos guía de la raíz de la carpeta del proyecto que se ofrecen como contexto común [R32.16]. */
const GUIDE_DOCS = ['CLAUDE.md', 'TRABAJO.md', 'AGENTS.md'] as const;
const DOC_MAX = 20_000;
const isDir = async (p: string) => fsp.stat(p).then((s) => s.isDirectory(), () => false);
/** Lee un archivo de texto si existe; lo recorta a `max` caracteres. */
async function readSmall(p: string, max: number): Promise<string | undefined> {
  try {
    const st = await fsp.stat(p);
    if (!st.isFile()) return undefined;
    const text = (await fsp.readFile(p, 'utf8')).replace(/^\uFEFF/, '');
    return text.length > max ? `${text.slice(0, max)}\n…` : text;
  } catch {
    return undefined;
  }
}

async function setProject(h: HandlerState, root: string, store: ProjectStore): Promise<ProjectInfo> {
  disposeHandlers(h);
  h.pending = undefined;
  h.settings = (await h.deps.settings?.load()) ?? defaultSettings();
  // Copias de lo que usa cada ejecución, compartidas por el motor y el servicio [R52.1].
  const snapshots = new RunSnapshots();
  h.runs = new RunService(composeRunPorts(store), h.deps.createOrchestrator({
      store,
      snapshots,
      projectRoot: root,
      settings: () => h.settings,
      apiKey: async () => (await h.deps.vault?.read()),
      mcpSecrets: async (id, scope) => (await h.deps.mcpVault?.read(mcpVaultKey(root, id, scope))) ?? {},
    }), () => runDefaultsFrom(h.settings), snapshots);
  h.runs.watch((event, diagram) => h.deps.watchRun?.(event, diagram));
  h.runs.onMemoryProposals((n) => h.deps.memoryProposals?.(n));
  // Las interrumpidas recientes se ofrecen para reanudar; nada se reanuda solo [R74.12].
  const runs = h.runs;
  void runs
    .interruptedRecent()
    .then((list) => h.deps.offerInterrupted?.(list, { resume: (id) => runs.resumeRun(id), dismiss: (id) => runs.dismiss(id) }))
    .catch(() => undefined);
  store.useAppMcp(h.deps.appMcpDir);
  h.store = store; // como máximo un proyecto abierto: el anterior se sustituye [R19.5]
  h.root = root;
  const name = (await store.info()).name;
  await h.deps.recents?.touch(root, name).catch(() => undefined); // un fallo al recordar no impide abrir [R28.2]
  return { name };
}

/** El almacén del proyecto como destino de la instalación de Spec Kit [R38.15]. */
export function specKitTarget(store: ProjectStore): SpecKitTarget {
  return {
    skillIds: () => store.listSkillIds(),
    agentIds: async () => (await store.listAgents()).map((a) => a.id),
    saveSkill: (k) => store.saveSkill(k),
    saveSkillFile: (id, path, text) => store.writeSkillFile(id, path, new TextEncoder().encode(text)),
    saveAgent: (a) => store.saveAgent(a),
    getFolders: () => store.getLibraryFolders(),
    saveFolders: async (f) => void (await store.saveLibraryFolders(f)),
  };
}

export async function handleProject(h: HandlerState, channel: string, arg: unknown): Promise<unknown> {
  switch (channel) {
    case CHANNELS.currentProject:
      return h.store ? { name: (await h.store.info()).name } : null;
    case CHANNELS.createProject: {
      const root = await h.deps.pickFolder('create');
      if (!root) return null;
      const created = await createProject(root, { name: basename(root) || 'Proyecto' });
      // Los proyectos nuevos traen Spec Kit preinstalado (skills y agentes en la carpeta «Spec Kit») [R38.15].
      if (h.deps.preinstallSpecKit) await installSpecKitInto(specKitTarget(created)).catch(() => undefined);
      return setProject(h, root, created);
    }
    case CHANNELS.openProject: {
      const root = await h.deps.pickFolder('open');
      if (!root) return null;
      return setProject(h, root, await openProject(root));
    }
    case CHANNELS.listRecent: {
      const out: RecentView[] = [];
      for (const r of (await h.deps.recents?.list()) ?? []) {
        const missing = !(await fsp.stat(join(r.root, '.orquestador')).then((s) => s.isDirectory(), () => false));
        out.push({ id: r.id, name: r.name, folder: folderLabel(r.root), openedAt: r.openedAt, missing });
      }
      return out;
    }
    case CHANNELS.openRecent: {
      const entry = await h.deps.recents?.find((arg as { id: string }).id);
      if (!entry) throw new StoreError('not-found', 'Ese proyecto ya no está en la lista');
      const gone = new StoreError('not-found', 'La carpeta del proyecto ya no existe o no es un proyecto. Puedes quitarlo de la lista.');
      const store = await openProject(entry.root).catch(() => {
        throw gone;
      });
      return setProject(h, entry.root, store);
    }
    case CHANNELS.forgetRecent:
      return (await h.deps.recents?.forget(arg as string)) ?? false;
    case CHANNELS.closeProject: {
      h.runs?.cancelAll();
      disposeHandlers(h);
      h.pending = undefined;
      h.runs = undefined;
      h.store = undefined;
      h.root = undefined;
      return null;
    }
    case CHANNELS.terminalStart: {
      if (!h.deps.terminals) throw new StoreError('unavailable', 'La terminal no está disponible');
      const root = h.root;
      if (!root) throw new StoreError('not-found', 'Abre un proyecto para usar la terminal');
      return h.deps.terminals.start(root, arg as TerminalStartRequest); // siempre en la carpeta del proyecto [R30.13]
    }
    case CHANNELS.terminalWrite: {
      const { id, data } = arg as { id: string; data: string };
      return h.deps.terminals?.write(id, data) ?? false;
    }
    case CHANNELS.terminalResize: {
      const { id, cols, rows } = arg as { id: string; cols: number; rows: number };
      return h.deps.terminals?.resize(id, cols, rows) ?? false;
    }
    case CHANNELS.terminalKill:
      return h.deps.terminals?.kill(arg as string) ?? false;
    case CHANNELS.getWorkFolder: {
      const folder = await requireStore(h).getWorkFolder();
      if (!folder) return null;
      const s = await summarizeFolder(folder);
      return { name: s.name, files: s.files };
    }
    case CHANNELS.pickWorkFolder: {
      const store = requireStore(h);
      const picked = await h.deps.pickFolder('work');
      if (!picked) return null;
      await store.setWorkFolder(picked);
      const s = await summarizeFolder(picked);
      return { name: s.name, files: s.files };
    }
    case CHANNELS.clearWorkFolder:
      await requireStore(h).setWorkFolder(null);
      return null;
    case CHANNELS.inspectWorkFolder: {
      const store = requireStore(h);
      const folder = await store.getWorkFolder();
      if (!folder) throw new StoreError('not-found', 'Elige primero la carpeta del proyecto');
      h.pending = undefined;
      const files = (await isDir(join(folder, '.claude'))) ? (await readFolder(join(folder, '.claude'))).files : [];
      const mcp = await readSmall(join(folder, '.mcp.json'), 200_000);
      if (mcp !== undefined) files.push({ path: '.mcp.json', data: new TextEncoder().encode(mcp) });
      const plan = analyzeImport({ files }, { agentIds: new Set((await store.listAgents()).map((a) => a.id)), skillIds: new Set(await store.listSkillIds()) });
      h.pending = { id: randomUUID(), plan };
      const s = await summarizeFolder(folder);
      const docs: { name: string; text: string }[] = [];
      for (const name of GUIDE_DOCS) {
        const text = await readSmall(join(folder, name), DOC_MAX);
        if (text !== undefined && text.trim() !== '') docs.push({ name, text });
      }
      return { importId: h.pending.id, report: plan.report, folder: { name: s.name, files: s.files }, summary: s.text, docs };
    }
    default:
      return UNHANDLED;
  }
}
