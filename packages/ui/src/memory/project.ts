import { analyzeImport, type RecentView } from '@orquestador/core';
import { fail, ok, type TerminalEvent } from '@orquestador/editor';
import { res } from './state';
import type { MemoryApi, MemoryApiOptions, MemoryState } from './types';

/** Proyecto: abrir y cerrar, recientes, carpeta de trabajo y terminal simulada. */
export function memoryProject(s: MemoryState, options: MemoryApiOptions) {
  const { agents, skills } = s;
  const workFolder: { name: string; files: number; separate?: boolean } = { ...(options.workFolder ?? { name: 'proyecto', files: 0 }) };
  let gitIgnore = { ...(options.gitIgnore ?? { available: false, exists: false, mode: 'shared' as const }) };
  let recent: RecentView[] = (options.recent ?? []).map((r) => ({ ...r }));
  const terminals: MemoryApi['terminals'] = new Map();
  const terminalListeners = new Set<(id: string, event: TerminalEvent) => void>();
  let termSeq = 0;
  let trust: 'trusted' | 'ignored' | null = null;
  const termEmit = (id: string, event: TerminalEvent) => {
    for (const l of terminalListeners) l(id, event);
  };

  return {
    terminals,
    terminalOutput: (id, data) => termEmit(id, { type: 'data', data }),
    async terminalStart(req) {
      if (!s.open) return fail('not-found', 'Abre un proyecto para usar la terminal');
      if (options.terminal?.fail) return fail('unavailable', 'No se pudo abrir ninguna terminal en este equipo');
      if ([...terminals.values()].filter((t) => t.alive).length >= 3) return fail('limit', 'Como mucho 3 terminales abiertas: cierra alguna');
      const id = `term-${++termSeq}`;
      if (options.terminal?.external) return ok({ id, external: true });
      terminals.set(id, { program: req.program, ...(req.prompt ? { prompt: req.prompt } : {}), written: '', alive: true });
      queueMicrotask(() => termEmit(id, { type: 'data', data: req.program === 'claude' ? 'Claude Code (simulado)\r\n> ' : '$ ' }));
      return ok({ id, external: false });
    },
    async terminalWrite({ id, data }) {
      const t = terminals.get(id);
      if (!t?.alive) return ok(false);
      t.written += data;
      return ok(true);
    },
    async terminalResize({ id }) {
      return ok(terminals.get(id)?.alive === true);
    },
    async terminalKill(id) {
      const t = terminals.get(id);
      if (!t?.alive) return ok(false);
      t.alive = false;
      termEmit(id, { type: 'exit', code: 0 });
      return ok(true);
    },
    currentProject: async () => ok(null),
    projectTrust: async () => ok({ items: s.open ? structuredClone(options.trustItems ?? []) : [], decision: (options.trustItems ?? []).length > 0 ? trust : null }),
    async setProjectTrust(decision) {
      if (!s.open) return fail('not-found', 'No hay un proyecto abierto');
      trust = decision;
      return ok(null);
    },
    onTerminalEvents(listener) {
      terminalListeners.add(listener);
      return () => void terminalListeners.delete(listener);
    },
    createProject: () => ((s.open = true), res({ name: 'Proyecto de prueba' })),
    openProject: () => ((s.open = true), res({ name: 'Proyecto de prueba' })),
    async listRecent() {
      return ok(recent.map((r) => ({ ...r })));
    },
    async openRecent({ id }) {
      const r = recent.find((x) => x.id === id);
      if (!r) return fail('not-found', 'Ese proyecto ya no está en la lista');
      if (r.missing) return fail('not-found', 'La carpeta del proyecto ya no existe o no es un proyecto. Puedes quitarlo de la lista.');
      s.open = true;
      return ok({ name: r.name });
    },
    async forgetRecent(id) {
      const before = recent.length;
      recent = recent.filter((r) => r.id !== id);
      return ok(recent.length !== before);
    },
    async closeProject() {
      s.open = false;
      return ok(null);
    },
    async getWorkFolder() {
      if (!s.open) return fail('not-found', 'Abre un proyecto');
      return ok({ ...workFolder });
    },
    async joinWorkFolder() {
      if (!s.open) return fail('not-found', 'Abre un proyecto');
      if (!workFolder.separate) return fail('invalid', 'Este proyecto ya trabaja en su propia carpeta: no hay nada que unir');
      if (options.joinError) return fail('exists', options.joinError);
      delete workFolder.separate;
      return ok({ name: workFolder.name });
    },
    async getGitIgnore() {
      if (!s.open) return fail('not-found', 'Abre un proyecto');
      return ok({ ...gitIgnore });
    },
    async setGitIgnore(mode) {
      if (!s.open) return fail('not-found', 'Abre un proyecto');
      gitIgnore = { ...gitIgnore, mode, exists: gitIgnore.exists || mode === 'all' };
      return ok({ ...gitIgnore });
    },
    async inspectWorkFolder() {
      if (!s.open) return fail('not-found', 'Abre un proyecto');
      const tree = options.workFolderTree ?? { files: [], summary: `${workFolder.name}/`, docs: [] };
      const plan = analyzeImport({ files: tree.files }, { agentIds: new Set(agents.keys()), skillIds: new Set(skills.keys()) });
      s.pending = { id: `import-${++s.importCount}`, plan };
      return ok({ importId: s.pending.id, report: plan.report, folder: { ...workFolder }, summary: tree.summary, docs: tree.docs.map((d) => ({ ...d })) });
    },
  } satisfies Partial<MemoryApi>;
}
