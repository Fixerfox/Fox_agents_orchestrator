# SPEC-040 · Modelo de IA por paso

**Estado:** Implementada (M8f) · **Hito:** M8f · **Paquetes:** `core`, `claude`, `editor`, `ui`

## Propósito
Hasta ahora el modelo de IA se elige solo en la ficha del agente, así que un mismo agente usa siempre el mismo modelo en todos los diagramas. El usuario pidió (05/11) poder elegirlo en cada paso del diagrama: por ejemplo, Opus para especificar y Haiku para una revisión rápida, con el mismo agente y sin tocar su ficha.

## Decisiones (05/11/2026)
- El modelo del paso es opcional y **sustituye** al de la ficha solo en ese paso; sin él, se usa el del agente, como hasta ahora.
- Solo los nodos `agent` lo tienen. Enrutado, evaluadores, revisión con IA y «Transformar» con Claude siguen con su configuración actual.
- Se guarda en el diagrama (`model` del nodo). No hace falta migración: es un campo opcional.

## Requisitos
- **R40.1** [M8f] Un nodo `agent` puede tener `model` con el id de uno de los modelos conocidos (`MODELS`). Un modelo desconocido es un problema de validación `node-unknown-model`, y un `model` en un nodo que no es `agent` es `node-model-not-agent`.
- **R40.2** [M8f] `updateNode(…, { model })` fija el modelo del paso; con `''` lo quita (vuelve al del agente). Solo vale en nodos `agent` y con un modelo conocido; si no, falla con `invalid`. Deshacer y rehacer funcionan como con cualquier otro cambio.
- **R40.3** [M8f] Al ejecutar un paso con modelo propio, el orquestador lo pasa al motor en la petición (`AgentRequest.model`) y lo deja registrado en `agent.request` (`model`), para que el registro diga con qué modelo trabajó cada intento.
- **R40.4** [M8f] El motor de Claude usa el modelo del paso si lo hay y, si no, el de la ficha del agente.
- **R40.5** [M8f] El panel de un paso de agente tiene el selector «Modelo» con «El del agente (<modelo de su ficha>)» y los modelos conocidos; elegir uno lo fija en el paso y elegir el primero lo quita. En el lienzo, la tarjeta de un paso con modelo propio lo muestra junto al nombre del agente («Especificador · Opus 5.5»).
- **R40.6** [M8f] En los mensajes de un paso, la entrada de cada intento dice qué modelo usó cuando el paso tenía modelo propio («Recibió (intento 1) · Opus 5.5»).
