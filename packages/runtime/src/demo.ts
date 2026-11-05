import { MockAgent, MockDecider, Orchestrator } from '@orquestador/core';

/**
 * Orquestador de demostración (R20.7): agentes simulados con streaming, herramientas, uso de tokens,
 * una pregunta al usuario (creador) y un evaluador que aprueba en la segunda vuelta.
 */
export function createDemoParts(): { adapter: MockAgent; decider: MockDecider } {
  const delay = 40;
  const agent = (text: string, extra = {}) => ({
    tokens: text.split(/(?<= )/),
    usage: { inputTokens: 120, outputTokens: 40, costUsd: 0.002 },
    latencyMs: delay,
    output: text,
    ...extra,
  });
  const mock = new MockAgent({
    sprites: agent('Sprites creados: personaje.png', {
      tools: [{ tool: 'Write', input: { file: 'personaje.png' }, ok: true, output: 'ok' }],
    }),
    gameplay: agent('Bucle de juego implementado.'),
    sonido: agent('Efectos de sonido preparados.'),
    creador: agent('Borrador listo con el estilo elegido.', {
      asks: [{ question: '¿Qué estilo prefieres?', options: ['Pixel art', 'Vectorial', 'Realista'] }],
    }),
    revisor: agent('Revisión completada.'),
  });
  let rounds = 0;
  const decider = new MockDecider({
    route: (req) => ({ edgeIds: req.candidates.slice(0, 2).map((c) => c.edgeId), reason: 'Se necesitan los dos primeros agentes (demo)' }),
    judge: () => ({ done: ++rounds % 2 === 0, reason: rounds % 2 === 0 ? 'Cumple lo pedido' : 'Falta pulir' }),
  });
  return { adapter: mock, decider };
}

export function createDemoOrchestrator(): Orchestrator {
  const { adapter, decider } = createDemoParts();
  return new Orchestrator({ getAdapter: () => adapter, decider });
}
