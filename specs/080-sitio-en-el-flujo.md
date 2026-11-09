# SPEC-080 · Su sitio en el flujo

**Estado:** Implementada · **Hito:** M15k · **Paquetes:** `core`, `claude`, `runtime`, `editor`, `ui` · **Rama:** `feature/sitio-en-el-flujo`

## Propósito
Un agente sabe qué pasó antes que él: se lo da la memoria de la ejecución (SPEC-072). Pero, salvo el Coordinador (R59.4), no sabe nada de lo que viene después:
- **No sabe quién recibe su salida.** Puede ser otro agente, un router que elige camino, una revisión o la salida final, y escribe igual en todos los casos.
- **No sabe que le van a revisar** hasta que una revisión le devuelve el trabajo (R34.11). En la primera vuelta no conoce el criterio.
- **No sabe en qué vuelta de un bucle está.** La vuelta solo queda como evento (R5.6).
- **Hace el trabajo de los siguientes.** Es el fallo más citado en sistemas multiagente: el que programa también escribe los tests o se autorrevisa.

Esta spec le da a cada paso de agente su **contexto local**: quién recibe su salida, si su trabajo pasa por una revisión y en qué vuelta va. No le da el diagrama entero ni el registro de agentes.

## Cómo lo hacen otros
- **Grafos (LangGraph, n8n):** el nodo no ve el grafo; el camino lo decide el grafo. Es nuestro caso, y por eso no damos el mapa entero.
- **Jefe y trabajadores (sistema de investigación de Anthropic):** el jefe da a cada trabajador su objetivo, el formato de salida y **los límites de su tarea**, para que no duplique el trabajo de otros. [Sistema multiagente](https://www.anthropic.com/engineering/built-multi-agent-research-system)
- **Traspasos (OpenAI Agents SDK, AutoGen):** el agente conoce a quién puede pasarle el trabajo porque él decide. Aquí decide el diagrama, así que basta con contarle lo que hay a continuación, sin herramientas para elegir.

## Decisiones (09/11/2026)
1. **Cuánto contar.**
   - *Primera:* el diagrama entero, con todos sus pasos.
   - *Revisión:* gasta tokens en lo que no usa y le invita a hacer el trabajo de otros. Es justo lo que se quiere evitar.
   - *Segunda (elegida):* **solo sus vecinos**: los destinos directos de su salida, la revisión por la que pasa su tramo y el bucle en el que está. A un router se le describen sus opciones, sin seguir más allá.
2. **Dónde va.**
   - *Primera:* en el prompt de sistema, como la regla de reparto.
   - *Revisión:* cambia de un paso a otro y de una vuelta a otra, y el prompt de sistema de un mismo agente se comparte entre pasos. Romperíamos la caché, igual que pasaba con la memoria (R72.18).
   - *Segunda (elegida):* **en el mensaje del usuario**, después de la memoria y antes de la tarea.
3. **Revisiones en modo `verdict`.** No se le dice al agente que la revisión busca `VEREDICTO:`. Si el que hace el trabajo va directo a la revisión, se aprobaría a sí mismo. Solo se le dice que hay una revisión y su criterio.

## Requisitos

### Qué se cuenta
- **R80.1** [M15k] `flowContext(view)` (en `core`) es una función pura que devuelve el texto de la sección `## Tu sitio en el flujo`, o `undefined` si no hay nada que contar. `view` lleva el diagrama del nivel del paso, su id, los contenedores en los que está (bucle o subdiagrama, del más cercano al más lejano, con su nodo), la vuelta del bucle más cercano y el nombre de cada agente.
- **R80.2** [M15k] «Después de ti»: una línea por cada destino de las aristas de salida del paso que no son de retorno, en el orden del diagrama, como mucho 6, y después «(y N más)». Según el tipo de destino:
  - **agent:** «label», su agente y su tarea recortada a 160 caracteres, o «sin tarea».
  - **router:** que elige por dónde sigue, por reglas o con IA, entre sus destinos, con la condición de cada arista si la tiene (recortada a 120 caracteres).
  - **review:** en modo `human`, que la revisa la persona. En los demás modos, que decide si se aprueba, con su criterio si lo tiene (recortado a 160 caracteres), el máximo de vueltas y a qué paso vuelve si se rechaza, si hay retorno.
  - **transform:** que la convierte a JSON, Markdown o texto.
  - **loop** y **subdiagram:** su nombre y tipo.
  - **output:** en el nivel principal, que es la salida final de la ejecución. Dentro de un bucle, que cierra esta vuelta del bucle «X». Dentro de un subdiagrama, que es la salida del subdiagrama «X».
- **R80.3** [M15k] Un Coordinador no repite en «Después de ti» sus ramas de reparto, que ya describe la regla de reparto (R59.4). Solo aparecen los destinos que no son ramas, por ejemplo una salida.
- **R80.4** [M15k] Si algún destino es un agente, un router o una revisión, la sección acaba con «Haz solo tu tarea: lo que hacen los pasos siguientes no te toca a ti.».
- **R80.5** [M15k] Si el paso está en el tramo de un retorno (R34.4) y esa revisión no es un destino directo, se añade: «Tu trabajo pasa después por la revisión «R» (como mucho N vueltas): si la rechaza, vuelve a «destino» con las correcciones.».
- **R80.6** [M15k] Si el paso está dentro de un bucle, directamente o en un subdiagrama dentro de él, se describe el más cercano:
  - en modo `count`: «Estás dentro del bucle «X»: vuelta n de N.»;
  - en modo `ai-judge`: «Estás dentro del bucle «X»: vuelta n, como mucho N. Se repite hasta que: …» con la condición recortada a 200 caracteres.

  En los dos modos se añade «Lo que entregues en esta vuelta será la entrada de la siguiente.». La vuelta `n` es 1 más el número de eventos `loop.iteration` de ese bucle en su ruta que ya se han emitido.
- **R80.7** [M15k] Un paso sin aristas de salida, sin revisión por delante y fuera de un bucle no recibe la sección.

### Cómo llega
- **R80.8** [M15k] La sección se calcula al arrancar el paso y no cambia entre sus intentos ni entre sus vueltas de confirmación, como la memoria (R72.9). Va en `AgentRequest.flow` y en el evento `agent.request` (`flow`), para que quede registrado exactamente lo que recibió.
- **R80.9** [M15k] El adaptador de Claude la pone en el mensaje del usuario, después de la memoria y antes de la tarea. El prompt de sistema no cambia.
- **R80.10** [M15k] La activa la app (`OrchestratorDeps.flow`, que activa `createEngineOrchestrator`). Un `Orchestrator` sin ella se comporta como antes, y por eso no cambian las grabaciones de SPEC-056.
- **R80.11** [M15k] La pestaña «Contexto» del inspector de conexiones (SPEC-042) la enseña como «Su sitio en el flujo».

## Escenarios
- **E80.a** *Dado* Entrada → programador → qa → Revisión (✗ vuelve a programador), *entonces* el programador recibe que después va «qa» con su tarea, la frase de R80.4 y que su trabajo pasa por la revisión y vuelve a él si se rechaza.
- **E80.b** *Dado* un paso cuya salida va a un router por reglas con las ramas «Arreglar» (si: hay errores) y «Publicar», *entonces* recibe las dos opciones con su condición.
- **E80.c** *Dado* un bucle `count: 3` con un agente dentro, *entonces* en la segunda vuelta el agente recibe «vuelta 2 de 3».
- **E80.d** *Dado* un Orchestrator sin `flow`, *entonces* `agent.request` no lleva `flow` y la petición tampoco.

## Fuera de alcance
- Describir más allá de los vecinos directos (lo que hay detrás de un router o de un bucle).
- Que el agente elija a quién pasarle el trabajo.
- Ponerlo en los pasos internos (juntar archivos, verificar) y en el asistente.
