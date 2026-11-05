# 03 · Modelo de dominio

```ts
type Id = string;

interface Diagram {
  id: Id; name: string; schemaVersion: number;
  nodes: AgentNode[]; edges: Edge[];
}

interface AgentNode {
  id: Id; label: string;
  adapter: 'claude' | 'mock' | 'python' | string;
  model?: string;
  position: { x: number; y: number };
  taskIds: Id[]; skillIds: Id[]; contextIds: Id[];
}

interface Edge {
  id: Id; from: Id; to: Id;
  kind: 'task' | 'context';   // qué viaja por la arista
}

interface Task    { id: Id; title: string; prompt: string; expectedOutput?: string }
interface Skill   { id: Id; name: string; description: string; instructions: string; permissions: Permission[] }
interface Context { id: Id; name: string; kind: 'text' | 'file' | 'folder' | 'url'; ref: string }  // se entrega por referencia, no inyectado

type RunStatus   = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';
type NodeStatus  = 'idle' | 'queued' | 'running' | 'waiting_input' | 'succeeded' | 'failed' | 'cancelled' | 'skipped';

interface Run {
  id: Id; diagramId: Id; status: RunStatus;
  startedAt: string; finishedAt?: string;
  nodeStatus: Record<Id, NodeStatus>;
  usage: { inputTokens: number; outputTokens: number; costUsd?: number };
}
```

## Reglas
- El grafo admite ciclos **solo a través de nodos `loop` explícitos**, con condición (prompt evaluado por IA o nº de veces) y `maxIterations` obligatorio. Fuera de los bucles no hay ciclos.
- Un nodo se ejecuta cuando todas sus aristas entrantes han terminado con éxito.
- La salida de un nodo se entrega como contexto a los nodos conectados por aristas `context`, y como entrada de tarea por aristas `task`.
- Si un nodo falla: sus descendientes pasan a `skipped`; los nodos independientes continúan.

## Ampliación tras la definición del producto
```ts
type Scope = 'global' | 'project';

interface AgentDefinition {          // registro de agentes
  id: Id; name: string; scope: Scope; description: string;
  instructions: string;              // editable y optimizable con IA
  model: string;                     // p. ej. 'sonnet-5.5' | 'opus' | 'haiku'
  skillIds: Id[]; contextIds: Id[];
  mcpServers: McpServerConfig[];     // desactivados hasta confirmar al importar
  permissions: { level: 'read' | 'edit' | 'execute'; autoApprove: boolean };
  allowedTools?: string[];           // prevalece sobre el preajuste de `level`
  limits?: { maxTurns?: number; maxCostUsd?: number };
  icon?: string; color?: string;
  version: number;                   // historial en la biblioteca global
}

interface ProjectPin { itemId: Id; version: number | 'latest' }   // el proyecto fija versión o sigue la última

interface McpServerEntry {           // catálogo de MCP reutilizables
  id: Id; name: string; transport: 'stdio' | 'http';
  command?: string; args?: string[]; env?: Record<string,string>; url?: string;
  enabled: boolean; lastTest?: { ok: boolean; at: string };
}

interface DiagramTemplate { id: Id; name: string; scope: Scope; diagram: Diagram; builtIn: boolean; version: number }
// Una plantilla con exactamente un nodo `entry` y un nodo `output` puede usarse como nodo `subdiagram`.

type NodeKind = 'entry' | 'output' | 'agent' | 'router' | 'loop' | 'subdiagram';

interface SubdiagramConfig { templateId: Id; version: number | 'latest' }   // el nodo ES una plantilla entera

interface RouterConfig { mode: 'ai' | 'rules'; rules?: { edgeId: Id; condition: string }[] }
interface LoopConfig   { mode: 'ai-judge' | 'count'; prompt?: string; count?: number; maxIterations: number; judgeModel?: string }

interface RunOptions { budget?: { maxTokens?: number; maxCostUsd?: number } }
```
- Un **proyecto** es una carpeta con `.orquestador/`; los ítems con `scope: 'project'` sobrescriben a los globales del mismo `id`.

## Subdiagramas
- Un nodo `subdiagram` referencia una `DiagramTemplate` (`SubdiagramConfig`). Se valida: sin referencias circulares, profundidad máxima (8 por defecto), una sola entrada y una sola salida, y que una plantilla global no dependa de elementos de proyecto.
- Todo evento lleva `nodePath: Id[]` (ruta de nodos anidados) para localizar al emisor dentro de subdiagramas.
- El `Run` hijo no es una ejecución independiente: comparte presupuesto, concurrencia y permisos del `Run` padre.

## Decisiones de implementación (M1)
- **Bucle = contenedor:** `LoopConfig.body` es un diagrama completo (con `entry` y `output`) que se repite; cada nivel sigue siendo un grafo sin ciclos (SPEC-005).
- **Salida de un nodo** = su texto y los archivos que ha producido; las entradas no se copian a la salida (SPEC-003 R3.11).
- **Reintentos:** `maxAttempts` son intentos totales (3 por defecto), con espera `baseDelayMs · 2^(n−1)`.
- **Pausa** global en M1; por nodo queda para M2 (SPEC-007 R7.8).
- **Preguntas de agentes:** `waiting_input` en el estado del nodo (SPEC-018).
