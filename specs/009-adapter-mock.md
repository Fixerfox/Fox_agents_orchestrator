# SPEC-009 · Contrato de AgentAdapter y MockAgent

**Estado:** M1 implementado; M6 pendiente · **Hito:** M1 / M6 · **Paquete:** `core`, `adapters`

## Requisitos
- **R9.1** [M1] `run(request, signal)` devuelve un `AsyncIterable<AgentStreamEvent>` (`token`, `tool_call`, `tool_result`, `usage`, `file`, `result`). La salida del nodo es el `result` final; si no hay, es la concatenación de los `token`. El adapter puede preguntar al usuario con `request.ask` (SPEC-018).
- **R9.2** [M1] El adapter respeta `signal`: tras abortar deja de emitir y libera sus recursos.
- **R9.3** [M1] Los fallos controlados se lanzan como `AgentError`, con `retriable` verdadero o falso.
- **R9.4** [M1] `MockAgent` es determinista y configurable por agente (tokens, herramientas, uso, archivos, latencia, espera externa, fallos iniciales) y registra llamadas, concurrencia actual y máxima.
- **R9.5** [M1] `MockDecider` permite programar las decisiones de enrutado, condiciones y evaluador de bucles y registra las llamadas.
- **R9.6** [M6] Una suite de contrato reutilizable (`adapterContract`) verifica R9.1–R9.3 contra cualquier adapter, incluido el de Claude Agent SDK.
- **R9.7** [M6] El adapter de Claude traduce el agente (modelo, instrucciones, skills, herramientas, MCP, permisos, límites) a las opciones del SDK y sus eventos a `AgentStreamEvent`.
