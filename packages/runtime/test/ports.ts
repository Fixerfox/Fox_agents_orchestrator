import { claudePathPolicy } from '@orquestador/claude';
import { libraryReaderOf, runRepositoryOf, type ProjectStore } from '@orquestador/store';
import { workspaceFiles } from '@orquestador/workspace';
import type { RunPorts } from '../src';

/** Los adaptadores reales de un proyecto, como los conecta `composition.ts`. */
export const portsOf = (store: ProjectStore): RunPorts => ({ runs: runRepositoryOf(store), library: libraryReaderOf(store), policy: claudePathPolicy, files: workspaceFiles });
