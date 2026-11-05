# SPEC-008 · Logs y trazabilidad

**Estado:** M1 y M2 implementados; M4 pendiente · **Hito:** M1 / M2 / M4 · **Paquete:** `core`, `store`, `ui`

## Propósito
Poder analizar, después de cualquier ejecución, **qué recibió cada agente, qué hizo y qué respondió**, así como las decisiones de enrutado y de bucles. El log es la propia secuencia de eventos: completo, ordenado, sin secretos y suficiente para reproducir la ejecución.

## Requisitos
- **R8.1** [M1] Por cada intento de un agente se emite `agent.request` con la entrada exacta (texto y archivos), `agentId`, `attempt` y, si hay `describeAgent`, la foto de su configuración (modelo, instrucciones, skills, contextos, herramientas, MCP, versión).
- **R8.2** [M1] `node.started` incluye la entrada del nodo y `node.finished` su salida.
- **R8.3** [M1] Todo lo que hace un agente queda con su `nodeId`: texto en streaming, `tool.called`, `tool.result`, `agent.usage` y `file.produced`.
- **R8.4** [M1] Toda decisión de IA fuera de los agentes de trabajo (enrutado, condición, evaluador de bucle) emite `decision` con petición y respuesta completas.
- **R8.5** [M1] `transcriptOf(events, nodeId, nodePath?)` devuelve, en orden, todos los eventos de un agente concreto.
- **R8.6** [M1] `reduceRunState(events)` reconstruye a partir de los eventos el mismo estado final que la ejecución en vivo: estado por nodo, ruta (nodos visitados, aristas, decisiones, vueltas de bucle) y uso.
- **R8.7** [M1] Los secretos no aparecen en el log (ver R2.6) pero los datos reales que viajan entre agentes no se alteran.
- **R8.8** [M2] Cada ejecución se persiste en `.orquestador/runs/<runId>/`: `events.jsonl` (una línea por evento, ordenada por `seq`, escrita de forma **incremental** mientras corre) y `meta.json` (diagrama, estado, motivo, uso, fechas, nº de eventos y un extracto de la orden sin secretos). Cada línea es válida por sí misma.
- **R8.9** [M2] Un log persistido se puede cargar y pasar por `reduceRunState`/`transcriptOf` para el replay, con los mismos resultados que en vivo. Si el último registro quedó a medias por un cierre inesperado, se ignora y se indica (`truncated`).
- **R8.10** [M2] La retención es configurable (por número de ejecuciones y/o antigüedad) y nunca borra ejecuciones en curso.
- **R8.13** [M2] Una ejecución cuyo `meta.json` sigue en `running` pero que no está viva (cierre inesperado de la app) se lista como `interrupted`; si está viva, como `running`.
- **R8.11** [M4] Visor de logs: filtrar por agente, tipo de evento y texto; ver la entrada, las herramientas y la respuesta de cada agente; exportar el log de una ejecución.
- **R8.12** [M4b] Comparar dos ejecuciones del mismo diagrama (rutas y salidas).

## Escenarios
- **E8.a** *Dado* un agente «Pintor» que recibió «dibuja un pino», llamó a una herramienta y respondió, *cuando* se consulta `transcriptOf`, *entonces* aparecen en orden: `node.started` (entrada), `agent.request`, `tool.called`, `tool.result`, `token.stream`, `agent.usage` y `node.finished` (salida).
