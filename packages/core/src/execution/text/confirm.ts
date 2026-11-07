import type { Payload } from '../../shared';

/** Respuesta que aprueba una confirmación [R43.6]. */
export const CONFIRM_APPROVE = 'Aprobar';
export const CONFIRM_QUESTION = '¿Apruebas lo que has hecho o quieres cambios?';
export const isApproval = (answer: string): boolean => answer.trim().toLowerCase() === CONFIRM_APPROVE.toLowerCase();

/** Entrada de la vuelta siguiente tras pedir cambios en una confirmación [R43.7]. */
export function composeConfirmInput(args: { round: number; original: Payload; previous: Payload; request: string }): Payload {
  const text = [
    args.original.text,
    `## Cambios pedidos antes de confirmar (vuelta ${args.round})`,
    `### Tu entrega anterior\n\n${args.previous.text}`,
    `### Lo que pide el usuario\n\n${args.request}`,
  ].join('\n\n');
  return { text, files: [...new Set([...args.original.files, ...args.previous.files])] };
}
