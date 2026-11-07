/** Lo que el servicio de ejecución necesita de los archivos del espacio de trabajo [R56.3]. */
export interface WorkspaceFiles {
  /** Archivos bajo `root`, por ruta relativa. `ignore`: carpetas que no se recorren. */
  manifestOf(root: string, ignore: readonly string[]): Promise<ReadonlyMap<string, { size: number }>>;
  /** Ruta absoluta de `rel` dentro de `root`; lanza si se sale. */
  resolveInside(root: string, rel: string): string;
}
