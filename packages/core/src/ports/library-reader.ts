import type { AgentDefinition, ContextDefinition } from '../agents';
import type { McpServerDefinition } from '../mcp';
import type { SkillDefinition } from '../skills';
import type { Diagram, Id } from '../types';

/**
 * Lectura de la biblioteca del proyecto [R56.3]. Con `runId` se lee la copia de esa ejecución si la hay [R52.1];
 * una lectura sin copias ignora el `runId`.
 */
export interface LibraryReader {
  agents(runId?: Id): Promise<AgentDefinition[]>;
  contexts(runId?: Id): Promise<ContextDefinition[]>;
  skills(runId?: Id): Promise<SkillDefinition[]>;
  mcp(runId?: Id): Promise<McpServerDefinition[]>;
  /** Rechaza si el diagrama no existe. */
  diagram(id: Id, runId?: Id): Promise<Diagram>;
  diagramIds(): Promise<Id[]>;
}
