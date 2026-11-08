/** Desde cuántos caracteres o líneas una pregunta se responde en un modal [R78.1]. */
export const LONG_QUESTION_CHARS = 600;
export const LONG_QUESTION_LINES = 8;

/** ¿Se responde en un modal? Confirmaciones, revisiones humanas y preguntas largas [R78.1]. */
export function questionNeedsModal(q: { text: string; confirm?: unknown; review?: unknown }): boolean {
  if (q.confirm !== undefined || q.review !== undefined) return true;
  return q.text.length > LONG_QUESTION_CHARS || q.text.split('\n').length > LONG_QUESTION_LINES;
}

/** El principio del texto, sin Markdown, para la línea compacta [R78.2]. */
export function questionPreview(text: string, max = 160): string {
  const plain = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|[-*+]|\d+\.|>)\s+/gm, '')
    .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > max ? `${plain.slice(0, max - 1).trimEnd()}…` : plain;
}
