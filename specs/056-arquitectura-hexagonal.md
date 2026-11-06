# SPEC-056 · Arquitectura hexagonal con contextos (DDD ligero) y responsabilidades separadas

**Estado:** Hecho · **Hito:** M11a, M11b, M11c, M11d · **Paquetes:** todos

## Propósito
El 05/11 el usuario pidió una arquitectura que escale («hexagonal no está mal», «DDD ligero») y que no haya clases monolíticas. Revisión del código (05/11, 23:20):

- La dirección de las dependencias ya es casi hexagonal: `core` no importa nada; `editor` y `ui` solo dependen del núcleo; `claude`, `store` y `workspace` son adaptadores que dependen de `core`; `apps/desktop` compone.
- **Fuga:** `runtime` importa adaptadores concretos. `engine.ts` crea `ClaudeAdapter` y `ClaudeDecider` y recibe un `ProjectStore`. `run-service.ts` usa `isSensitivePath` de `claude` y una docena de funciones de `store` (`startLoggedRun`, `listRuns`, `readRunLog`, `snapshotStep`…). Con otro motor o con otra persistencia habría que tocar `runtime`.
- **Piezas monolíticas:**
  - `core/src/orchestrator.ts` (1433 líneas): planificación del grafo, un `switch` por tipo de nodo y la lógica de cada uno (agente, router, bucle, revisión, revisión humana, transformar, subdiagrama, entregable). Todo comparte un `RunCtx` que concentra pausa, concurrencia, presupuesto, preguntas, confirmaciones, reanudar, correcciones y entregable.
  - `runtime/src/run-service.ts` (560): cola, lanzamiento, control, historial, correcciones y vista previa de archivos.
  - `editor/src/api.ts` (856, 86 métodos en una sola interfaz), `ui/src/memoryApi.ts` (829), `apps/desktop/src/main/handlers.ts` (693).
  - Pantallas: `AgentsScreen` (1368), `App` (1120), `RunsScreen` (1119).
- Nada comprueba la arquitectura: hoy se cumple por disciplina.

Esta spec no añade funcionalidad. Cambia la estructura para que añadir un tipo de nodo, un motor, una persistencia o una pantalla sea añadir un módulo y no editar uno grande. El comportamiento queda igual y lo garantizan los tests actuales y una grabación de eventos de referencia.

## Decisiones (05/11/2026)
1. **Contextos: carpetas, no paquetes.**
   - *Primera:* un paquete npm por contexto (`core-execution`, `core-knowledge`…).
   - *Revisión:* multiplica `package.json`, `tsconfig` y enlaces de workspace, obliga a cambiar todos los imports de `ui` y `editor` y facilita ciclos de tipos entre paquetes.
   - *Segunda (elegida):* carpetas dentro de `core` con un `index.ts` público por contexto y una regla que prohíbe entrar en sus archivos internos desde fuera. Un contexto podrá pasar a paquete más adelante sin cambiar sus límites.
2. **Puertos dentro del núcleo.**
   - *Primera:* paquete nuevo `ports`.
   - *Revisión:* es un paquete sin lógica y `core` ya es el dominio del que todos dependen.
   - *Segunda (elegida):* `core/src/ports/`, con un doble en memoria de cada puerto (como `MockAgent`) para los tests.
3. **Tipos de nodo como handlers, no como herencia.**
   - *Primera:* una clase por tipo que hereda de `BaseNode`.
   - *Revisión:* la herencia acopla los tipos a una base que acabaría siendo el nuevo monolito, y el código actual ya es funcional (`runAgent`, `runRouter`…).
   - *Segunda (elegida):* objetos `NodeHandler { kind, run }` en un registro, con un `StepContext` que solo expone lo que un paso necesita. Se conserva el estilo funcional.
4. **`RunCtx` se reparte en servicios pequeños** (pausa, concurrencia, presupuesto, preguntas, reintentos, reanudar, emisión). `StepContext` es una interfaz que los agrupa: un handler no ve la clase ni el estado de los demás.
5. **Por fases, cada una con `npm run check` en verde.**
   - *Primera:* hacerlo todo de una vez.
   - *Revisión:* hay otra sesión trabajando en paralelo (`orchestrator.ts`, `run-service.ts` y la UI cambian a diario) y un cambio de golpe garantiza conflictos imposibles de fusionar.
   - *Segunda (elegida):* cuatro hitos cortos (M11a límites y puertos, M11b contextos, M11c responsabilidades del motor, M11d contrato y UI), cada uno aplicable por separado. La primera tarea de M11a es grabar los eventos de referencia. Antes de cada fase se avisa a la otra sesión y se fusiona a tres bandas, como hasta ahora.
6. **La API pública no cambia mientras se mueve por dentro.** `@orquestador/core` exporta lo mismo, `ProjectApi` tiene los mismos métodos y los canales IPC se llaman igual. Así M11b y M11c no tocan `ui` ni `apps/desktop`.
7. **Cómo se comprueba.**
   - *Primera:* `dependency-cruiser`.
   - *Revisión:* es una dependencia y una configuración nuevas, y sus fallos no salen en `spec:check`.
   - *Segunda (elegida):* un test de arquitectura con Vitest que lee los imports de `src` (trazable con `[R56.n]`, sin dependencias nuevas), más `no-restricted-imports` en ESLint para que el editor avise al escribir.
8. **Grabación de referencia.** Los eventos llevan horas e ids, y las ramas en paralelo pueden intercalarse.
   - *Primera:* comparar `events.jsonl` tal cual.
   - *Revisión:* fallaría en cada ejecución.
   - *Segunda (elegida):* reloj e ids deterministas, `MockAgent` con tiempos fijos, y comparación normalizada (sin `ts` ni duraciones): orden global en los diagramas secuenciales y orden por nodo en las ramas paralelas.
9. **DDD ligero.** Contextos con límites, un `index` público y un lenguaje común documentado. No se usan los patrones tácticos (agregados como clases, value objects, un repositorio por agregado): el dominio sigue siendo tipos y funciones puras.

## Requisitos

### A · Límites y puertos (M11a)
- **R56.1** [M11a] El test de arquitectura (`packages/core/test/architecture.test.ts`) lee los imports de `src` de cada paquete y falla si alguno no está en esta matriz:

  | Paquete | Puede importar de `@orquestador/*` |
  |---|---|
  | `core` | — |
  | `editor` | `core` |
  | `ui` | `core`, `editor` |
  | `claude`, `store`, `workspace` | `core` |
  | `runtime` | `core` |
  | `apps/desktop/src/main` | todos |
  | `apps/desktop/src/preload` | `core`, `editor` (solo tipos y nombres de canales) |
  | `apps/desktop/src/renderer` | `editor`, `ui` |

  El mensaje de error dice qué archivo importa qué y qué regla incumple. También comprueba que las dependencias de cada `package.json` coinciden con la matriz.
- **R56.2** [M11a] `core`, `editor` y `ui` no importan módulos de Node (`node:*`, `fs`, `path`, `child_process`…), `electron` ni `@anthropic-ai/*`. Solo `ui` importa React.
- **R56.3** [M11a] Puertos en `core/src/ports/`, cada uno con un doble en memoria en `core/src/testing/`:
  - `AgentEngine { id, adapter: AgentAdapter, decider: Decider }`.
  - `RunRepository`: todo lo que `runtime` toma hoy de `store` sobre ejecuciones. Abrir una ejecución con registro, listar, leer el registro y el diagrama de una ejecución, marcar «reanudada por» y «corregida por», descartar interrumpidas, copia de un paso, buscar vistas previas y carpetas de ejecución y de salida.
  - `LibraryReader`: agentes, contextos, skills, MCP y diagramas, con la copia de la ejecución si la hay (R52.1).
  - `PathPolicy`: `isSensitive(rel)` y `isPreviewable(rel)`.
  - `WorkspaceFiles`: lo que `runtime` toma hoy de `workspace` (`manifestOf`, `resolveInside`).
- **R56.4** [M11a] `runtime` solo depende de `core`. `RunService`, `jobsOf`, `takeSnapshot` y el orquestador por motor reciben puertos. `createEngineOrchestrator(ctx, engines: AgentEngine[])` elige el motor por `settings().engine` en cada paso, como hoy (R27.1), y ya no construye `ClaudeAdapter`.
- **R56.5** [M11a] `apps/desktop/src/main/composition.ts` es el único lugar que crea `ProjectStore`, `ClaudeAdapter` y `ClaudeDecider` y los conecta con los puertos (incluido el actual `claudeEnvironment`). `store` implementa `RunRepository` y `LibraryReader`, y `workspace` implementa `WorkspaceFiles`. `claude` exporta `createClaudeEngine(env, query): AgentEngine` y su `PathPolicy`.
- **R56.6** [M11a] Grabación de referencia: 14 diagramas en `packages/runtime/test/fixtures/golden/`. Son lineal; paralelo con agente que junta; router por reglas y con IA; bucle por veces y con evaluador; revisión con retorno por IA; revisión humana («Lo reviso yo»); subdiagrama; transformar; confirmar antes de terminar; entregable; reanudar una ejecución parada; corregir una ejecución terminada. Se ejecutan con `MockAgent`, reloj e ids deterministas, y la secuencia normalizada de eventos (decisión 8) es igual a la grabada. Se graba antes del primer cambio de estructura y no se regraba en esta spec.
- **R56.7** [M11a] `eslint.config.js` replica la matriz de R56.1 y R56.2 con `no-restricted-imports` por paquete, y `npm run check` incluye el test de arquitectura.

- **R56.21** [M11a] Las escrituras atómicas de `store` sobreviven a lecturas simultáneas. En Windows, `rename` sobre un archivo que alguien está leyendo falla con `EPERM`, `EACCES` o `EBUSY`. Es lo que pasa cuando la lista de ejecuciones lee `meta.json` mientras una termina: el error se perdía en el bus, `meta.json` se quedaba sin el estado final y `logged` no se cumplía, así que la ejecución seguía «en marcha» y su cola no avanzaba. Se reintenta unos milisegundos y, si sigue ocupado, se escribe directamente sobre el archivo. No es funcionalidad nueva: sin esto `npm run check` no puede estar en verde en Windows (decisión 5).

### B · Contextos (M11b)
- **R56.8** [M11b] `core/src` se organiza en contextos, cada uno con su `index.ts` público:
  - `shared/`: ids, `Payload`, ocultar secretos, utilidades y lo que varios contextos necesitan y no es de ninguno: catálogo de modelos, niveles de permisos, referencias de conocimiento (`KnowledgeExtra`) y JSON Schema. Si estuvieran en `settings` o `knowledge`, `diagrams` tendría que importarlos y R56.9 lo prohíbe.
  - `diagrams/`: modelo del diagrama, validación (también la de la configuración de transformar y del entregable), recorrido del grafo (`forwardEdges`, `returnEdges`, `finalSteps`…).
  - `knowledge/`: agentes, contextos, skills, MCP, biblioteca, instalación de paquetes. Spec Kit sigue en `editor`, que es donde está hoy.
  - `settings/`: ajustes, efecto de los permisos, proyectos recientes.
  - `execution/`: orquestador, catálogo de eventos, reanudar, revisión, correcciones, transformar, entregable, replay.
  - `ports/` y `testing/`: los de R56.3. `testing/` también guarda `MockAgent` y `MockDecider`.
- **R56.9** [M11b] Reglas entre contextos, comprobadas por el test de arquitectura:
  - `shared` no importa de ningún otro.
  - `diagrams`, `knowledge` y `settings` solo importan de `shared`.
  - `execution` puede importar de todos los anteriores.
  - `ports` solo importa tipos; puede nombrar los de `execution` porque describe contratos del motor.
  - `testing` puede importar de todos y nadie importa de él salvo el `index` de `core`.
  - Desde fuera de un contexto solo se importa su `index.ts`. Por ejemplo, nunca `execution/nodes/agent`.
- **R56.10** [M11b] `@orquestador/core` exporta exactamente los mismos nombres que antes de M11b. Un test compara la lista de exportaciones con una instantánea; en esta fase no cambia ningún import fuera de `core`.
- **R56.11** [M11b] `docs/06-contextos.md` describe cada contexto: qué hace, qué expone, de quién depende y su lenguaje común (paso, pasada, intento, entregable, enchufado, revisión, corrección…). El test de arquitectura falla si una carpeta de contexto no aparece en ese documento.

### C · Responsabilidades del motor (M11c)
- **R56.12** [M11c] Cada tipo de nodo es un `NodeHandler { kind; run(step: StepContext, node, input, path): Promise<Outcome> }` en su propio archivo de `execution/nodes/`: `entry`, `output`, `agent`, `router`, `loop`, `review`, `transform` y `subdiagram`. Los modos de un tipo van en archivos propios dentro de su carpeta: `review/ai.ts` y `review/human.ts`, y la composición del entregable en `output/deliverable.ts`. Se registran en un `NodeRegistry`. `runNode` busca el handler en el registro y no tiene un `switch` por tipo. Un diagrama con un tipo sin handler no arranca: el orquestador lo comprueba antes del primer `node.started` y termina la ejecución con `run.finished` en estado `failed` y el motivo `node-no-handler` (la validación de `diagrams` no conoce el registro).
- **R56.13** [M11c] `RunCtx` se reparte en servicios de `execution/run/`, cada uno con sus tests sin orquestador:
  - `PauseGate`: pausa cooperativa.
  - `ConcurrencyLimiter`: huecos y liberarlos mientras se espera al usuario.
  - `BudgetTracker`: uso y límite.
  - `QuestionBroker`: preguntas, permisos, confirmaciones y respuestas.
  - `RetryPolicy`: intentos y espera creciente.
  - `ResumeCache`: salidas reutilizables y correcciones.
  - `RunEmitter`: emisión con `seq`.

  `StepContext` es una interfaz que da a cada handler solo esos servicios, el resolvedor de plantillas y los datos de la ejecución que necesita (conocimiento del diagrama raíz, entregable, pasos finales).
- **R56.14** [M11c] `Orchestrator` solo arranca la ejecución, planifica el grafo (qué nodo está listo, esperar a todas las entradas, combinarlas con «## nombre») y la cierra. No contiene lógica de ningún tipo de nodo. Las funciones de texto (`mergeInputs`, `composeConfirmInput`, `explainTouchedFiles`, `deliverableNotice`) pasan a `execution/text/`.
- **R56.15** [M11c] Añadir un tipo de nodo no toca el orquestador. Un test registra un handler ficticio `echo` (solo en el test), ejecuta un diagrama `entry → echo → output` y recibe sus eventos `node.started` y `node.finished`, sin cambios en `orchestrator.ts`.
- **R56.16** [M11c] `RunService` mantiene su API pública como fachada y delega en clases de una sola responsabilidad, cada una con sus tests:
  - `RunQueue`: cola y lanzamiento según la concurrencia de trabajos (SPEC-052).
  - `RunLauncher`: preparar la entrada, los adjuntos y la copia de la biblioteca.
  - `RunControl`: pausar, reanudar, cancelar, responder y preguntas pendientes.
  - `RunHistory`: listar, suscribirse, linaje y ejecuciones terminadas.
  - `RunCorrections`: reanudar, proponer y aplicar una corrección.
  - `RunFiles`: vista previa, recursos y salida.
- **R56.17** [M11c] Presupuesto de tamaño en `core`, `runtime`, `editor`, `store`, `claude` y `workspace`: ningún archivo de `src` pasa de 500 líneas. Las excepciones están en una lista del test con su motivo (hoy solo `editor/src/i18n.ts`, que es un catálogo de textos).

### D · Contrato y UI por contexto (M11d)
- **R56.18** [M11d] `editor/src/api.ts` se reparte en `editor/src/api/` por contexto: `project`, `diagrams`, `runs`, `knowledge`, `settings` y `assistant`. `ProjectApi` es la unión (`&`) de esas interfaces. Un test compara la lista de métodos de `ProjectApi` con una instantánea: no se renombra ni se quita ninguno, así que el preload y los canales IPC no cambian. `ui/src/memoryApi.ts` y `apps/desktop/src/main/handlers.ts` se reparten igual.
- **R56.19** [M11d] `ui/src` se organiza en carpetas por contexto: `shell` (navegación, rail, layout), `diagrams`, `runs`, `knowledge`, `settings` y `assistant`, con las mismas reglas de R56.9 (los componentes comunes en `ui/src/common/`; la API en memoria de R56.18 se queda en `ui/src/memory/` con `ui/src/memoryApi.ts` como entrada). `App.tsx` solo compone la navegación, el layout y los proveedores. `AgentsScreen` y `RunsScreen` se parten en subcomponentes (lista, ficha, pestañas).
- **R56.20** [M11d] Presupuesto de tamaño en `ui` y `apps/desktop`: ningún archivo de `src` pasa de 600 líneas, con las excepciones en la lista del test.

## Escenarios
- **Nuevo tipo de nodo «Esperar» (M10 o más tarde):** se crea `execution/nodes/wait.ts`, su validación en `diagrams/` y se registra; se añade su componente en `ui/src/diagrams/`. El orquestador y los demás handlers no se tocan (R56.15).
- **Persistencia en SQLite o remota:** un adaptador nuevo implementa `RunRepository` y `LibraryReader`; `composition.ts` lo elige. `runtime`, `core` y `ui` no cambian (R56.4, R56.5).
- **Otro motor de agentes:** un paquete nuevo exporta un `AgentEngine`, se añade a la lista de `createEngineOrchestrator` y a Ajustes (R56.4).
- **Un import prohibido** (por ejemplo `runtime` importando `@orquestador/store`): ESLint lo marca al escribirlo y `npm run check` falla con el archivo y la regla (R56.1, R56.7).

## Fuera de alcance
- Patrones tácticos de DDD (agregados, value objects como clases, repositorios por agregado) y eventos de dominio separados de `RunEvent`.
- Separar los contextos en paquetes npm.
- Cambiar el formato de los JSON del proyecto, de `events.jsonl` o de los canales IPC.
- Implementar otro motor o otra persistencia: esta spec solo lo hace posible.
- Partir `i18n.ts` por contexto (se puede hacer después; hoy es una excepción del presupuesto).
- Tauri.

## Riesgos
- **Conflictos con la otra sesión:** mover archivos que la otra sesión está cambiando. Mitigación: fases cortas, avisar antes de cada una, fusionar a tres bandas y volver a pasar todos los tests sobre el resultado.
- **Cambios de comportamiento ocultos al partir el orquestador:** la grabación de referencia (R56.6) y los 1206 tests actuales deben pasar sin cambiar sus expectativas; solo cambian sus imports internos.
- **Indirección de más:** un puerto o servicio que solo se usa en un sitio y no tiene doble es un candidato a no existir. Cada uno debe tener al menos un test propio.
