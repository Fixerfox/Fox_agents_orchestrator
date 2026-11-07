# Contextos del núcleo

`packages/core/src` se organiza en contextos (SPEC-056). Cada carpeta tiene un `index.ts` público y desde fuera solo se entra por ahí. Las reglas las comprueba `packages/core/test/architecture.test.ts` a partir de `scripts/architecture.json`, que también alimenta a ESLint.

Es DDD ligero: contextos con límites y un lenguaje común. El dominio sigue siendo tipos y funciones puras, sin agregados como clases ni repositorios por agregado.

## Quién depende de quién

```text
shared  ←  diagrams, knowledge, settings  ←  execution  ←  ports  ←  testing
```

Las flechas apuntan hacia lo que se importa. `ports` solo importa tipos. Nadie importa de `testing` salvo el `index.ts` de `core`.

## Los contextos

### `shared/`
- **Qué hace:** lo que varios contextos necesitan y no es de ninguno.
- **Qué expone:** `Id`, `Payload`, `isSafeId`, `slugify`, `LIMITS`, catálogo de modelos (`MODELS`), niveles de permisos, referencias de conocimiento (`KnowledgeExtra`, `mergeExtra`, `stepExtra`), JSON y JSON Schema, ocultar secretos y rutas de vista previa.
- **Depende de:** nadie.

### `diagrams/`
- **Qué hace:** el modelo del diagrama, su validación y el recorrido del grafo.
- **Qué expone:** `Diagram`, `DiagramNode`, `Edge`, `validateDiagram`, `returnEdges`, `forwardEdges`, `flowOrder`, `finalSteps`, `transformProblems`, `deliverableProblems`.
- **Depende de:** `shared`.

### `knowledge/`
- **Qué hace:** lo que saben los agentes: agentes, contextos, skills, servidores MCP, biblioteca e instalación de paquetes.
- **Qué expone:** `AgentDefinition`, `ContextDefinition`, `SkillDefinition`, `McpServerDefinition`, sus validadores, carpetas de la biblioteca, `analyzeImport`, `installImport`.
- **Depende de:** `shared`.

### `settings/`
- **Qué hace:** los ajustes de la aplicación, el efecto de los permisos y los proyectos recientes.
- **Qué expone:** `AppSettings`, `defaultSettings`, `normalizeSettings`, `validateSettings`, `effectivePermission`, `RecentProject`.
- **Depende de:** `shared`.

### `execution/`
- **Qué hace:** ejecutar diagramas. Es el contexto más grande y tiene tres subcarpetas:
  - `nodes/`: un `NodeHandler` por tipo de nodo, registrados en `NodeRegistry`.
  - `run/`: los servicios de una ejecución (`PauseGate`, `ConcurrencyLimiter`, `BudgetTracker`, `QuestionBroker`, `RetryPolicy`, `ResumeCache`, `RunEmitter`).
  - `text/`: funciones que componen textos (`mergeInputs`, `composeConfirmInput`, `explainTouchedFiles`, `deliverableNotice`).
- **Qué expone:** `Orchestrator`, `RunHandle`, `RunOptions`, el catálogo de eventos (`RunEvent`, `EventBus`), `AgentAdapter`, `Decider`, reanudar, corregir, revisión, transformar, entregable y replay. Los handlers y servicios son internos.
- **Depende de:** `shared`, `diagrams`, `knowledge` y `settings`.

### `ports/`
- **Qué hace:** los contratos que implementan los adaptadores. Solo tipos.
- **Qué expone:** `AgentEngine`, `RunRepository`, `LibraryReader`, `PathPolicy`, `WorkspaceFiles`, `RunMeta`.
- **Depende de:** los tipos de los contextos anteriores.

### `testing/`
- **Qué hace:** dobles para probar sin red, disco ni coste.
- **Qué expone:** `MockAgent`, `MockDecider`, `memoryEngine`, `MemoryRunRepository`, `MemoryLibrary`, `memoryPathPolicy`, `MemoryWorkspaceFiles`.
- **Depende de:** todos.

## Lenguaje común

| Término | Significado |
|---|---|
| **Paso** | Un nodo del diagrama en ejecución. |
| **Pasada** | Una vuelta por un tramo del diagrama: la de un bucle o la que repite una revisión con retorno. |
| **Intento** | Cada vez que un agente prueba un paso. Si falla por un error temporal, hay otro intento con espera creciente. |
| **Entregable** | Lo que el usuario recibe al terminar una ejecución. Lo compone la Salida del nivel principal. |
| **Enchufado** | Conocimiento (skill, contexto o MCP) añadido a un paso o a un diagrama sin tocar la ficha del agente. Las skills y MCP enchufados a un paso son obligatorios. |
| **Revisión** | Nodo que aprueba o rechaza: por veredicto, con la IA o esperando al usuario. |
| **Retorno** | Salida ✗ de una revisión conectada a un paso anterior: repite ese tramo. |
| **Corrección** | Ejecución nueva que reutiliza lo anterior al paso elegido y rehace ese paso con lo que pide el usuario. |
| **Reanudar** | Ejecución nueva que reutiliza lo que terminó bien de una que se paró. |
| **Copia** | Lo que usa una ejecución, tomado al lanzarla. Editar la biblioteca a mitad no la cambia. |

## Cómo se añade algo

- **Un tipo de nodo:** un archivo en `execution/nodes/`, su registro en `defaultNodeRegistry`, su validación en `diagrams/` y su componente en `ui`. El orquestador no se toca.
- **Otro motor:** un paquete que exporta un `AgentEngine`, añadido en `apps/desktop/src/main/composition.ts`.
- **Otra persistencia:** un adaptador de `RunRepository` y `LibraryReader`, elegido en `composition.ts`.
