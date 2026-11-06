import type { Payload } from '../shared';

/** Criterio que usa la IA cuando la revisión no tiene uno propio [R34.6]. */
export const DEFAULT_REVIEW_CRITERIA =
  'La entrega cumple todo lo pedido y el revisor no deja correcciones pendientes.';

/** Largo máximo de cada corrección anterior en el contexto de la vuelta siguiente [R34.11]. */
export const PREVIOUS_FEEDBACK_CLIP = 600;

const VERDICT_RE = /\b(?:VEREDICTO|VERDICT)\s*[:：]\s*[*_`"«]*\s*(APROBAD[OA]|RECHAZAD[OA]|APPROVED|REJECTED)/gi;

/** Último veredicto escrito por el revisor, o `undefined` si no hay [R34.6]. */
export function parseVerdict(text: string): 'approved' | 'rejected' | undefined {
  let last: string | undefined;
  for (const m of text.matchAll(VERDICT_RE)) last = m[1]!.toUpperCase();
  if (last === undefined) return undefined;
  return last.startsWith('APROBAD') || last === 'APPROVED' ? 'approved' : 'rejected';
}

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n)}…` : s);

/** Entrada del destino en la vuelta `round` (≥ 2) [R34.11]. */
export function composeRoundInput(args: {
  round: number;
  max: number;
  original: Payload;
  previous?: Payload | undefined;
  feedback: Payload;
  /** Correcciones de vueltas anteriores a la última, de la más antigua a la más reciente. */
  earlier: readonly string[];
  /** Las correcciones las pidió el usuario en una revisión humana [R53.6]. */
  human?: boolean;
}): Payload {
  const { round, max, original, previous, feedback, earlier } = args;
  const parts = [
    original.text,
    '---',
    `## ${args.human ? 'Revisión humana' : 'Revisión'} · vuelta ${round} de ${max}`,
    args.human
      ? 'El usuario revisó la entrega anterior y pide cambios. Corrige lo que se indica y entrega de nuevo el trabajo completo.'
      : 'La revisión rechazó la entrega anterior. Corrige lo que se indica y entrega de nuevo el trabajo completo.',
  ];
  if (previous) parts.push('### Tu entrega anterior', previous.text);
  parts.push('### Correcciones pedidas', feedback.text);
  if (earlier.length > 0) {
    parts.push(
      '### Correcciones de vueltas anteriores',
      earlier.map((f, i) => `- Vuelta ${i + 1}: ${clip(f.trim(), PREVIOUS_FEEDBACK_CLIP)}`).join('\n'),
    );
  }
  const files = [...new Set([...original.files, ...(previous?.files ?? []), ...feedback.files])];
  return { text: parts.join('\n\n'), files };
}
