# SPEC-027 · Adaptador de Claude (motor real)

**Estado:** Implementada (falta probar con el SDK real en Electron) · **Hito:** M6a · **Paquetes:** `core`, `claude`, `editor`, `ui`, `desktop`

## Propósito
Que los agentes se ejecuten de verdad con Claude (Agent SDK) usando lo que el usuario configuró: instrucciones, modelo, contextos y skills del agente, con la conexión de Ajustes. El SDK queda detrás de una función inyectable para poder probar todo sin red.

## Requisitos
- **R27.1** [M6a] Ajustes tiene `engine` (`simulated` | `claude`, por defecto `simulated`): se valida, se guarda, cruza el IPC y se elige en Ajustes. Con `simulated` la app se comporta como hasta ahora.
- **R27.2** [M6a] El adaptador construye el prompt de sistema del agente con su nombre, descripción e instrucciones, usa el modelo y el máximo de turnos del agente y entrega la entrada del nodo (texto y archivos) como mensaje del usuario, junto con las respuestas a preguntas de intentos anteriores.
- **R27.3** [M6a] Los contextos del agente se entregan por referencia [R22.10]: el texto va incluido, la URL se menciona y el archivo se menciona con su ruta relativa; el adaptador nunca lee archivos ni abre URLs por su cuenta.
- **R27.4** [M6a] Las skills asignadas se entregan [R24.8] como lista con nombre, descripción y ruta de su `SKILL.md` dentro del proyecto (y de sus archivos de referencia) para que el agente las lea cuando le hagan falta.
- **R27.5** [M6a] Los mensajes del SDK se traducen a eventos del orquestador: texto → `token`, uso de herramienta → `tool_call`, su resultado → `tool_result`, uso de tokens y coste → `usage`, resultado final → `result`. Los mensajes desconocidos se ignoran.
- **R27.6** [M6a] Los errores del SDK (turnos agotados, presupuesto, error de ejecución, sin sesión, límite de la API) se convierten en `AgentError` con mensaje en español; los de red o sobrecarga son reintentables y el resto no. Un resultado con error nunca se da por bueno.
- **R27.7** [M6a] Cancelar la ejecución aborta la consulta al SDK y deja de emitir eventos.
- **R27.8** [M6a] La conexión sale de Ajustes: `claude-code` usa la sesión de Claude Code (sin clave en el entorno) y `api-key` pasa la clave guardada solo al proceso del SDK; sin clave guardada falla con un mensaje claro. La clave nunca aparece en eventos, errores ni mensajes.
- **R27.9** [M6a] Permisos conservadores hasta que existan los permisos del motor (R16): solo herramientas de lectura y búsqueda, en la carpeta del proyecto; cualquier otra se deniega con un motivo legible.
- **R27.10** [M6a] Un agente que no existe en el proyecto falla sin reintentos y explica cómo crearlo. Las instrucciones y los contextos se leen al empezar cada ejecución del nodo.
- **R27.11** [M6a] El enrutado por IA, las condiciones y el evaluador de bucles usan Claude con respuesta JSON: se tolera texto alrededor, se valida contra las opciones reales (una arista inexistente se descarta) y una respuesta ilegible falla con un error claro, nunca con una decisión inventada.
- **R27.12** [M6a] «Probar conexión» (IPC `settings:test-connection`, botón en Ajustes) lanza una consulta mínima con los ajustes guardados y devuelve si funciona, el modelo y el tiempo, o el motivo del fallo explicado; la interfaz avisa de que prueba los ajustes guardados.
- **R27.13** [M8f] El prompt de sistema exige que, si el agente necesita una decisión o un dato del usuario, lo pida con la herramienta de preguntas antes de terminar y siga con la respuesta: no puede acabar su respuesta con preguntas o decisiones pendientes, porque al terminar el paso el flujo continúa sin esperarle.
