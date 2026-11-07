/** Qué rutas relativas a la carpeta de trabajo se pueden enseñar [R56.3]. */
export interface PathPolicy {
  /** Secretos: nunca se copian ni se enseñan [R29.8]. */
  isSensitive(rel: string): boolean;
  /** Ruta válida, dentro de la carpeta, fuera de las internas y sin secretos [R54.4]. */
  isPreviewable(rel: string): boolean;
}
