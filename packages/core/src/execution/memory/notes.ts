/** Encabezado de la nota para los siguientes; distinto de `## Para <id>` del reparto [R72.11]. */
export const NOTE_HEADING = '## Notas para los siguientes pasos';
/** Tope de una nota [R72.12]. */
export const NOTE_MAX = 1200;

const HEADING = /^##\s+notas\s+para\s+los\s+siguientes\s+pasos\s*$/i;
const ANY_HEADING = /^##\s+\S/;
const FENCE = /^\s*(```|~~~)/;

/**
 * Separa de la salida la sección «Notas para los siguientes pasos» [R72.11]: lo que hay hasta el siguiente encabezado
 * `##` o el final. Fuera de bloques de código; si hay varias, vale la última.
 */
export function splitNote(text: string): { text: string; note?: string } {
  const lines = text.split('\n');
  let fenced = false;
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (FENCE.test(lines[i]!)) fenced = !fenced;
    if (!fenced && HEADING.test(lines[i]!.trim())) start = i;
  }
  if (start < 0) return { text };
  let end = lines.length;
  fenced = false;
  for (let i = start + 1; i < lines.length; i++) {
    if (FENCE.test(lines[i]!)) fenced = !fenced;
    if (!fenced && ANY_HEADING.test(lines[i]!)) {
      end = i;
      break;
    }
  }
  const note = lines.slice(start + 1, end).join('\n').trim();
  const rest = [...lines.slice(0, start), ...lines.slice(end)].join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return note === '' ? { text: rest } : { text: rest, note };
}

/** Lo que el prompt de sistema le explica a todo agente sobre la nota [R72.13]. */
export const NOTE_RULE = `Si los pasos que vienen después deben saber algo que no está en tu entrega (algo que dejaste a medias a propósito, una decisión que tomaste, un riesgo), termina tu respuesta con la sección «${NOTE_HEADING}» y como mucho 5 líneas. No es para repetir la entrega. Esa sección no llega como entrega: la reciben los pasos siguientes en su memoria. Si no hay nada que contar, no la escribas.`;
