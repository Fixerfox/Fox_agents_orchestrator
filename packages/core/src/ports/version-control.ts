import type { GitState } from '../execution';

/** Git de la carpeta del proyecto: lo mínimo para preparar la rama de una ejecución [R97.1]. */
export interface VersionControl {
  state(): Promise<GitState>;
  /** Crea `name` desde `from` (por defecto, `HEAD`) y se cambia a ella; los cambios sin commit van con ella. */
  createBranch(name: string, from?: string): Promise<void>;
  /** Aparta los cambios sin commit (también los archivos nuevos) con esa etiqueta; `false` si no había nada. */
  stash(label: string): Promise<boolean>;
}
