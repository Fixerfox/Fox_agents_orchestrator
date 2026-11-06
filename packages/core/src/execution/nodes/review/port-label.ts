/** Etiqueta de la salida de una revisión. */
export const portLabel = (verdict: 'approved' | 'rejected' | 'exhausted'): string => (verdict === 'approved' ? 'Aprobado' : verdict === 'rejected' ? 'Rechazado' : 'Agotado');
