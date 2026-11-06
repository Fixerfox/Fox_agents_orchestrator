import type { AgentAdapter, Decider } from '../adapter';

/** Un motor de agentes completo: quien ejecuta los pasos y quien toma las decisiones [R56.3]. */
export interface AgentEngine {
  /** Valor de `settings().engine` que lo elige [R27.1]. */
  id: string;
  adapter: AgentAdapter;
  decider: Decider;
}
