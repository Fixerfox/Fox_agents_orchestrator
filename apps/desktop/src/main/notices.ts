import { REQUIREMENTS_UNMET, type Diagram, type RunEvent } from '@orquestador/core';

/** Lo que dice un aviso del sistema y a qué ejecución lleva [R61.7][R61.8]. */
export interface Notice {
  title: string;
  body: string;
  runId: string;
  live: boolean;
}

/** Los avisos se ven enteros en unas dos líneas; el resto está en la app [R61.7]. */
const MAX_BODY = 160;

const cut = (text: string): string => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > MAX_BODY ? `${flat.slice(0, MAX_BODY - 1).trimEnd()}…` : flat;
};

/** Quién pregunta: el paso, o el subdiagrama que lo contiene si está dentro de uno. */
function whoAsks(event: Extract<RunEvent, { type: 'agent.question' }>, diagram: Diagram): string {
  const id = event.nodePath?.[0] ?? event.nodeId;
  const node = diagram.nodes.find((n) => n.id === id);
  return node?.label ?? (node?.kind === 'agent' ? node.agentId : undefined) ?? 'Un agente';
}

function questionTitle(event: Extract<RunEvent, { type: 'agent.question' }>, who: string): string {
  if (event.review) return `${who} espera tu revisión`;
  if (event.confirm) return `${who} espera tu confirmación`;
  if (event.kind === 'unfinished') return `${who} no ha terminado lo pedido`;
  if (event.kind === 'permission') return `${who} pide permiso`;
  if (event.kind === 'gate') return `${who} espera tu visto bueno`;
  return `${who} te pregunta`;
}

/** El aviso de un evento, o nada si no merece interrumpir [R61.7][R61.8]. Los secretos ya vienen ocultos del bus. */
export function noticeFor(event: RunEvent, diagram: Diagram): Notice | undefined {
  if (event.type === 'agent.question') {
    return { title: questionTitle(event, whoAsks(event, diagram)), body: cut(event.text) || 'Abre la ejecución para responder', runId: event.runId, live: true };
  }
  if (event.type !== 'run.finished' || event.status === 'cancelled') return undefined;
  const title = event.status === 'succeeded' ? 'Ejecución terminada' : event.reason === 'budget_exceeded' ? 'Ejecución sin presupuesto' : event.reason?.startsWith(REQUIREMENTS_UNMET) ? 'Ejecución incompleta' : 'La ejecución ha fallado';
  return { title, body: cut(diagram.name), runId: event.runId, live: false };
}
