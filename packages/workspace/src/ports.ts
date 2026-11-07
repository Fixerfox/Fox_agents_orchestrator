import type { WorkspaceFiles } from '@orquestador/core';
import { manifestOf, resolveInside } from './files';

/** Archivos reales del disco como `WorkspaceFiles` [R56.5]. */
export const workspaceFiles: WorkspaceFiles = { manifestOf, resolveInside };
