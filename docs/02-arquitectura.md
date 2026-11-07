# 02 · Arquitectura

## Visión general
```
┌───────────── Renderer (React + React Flow) ─────────────┐
│ Editor de diagramas · Paneles · Vista de ejecución      │
└───────────────▲──────────────────────┬──────────────────┘
        eventos │ (suscripción)        │ comandos (IPC tipado)
┌───────────────┴──────────────────────▼──────────────────┐
│ Main / servicio local                                   │
│  Orchestrator ── Scheduler ── Event Bus ── Store        │
│        │                                 (SQLite+JSON)  │
│   AgentAdapter (interfaz)                               │
└───┬──────────────┬───────────────┬──────────────────────┘
    │              │               │
 Claude SDK     MockAgent     Sidecar Python (opcional)
```

## Componentes
| Componente | Responsabilidad |
|---|---|
| **Renderer** | Editar el grafo, mostrar estado en vivo. No contiene lógica de ejecución. |
| **Orchestrator** | Recorre el grafo, resuelve dependencias, lanza agentes, aplica cancelación y reintentos. |
| **Scheduler** | Cola de tareas con concurrencia limitada por diagrama y por proveedor. |
| **Event Bus** | Único contrato entre motor y UI. Eventos tipados, ordenados y con número de secuencia. |
| **Store** | Diagramas (JSON) y ejecuciones/eventos (SQLite). |
| **AgentAdapter** | Interfaz común: `start(task, context, skills) → AsyncIterable<AgentEvent>`, `cancel()`. |
| **Skill/Context Registry** | Catálogo de skills y contextos reutilizables y asignables a nodos. |

## Hexagonal (SPEC-056)
El núcleo no conoce a sus adaptadores. `packages/core` define los puertos y los demás paquetes dependen de él, nunca al revés.

| Paquete | Papel | Puede importar de |
|---|---|---|
| `core` | Dominio, puertos y dobles en memoria | nadie |
| `editor` | Lógica del editor sin React, contrato IPC | `core` |
| `ui` | Pantallas | `core`, `editor` |
| `claude`, `store`, `workspace` | Adaptadores: implementan puertos | `core` |
| `runtime` | Casos de uso de las ejecuciones, sobre puertos | `core` |
| `apps/desktop/src/main` | Composición: `composition.ts` crea y conecta los adaptadores | todos |

Los puertos son `AgentEngine`, `RunRepository`, `LibraryReader`, `PathPolicy` y `WorkspaceFiles`. La matriz está en `scripts/architecture.json`: la usan el test de arquitectura y ESLint. `core` se organiza en contextos, descritos en [06-contextos.md](06-contextos.md).

En el motor, cada tipo de nodo es un `NodeHandler` registrado en `NodeRegistry`. `Orchestrator` solo planifica el grafo. El comportamiento lo protegen 14 grabaciones de referencia en `packages/runtime/test/fixtures/golden/`.

## Principios
1. La UI **solo** consume eventos y envía comandos; nunca llama a un agente directamente.
2. Todo lo que ocurre en una ejecución es un evento persistido → permite replay y depuración.
3. Los motores de agentes son intercambiables detrás de `AgentAdapter`.
4. El dominio (grafo, ejecución) es TypeScript puro, sin dependencias de Electron ni React → testeable aislado.

## Estructura de carpetas propuesta (monorepo con npm workspaces)
```
packages/
  core/          # dominio: grafo, tareas, eventos, orchestrator (puro TS)
  adapters/      # claude, mock, python-sidecar
  store/         # persistencia SQLite + JSON
  ui/            # React + React Flow
apps/
  desktop/       # Electron: main, preload, empaquetado
docs/
```

## Revisión 1 (riesgos detectados y decisiones)
- **Orden de eventos:** cada evento lleva `runId` + `seq` monótono; la UI descarta duplicados y detecta huecos.
- **Cancelación:** `AbortSignal` propagado hasta el adapter; evento `run.cancelled` garantizado.
- **Reconexión de UI:** al abrir una ejecución en curso, la UI pide el snapshot y se suscribe desde `seq+1`.
- **Secretos:** claves API en el almacén seguro del SO (no en el JSON del diagrama).
- **Seguridad de herramientas:** cada skill declara permisos; el orquestador pide confirmación para acciones peligrosas.

## Revisión 2 (ajustes tras segunda pasada)
- **Ciclos en el grafo:** los ciclos solo existen a través de nodos `loop` explícitos con `maxIterations` obligatorio; se valida al guardar y al ejecutar (cualquier otro ciclo se rechaza).
- **Volumen de `token.stream`:** se agrupa por lotes (≈50 ms) antes de enviarlo al renderer; el store guarda el texto consolidado, no cada token.
- **Versionado:** el JSON del diagrama lleva `schemaVersion` y migraciones.
- **Coste:** cada `agent.usage` suma tokens/coste al run para mostrarlo en vivo.

## Ajustes tras las rondas 1-4 con el responsable del producto
- **Registro de agentes:** el nodo referencia un agente del registro (global o de proyecto). El agente se traduce a un subagente de Claude Code (instrucciones, modelo, skills, MCP, permisos).
- **Resolución de ámbito:** proyecto sobrescribe a global; contextos de proyecto solo en el proyecto.
- **Nodos especiales:** `entry` (orden manual), `router` (IA o reglas), `loop` (evaluador IA o nº de veces), agente.
- **Permisos:** el adapter traduce los permisos del agente a las políticas del SDK y emite `permission.requested/resolved` para que la UI los gestione.
- **Pausa/reanudación/cancelación** y **límite de presupuesto** son responsabilidad del Orchestrator.
- **Importación:** servicio `PackageImporter` con paso de revisión previo; no ejecuta nada del paquete hasta aprobarlo.
- **Plataformas:** Windows y Linux (Electron). Rutas con `path` multiplataforma; tests en ambos SO.
- **WorkspaceManager:** crea el espacio de trabajo aislado de cada agente (git worktree o copia temporal), fusiona al terminar y guarda instantáneas por iteración en la carpeta de la ejecución.
- **Nodos compuestos:** el Orchestrator expande un nodo `subdiagram` ejecutando la plantilla referenciada dentro del mismo `Run` (mismo bus, presupuesto, scheduler y permisos). La UI trata cada nivel como un lienzo navegable (migas de pan: Principal > Pintar > …).

- **Preguntas de agentes (SPEC-018):** el adapter recibe `ask()`; el Orchestrator emite `agent.question`, libera el hueco de concurrencia y espera `answer()`. La UI muestra el chat en el panel del nodo.
- **Logs (SPEC-008):** el bus redacta secretos al emitir; el paquete `store` escribe `events.jsonl` de forma incremental y `meta.json` por ejecución (`RunLogWriter`, `startLoggedRun`).
- **Persistencia (SPEC-010):** JSON versionado con migración y respaldo, escritura atómica, ids seguros y rechazo de secretos. **Sin SQLite** por ahora: `meta.json` hace de índice y se reconstruye desde las carpetas.
