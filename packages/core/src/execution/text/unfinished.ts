/** Opciones de un paso que no terminó lo pedido [R62.4]. */
export const UNFINISHED_RETRY = 'Repetir el paso';
export const UNFINISHED_CONTINUE = 'Seguir igualmente';
export const UNFINISHED_STOP = 'Parar la ejecución';
export const UNFINISHED_OPTIONS = [UNFINISHED_RETRY, UNFINISHED_CONTINUE, UNFINISHED_STOP];

/** Motivo con el que acaba una ejecución que no consiguió lo pedido [R62.10]. */
export const REQUIREMENTS_UNMET = 'No cumple lo pedido';

export const unfinishedQuestion = (missing: string): string => `El Supervisor cree que este paso no ha terminado lo pedido: ${missing}\n\n¿Qué hacemos? También puedes escribirle qué hacer.`;

const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.toLowerCase();

/** Qué decidió la persona; cualquier otro texto es una instrucción para repetir [R62.5]. */
export function unfinishedDecision(reply: string, missing: string): { action: 'continue' | 'stop' } | { action: 'retry'; request: string } {
  if (same(reply, UNFINISHED_CONTINUE)) return { action: 'continue' };
  if (same(reply, UNFINISHED_STOP)) return { action: 'stop' };
  return { action: 'retry', request: same(reply, UNFINISHED_RETRY) ? `Termina lo que faltaba: ${missing}` : reply.trim() };
}
