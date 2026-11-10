import type { LoopConfig } from '../../diagrams';

/** Lo que un agente sabe de un bucle que lo contiene [R84.1]. */
export interface LoopFrame {
  label: string;
  round: number;
  max: number;
  mode: LoopConfig['mode'];
  /** Condición del evaluador, solo en modo `ai-judge`. */
  criterion?: string;
  /** Texto con el que empezó el bucle (la entrada de la vuelta 1). */
  request: string;
  /** Por qué el evaluador dijo «aún no» en la vuelta anterior. */
  lastReason?: string;
}

export const LOOP_HEADING = '## Estás dentro de un bucle';
export const LOOP_REQUEST_MAX = 4000;
export const LOOP_REASON_MAX = 1000;
export const LOOP_REFINE = 'Tu entrada es el resultado de la vuelta anterior: mejóralo, no empieces de cero.';

const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

/**
 * Bloque «Estás dentro de un bucle» para un agente del cuerpo, de fuera a dentro [R84.1]. La petición de un marco
 * se omite si es justo la entrada del paso [R84.2].
 */
export function loopContext(frames: readonly LoopFrame[], inputText?: string): string | undefined {
  if (frames.length === 0) return undefined;
  const input = inputText?.trim();
  const parts = frames.map((f) => {
    const lines = [`Bucle «${f.label}»: vuelta ${f.round} de ${f.max}${f.mode === 'ai-judge' ? ' como máximo' : ''}.`];
    if (f.mode === 'ai-judge' && f.criterion?.trim()) lines.push(`Termina cuando un evaluador confirme: ${f.criterion.trim()}`);
    const request = f.request.trim();
    if (request && request !== input) lines.push(`Petición con la que empezó el bucle:\n${cut(request, LOOP_REQUEST_MAX)}`);
    if (f.round > 1) {
      lines.push(LOOP_REFINE);
      if (f.lastReason?.trim()) lines.push(`En la vuelta anterior el evaluador dijo que aún no basta: ${cut(f.lastReason.trim(), LOOP_REASON_MAX)}`);
    }
    return lines.join('\n');
  });
  return [LOOP_HEADING, ...parts].join('\n\n');
}

/** Marcos de los bucles que contienen un paso, de fuera a dentro, según su ruta [R84.4]. */
export function framesFor(loops: ReadonlyMap<string, LoopFrame> | undefined, path: readonly string[]): LoopFrame[] {
  if (!loops || loops.size === 0) return [];
  const out: LoopFrame[] = [];
  for (let i = 1; i <= path.length; i++) {
    const f = loops.get(path.slice(0, i).join('/'));
    if (f) out.push(f);
  }
  return out;
}
