import type { GitBranchInfo, GitCommit, GitFileChange, GitStash, GitState } from '../execution';

/** Lo mínimo de git para preparar la rama de una ejecución [R97.1]. */
export interface BranchGuardPort {
  state(): Promise<GitState>;
  /** Crea `name` desde `from` (por defecto, `HEAD`) y se cambia a ella; los cambios sin commit van con ella. */
  createBranch(name: string, from?: string): Promise<void>;
  /** Aparta los cambios sin commit (también los archivos nuevos) con esa etiqueta; `false` si no había nada. */
  stash(label: string): Promise<boolean>;
}

/** Git de la carpeta del proyecto: la guarda y el visor de control de versiones [R98.1]. */
export interface VersionControl extends BranchGuardPort {
  /** Ramas locales y remotas, con lo que llevan de adelanto y retraso. */
  branches(): Promise<GitBranchInfo[]>;
  /** Últimos commits de todas las ramas, del más nuevo al más viejo. */
  history(limit: number): Promise<GitCommit[]>;
  /** Archivos con cambios sin commit. */
  changes(): Promise<GitFileChange[]>;
  /** Diferencia de un archivo con el último commit, en formato unificado y con tope de tamaño. */
  diff(file: string): Promise<string>;
  stashes(): Promise<GitStash[]>;
  /** Commits que hay en `to` y no en `from`. */
  range(from: string, to: string): Promise<string[]>;
  switchBranch(name: string): Promise<void>;
  /** Guarda todos los cambios en un commit y devuelve su hash abreviado. */
  commit(message: string): Promise<string>;
  /** Sube la rama actual a `origin`, enlazándola si es la primera vez. */
  push(): Promise<void>;
  /** Trae la rama actual sin crear commits de fusión. */
  pull(): Promise<void>;
  fetch(): Promise<void>;
  /** Fusiona esa rama en la actual; con conflictos lo deshace y falla. */
  merge(name: string): Promise<void>;
  /** Borra una rama local ya fusionada. */
  deleteBranch(name: string): Promise<void>;
  stashPop(index: number): Promise<void>;
}
