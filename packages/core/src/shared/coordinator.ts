import type { Id } from './types';

/** Agente fijo de la app que reparte el trabajo; ninguno del usuario lo sustituye [R59.19]. */
export const COORDINATOR_ID: Id = 'orq-coordinador';

/** Reparte el Coordinador y solo él [R59.1]. */
export const isCoordinator = (node: { agentId?: Id | undefined }): boolean => node.agentId === COORDINATOR_ID;
