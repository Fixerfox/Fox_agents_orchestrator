# SPEC-042 · Inspector de conexiones

**Estado:** Implementada (M8f) · **Hito:** M8f · **Paquetes:** `editor`, `ui`

## Propósito
El usuario pidió (05/11) pulsar en un hilo del diagrama y ver exactamente qué información se envió al agente siguiente y qué contexto tenía ese agente antes de empezar. De los cuatro prototipos («Inspector de conexiones», artefacto del 05/11) eligió **B: una tarjeta sobre el hilo** que además se pueda hacer más grande.

## Decisiones (05/11/2026)
- No hace falta tocar el motor: `edge.traversed`, `node.finished`, `node.started`, `agent.request` y `review.decided` ya cuentan todo. La lógica es pura en `packages/editor` (`edgeTraversals`) y se reconstruye solo con los eventos, en vivo o con una ejecución guardada.
- «Lo que envió» es lo que el origen dejó en la conexión: su última salida (`node.finished`) o, en un retorno de revisión, el motivo del rechazo. «Lo que recibió» es la entrada con la que arrancó el destino (`node.started`), que puede juntar varias conexiones o, tras una devolución, la ronda compuesta.
- «Contexto» es la primera petición (`agent.request`) del destino después de esa vez: modelo, instrucciones, tarea, skills, contextos, MCP, herramientas y respuestas previas, con su origen (agente, diagrama o este paso, según R33.4).
- La tercera pestaña es «Registro»: la petición tal como la guardó el motor, en JSON. Es exacta y ya viene con los secretos ocultos (SPEC-008). El texto final que el motor de Claude compone no se registra; no se inventa.
- Los textos se dibujan en Markdown con el componente seguro de R38.2. Los tokens se dan aproximados («≈ 1,8 k tokens», 4 caracteres por token), porque la entrada no se cuenta por separado.
- Al editar (sin ejecución en pantalla) pulsar un hilo sigue seleccionándolo como antes.

## Requisitos
- **R42.1** [M8f] `edgeTraversals(events, edge, path)` devuelve una entrada por cada `edge.traversed` de esa conexión en ese nivel (`nodePath`), en orden, numeradas desde 1, con su hora y `seq`.
- **R42.2** [M8f] En cada vez, `sent` es la última salida del origen anterior a esa vez. Si el origen es una revisión que acaba de rechazar con retorno a ese destino, `sent` es el motivo del rechazo y `kind` es `return`.
- **R42.3** [M8f] Cada vez se une al siguiente `node.started` del destino en ese nivel: `received` es su entrada, `pass` la pasada del destino (como en R15.14) y `combined` indica que lo recibido no es igual a lo enviado (varias entradas o una ronda compuesta). Si el destino aún no ha empezado, `state` es `waiting`; si ha empezado y no ha terminado, `running`; si terminó, `finished`, con su estado.
- **R42.4** [M8f] Las `agent.request` del destino entre ese inicio y su fin se guardan en `requests` (un elemento por intento). Si el destino no es un agente, `requests` está vacío.
- **R42.5** [M8f] `requestKnowledge(request)` lista las skills, contextos y MCP de la petición sin repetir, con su origen: `agent` (ficha del agente), `diagram` (todo el diagrama) o `node` (solo este paso). Si algo viene de varios sitios, gana el más concreto (`node` > `diagram` > `agent`).
- **R42.6** [M8f] En una ejecución en pantalla (en marcha o terminada), pulsar un hilo abre una tarjeta junto al punto pulsado con «Origen → Destino», la hora, un selector de vez si hubo más de una (por defecto la última), un extracto de lo enviado con sus archivos y su tamaño aproximado, y un resumen de lo que el destino ya tenía (instrucciones, skills, contextos y MCP, tarea, y las respuestas previas o el motivo de la devolución).
- **R42.7** [M8f] Si por la conexión aún no ha pasado nada, la tarjeta lo dice («Aún no ha pasado nada por esta conexión»). Si el destino espera a otras entradas, lo dice también. Mientras la ejecución sigue, la tarjeta se actualiza sola.
- **R42.8** [M8f] La tarjeta se amplía con su botón «Ampliar» o el icono de maximizar, y se reduce con el mismo icono. Ampliada, ocupa una ventana grande que se puede redimensionar desde la esquina y tiene tres pestañas: «Lo que envió» (texto completo en Markdown, archivos y, si lo recibido es distinto, también «Lo que recibió»), «Contexto de <destino>» (modelo, instrucciones completas, tarea, skills, contextos, MCP, herramientas y respuestas previas, cada uno con su origen) y «Registro» (la petición en JSON).
- **R42.9** [M8f] La tarjeta se cierra con «Cerrar», con Esc o al pulsar el lienzo. «Copiar» copia lo enviado (o el JSON en «Registro»). «Ir a <destino>» abre el detalle del paso destino.
- **R42.10** [M8f] Si el destino no es un agente (salida, enrutado, «Transformar»…), la pestaña de contexto dice que ese paso no es un agente y se muestra solo lo enviado y lo recibido.

## Fuera de alcance
- Mostrar el prompt final compuesto por el motor de Claude (habría que registrarlo; queda como idea futura).
- Comparar dos veces de una misma conexión (prototipo D): retagueado a M10.
- La tarjeta al pasar el ratón sin pulsar.
