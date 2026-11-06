# Orquestador — Constitución del proyecto

Aplicación de escritorio para orquestar agentes de IA de forma visual mediante diagramas, ver en tiempo real qué hace cada agente y asignarles tareas, skills y contextos.

## Principios de trabajo (obligatorios)
1. **Pensar paso a paso** teniendo en cuenta la arquitectura descrita aquí.
2. **Iterar dos veces** tanto la propuesta como la solución: primera versión → revisión crítica (riesgos, casos límite, coherencia con la arquitectura) → segunda revisión → entrega.
3. **Tests siempre.** Ninguna funcionalidad se da por terminada sin tests que pasen.
4. **Specs primero.** Toda funcionalidad nace de una spec en `specs/` (requisitos numerados `R<spec>.<n>`). Los tests citan el requisito en su nombre (`[R3.2]`) y `npm run spec:check` debe pasar. Si cambia el comportamiento, se cambia primero la spec.
5. Responder y documentar en español; código e identificadores en inglés.

## Decisión de stack (2026-11-04)
- **Lenguaje principal: TypeScript.** No Python como lenguaje principal: el núcleo es visual y el ecosistema de editores de grafos, tiempo real y empaquetado es mejor en web/TS.
- **Shell de escritorio:** Electron (por defecto). Tauri queda como alternativa si el peso importa y se acepta Rust.
- **UI:** React + React Flow (@xyflow/react). Cada nodo = agente; cada arista = flujo de tareas/contexto.
- **Python solo como sidecar opcional** si algún agente requiere librerías que solo existen en Python (LangGraph, CrewAI, modelos locales). En ese caso, protocolo explícito entre procesos (JSON sobre stdio/WebSocket).
- Motor confirmado: **Claude Code vía Claude Agent SDK** (TypeScript). El sidecar Python queda descartado salvo necesidad futura.

## Definición de producto (resumen; detalle en `docs/00-documento-base.md`)
- Motor: **Claude Agent SDK** tras `AgentAdapter`. Agentes en **formato nativo de Claude Code**.
- Registro de agentes (global + sobrescritura por proyecto), skills, contextos, modelo y MCP por agente.
- Diagrama con nodos `entry`, `output`, `agent`, `router` (IA o reglas), `loop` (evaluador IA o nº de veces, con máximo) y `subdiagram` (una plantilla entera usada como un solo nodo, por referencia y con versión fijable).
- Ejecución en vivo: nodo activo, ruta tomada y transcripción por agente; pausar/reanudar/cancelar; límite de presupuesto.
- Agentes en paralelo con espacio de trabajo aislado y fusión; instantánea por iteración en bucles.
- Auth: sesión de Claude Code o clave API (almacén seguro). Concurrencia 4 por defecto, 3 intentos con espera creciente.
- Los agentes pueden preguntar al usuario; el nodo queda en espera y se responde chateando en el nodo (SPEC-018).
- Logs completos por ejecución: qué recibe cada agente, qué hace y qué responde, con secretos ocultos (SPEC-008).
- Windows y Linux; interfaz en español (i18n preparado).

## Arquitectura
1. **Renderer (UI):** editor de diagramas, paneles de agentes/skills/contextos, vista de ejecución en vivo.
2. **Orquestador (main process o servicio local):** ejecuta agentes, gestiona colas, skills y contextos.
3. **Bus de eventos tipado** (pieza clave): el orquestador emite `node.started`, `tool.called`, `token.stream`, `route.decided`, `node.finished`, etc. (catálogo en `docs/04-eventos.md`) La UI solo consume eventos; así el motor de agentes es intercambiable sin tocar la UI.
4. **Persistencia:** JSON versionable con migración (diagramas, plantillas, proyecto) y, por ejecución, `events.jsonl` + `meta.json` en `.orquestador/runs/<runId>/` (sin SQLite por ahora).
5. **Capas de M3:** `packages/editor` (lógica del editor sin React, contrato IPC), `packages/ui` (React + React Flow), `apps/desktop` (Electron: el renderer solo ve `window.orquestador`, nunca rutas ni Node; IPC validado en el proceso principal).
6. **Ejecución (M3b/M4):** `packages/workspace` (aislamiento y fusión de archivos), `packages/runtime` (RunService: arranca, controla y entrega eventos por lotes). La UI solo consume eventos con `RunClient` (dedupe por `seq`).
7. **Interfaz de agente (adapter):** cada proveedor/motor implementa la misma interfaz para poder sustituirlo o simularlo.

8. **Hexagonal (SPEC-056):** `core` define los puertos (`AgentEngine`, `RunRepository`, `LibraryReader`, `PathPolicy`, `WorkspaceFiles`) y no importa de nadie. `runtime` solo depende de `core`; `claude`, `store` y `workspace` son adaptadores; `apps/desktop/src/main/composition.ts` es el único sitio que los crea. La matriz está en `scripts/architecture.json` y la comprueban un test y ESLint. `core` se organiza en contextos (`docs/06-contextos.md`). Cada tipo de nodo es un `NodeHandler` en `execution/nodes/`.

## Tests
- **Unitarios:** Vitest (orquestador, modelo de grafo, bus de eventos).
- **E2E:** Playwright (soporta Electron) para la UI.
- **Agente simulado (mock):** emite eventos sin gastar tokens; se usa en tests de UI y de orquestación.
- Los tests deben ejecutarse y pasar antes de dar una tarea por completada.

## Riesgos a vigilar
- Acoplar la UI al motor de agentes → mantener el bus de eventos como único contrato.
- Peso de Electron (~150 MB) → reevaluar Tauri más adelante si molesta.
- Importar paquetes ejecuta código de terceros → siempre con pantalla de revisión.
- Dos lenguajes (híbrido) → solo si es imprescindible, con protocolo versionado.
