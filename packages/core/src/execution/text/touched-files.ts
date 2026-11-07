import type { FileChange } from '../adapter';

const norm = (p: string) => p.replace(/\\/g, '/');
const CHANGE_LABEL: Record<FileChange, string> = { created: 'creado', modified: 'modificado' };

/**
 * La salida de un agente explica todo lo que ha tocado [R31.13]: si el texto no menciona algún archivo
 * registrado, se añade al final la lista de los que faltan.
 */
export function explainTouchedFiles(text: string, files: ReadonlyMap<string, FileChange | undefined>): string {
  const said = norm(text);
  const missing = [...files].filter(([p]) => !said.includes(norm(p)));
  if (missing.length === 0) return text;
  const lines = missing.map(([p, c]) => `- ${p}${c ? ` (${CHANGE_LABEL[c]})` : ''}`);
  return `${text.trimEnd()}${text.trim() ? '\n\n' : ''}Archivos tocados (registrados por el orquestador):\n${lines.join('\n')}`;
}
