import path from 'node:path';
import type { LibraryReader, RunRepository } from '@orquestador/core';
import type { ProjectStore } from './project';
import { MAX_INPUT_FILES } from './project-files';
import { findPreview, snapshotStep } from './previews';
import { dismissInterruptedRun, listRuns, markCorrectedBy, markResumedBy, readRunDiagram, readRunLog, startLoggedRun } from './run-log';

/** El proyecto como `RunRepository` [R56.5]. */
export function runRepositoryOf(store: ProjectStore): RunRepository {
  const dir = (runId: string) => store.paths.runDir(runId);
  return {
    maxInputFiles: MAX_INPUT_FILES,
    start: (orchestrator, diagram, order, options) => startLoggedRun(orchestrator, store, diagram, order, options),
    list: (opts) => listRuns(store.paths.runsDir, opts),
    readEvents: async (runId) => (await readRunLog(dir(runId))).events,
    readDiagram: (runId) => readRunDiagram(dir(runId)),
    markResumedBy: (runId, by) => markResumedBy(dir(runId), by),
    markCorrectedBy: (runId, by) => markCorrectedBy(dir(runId), by),
    dismissInterrupted: (runId) => dismissInterruptedRun(dir(runId)),
    snapshotStep: ({ runId, ...args }) => snapshotStep({ runDir: dir(runId), ...args }),
    findPreview: (runId, key, rel) => findPreview(dir(runId), key, rel),
    outputFolder: (runId) => path.join(dir(runId), 'output'),
    workRoot: async () => (await store.getWorkFolder()) ?? store.paths.root,
    inputFiles: (rels) => store.inputFiles(rels),
    attachmentInputPath: (id) => store.attachmentInputPath(id),
  };
}

/** El proyecto como `LibraryReader`: siempre lo que hay en disco [R56.5]. */
export function libraryReaderOf(store: ProjectStore): LibraryReader {
  return {
    agents: () => store.listAgents(),
    contexts: () => store.listContexts(),
    skills: () => store.listSkills(),
    mcp: () => store.listMcp(),
    diagram: (id) => store.diagrams.load(id),
    diagramIds: () => store.diagrams.list(),
  };
}
