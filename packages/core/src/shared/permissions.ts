/**
 * Niveles de permisos [R47.8]: solo lectura (solo para un agente), preguntar, automático (solo pregunta lo
 * delicado: borrar, salir de la carpeta, publicar fuera) y sin preguntar nunca.
 */
export const PERMISSION_LEVELS = ['readonly', 'ask', 'auto', 'full'] as const;

export type PermissionLevel = (typeof PERMISSION_LEVELS)[number];

export const PROJECT_PERMISSIONS = ['ask', 'auto', 'full'] as const;

export type ProjectPermission = (typeof PROJECT_PERMISSIONS)[number];

/** Por defecto no se pregunta nada [R51.1]. */
export const DEFAULT_PERMISSION: ProjectPermission = 'full';
