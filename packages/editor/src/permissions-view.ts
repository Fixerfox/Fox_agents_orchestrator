import type { ProjectPermission } from '@orquestador/core';

/** Qué hace un agente ante una acción: sin preguntar, preguntando o nunca [R67.6]. */
export type PermAnswer = 'yes' | 'ask' | 'no';
export type PermAction = 'read' | 'create' | 'modify' | 'simple' | 'commands' | 'delete' | 'publish' | 'outsideCmd' | 'outsideWrite';

/** Los niveles del proyecto, de más prudente a menos [R47.8]. */
export const PROJECT_LEVELS: readonly ProjectPermission[] = ['ask', 'auto', 'full'];

const Y: PermAnswer = 'yes';
const A: PermAnswer = 'ask';
const N: PermAnswer = 'no';

/**
 * Tabla «lo que pasará con cada nivel», tal como la aplica el motor (SPEC-031, SPEC-047, SPEC-051):
 * en «Preguntar» solo los comandos sencillos van sin preguntar; «Automático» pregunta borrar, publicar
 * y salir de la carpeta; ninguno de los dos escribe fuera; «Sin preguntar nunca» lo hace todo [R67.6].
 */
export function permissionMatrix(): { action: PermAction; answers: Record<ProjectPermission, PermAnswer> }[] {
  const row = (action: PermAction, ask: PermAnswer, auto: PermAnswer, full: PermAnswer) => ({ action, answers: { ask, auto, full } });
  return [
    row('read', Y, Y, Y),
    row('create', Y, Y, Y),
    row('modify', A, Y, Y),
    row('simple', Y, Y, Y),
    row('commands', A, Y, Y),
    row('delete', A, A, Y),
    row('publish', A, A, Y),
    row('outsideCmd', A, A, Y),
    row('outsideWrite', N, N, Y),
  ];
}
