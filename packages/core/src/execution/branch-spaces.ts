/** Espacio de una rama aislada; la ruta solo la usan el motor y el adaptador, nunca los eventos [R73.7]. */
export interface SpaceRef {
  id: string;
  dir: string;
}

/** Cómo quedó una fusión [R73.12]. */
export interface SpaceMerge {
  /** Archivos llevados al destino (copiados, borrados o fusionados por líneas). */
  merged: string[];
  /** De ellos, los que se juntaron a tres bandas por líneas. */
  mergedByLines: string[];
  /** Archivos que cambiaron los dos y no se pudieron juntar; el destino no se toca. */
  conflicts: string[];
  /** Dónde quedaron las dos versiones, relativo a la carpeta de la ejecución [R73.16]. */
  savedTo?: string;
}

/** Qué hacer con los archivos en conflicto [R73.14]. */
export type ConflictChoice = 'target' | 'branch' | 'markers';

/**
 * Espacios de las ramas en paralelo de una ejecución [R73.2]–[R73.18]: los abre a partir de la carpeta de trabajo (o
 * del espacio que contiene la rama), los fusiona en orden de llegada y los borra.
 */
export interface BranchSpaces {
  open(o: { regionId: string; label: string; parent?: SpaceRef }): Promise<{ space: SpaceRef; strategy: 'git' | 'copy'; warning?: string }>;
  merge(space: SpaceRef, into?: SpaceRef): Promise<SpaceMerge>;
  /** Resuelve los conflictos de la última fusión de `space` [R73.14][R73.15]. */
  resolve(space: SpaceRef, into: SpaceRef | undefined, choice: ConflictChoice): Promise<void>;
  /** Archivos que aún tienen marcas de conflicto en el destino. */
  unresolved(space: SpaceRef, into?: SpaceRef): Promise<string[]>;
  /** Guarda lo cambiado en `discarded/<rama>/` y borra el espacio [R73.17]. Devuelve los archivos guardados. */
  discard(space: SpaceRef): Promise<string[]>;
  close(space: SpaceRef): Promise<void>;
  closeAll(): Promise<void>;
  /** El paso `stepKey` trabaja en `space`: su vista previa en marcha lee de ahí [R73.19]. */
  bind?(space: SpaceRef, stepKey: string): void;
}
