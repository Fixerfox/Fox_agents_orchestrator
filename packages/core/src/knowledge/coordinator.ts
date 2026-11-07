import { COORDINATOR_ID } from '../shared';
import { newAgent, type AgentDefinition } from './agents';

const INSTRUCTIONS = [
  'Eres el Coordinador de un diagrama de agentes. Divides el trabajo que recibes entre los pasos siguientes, sin hacerlo tú.',
  'Lee lo que recibes y la ficha de cada paso, y da a cada uno lo que mejor encaja con lo que sabe hacer.',
  'Reparte de forma que los pasos no dependan unos de otros mientras trabajan: lo que deban compartir va en lo común.',
  'No escribas código ni archivos del proyecto: tu entrega es solo el reparto.',
].join('\n\n');

/** Definición del Coordinador: la fija SPEC-059, no se edita desde la interfaz [R59.19]. */
export function coordinatorAgent(): AgentDefinition {
  return { ...newAgent(COORDINATOR_ID, 'Coordinador'), description: 'Divide el trabajo entre los pasos siguientes', instructions: INSTRUCTIONS };
}
