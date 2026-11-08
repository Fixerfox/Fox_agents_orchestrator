# SPEC-072 · Memoria de la ejecución estructurada

**Estado:** Borrador · **Hito:** M15c · **Paquetes:** `core`, `claude`, `runtime`, `editor`, `ui` · **Rama:** `feature/memoria-ejecucion`

## Propósito
La memoria de la ejecución (SPEC-060, R60.18–R60.27) es hoy un diario de texto: una línea con la rama de git y una entrada por paso con el resumen de una o dos frases que devuelve la revisión con IA. La auditoría del 08/11 (M1–M4, M6–M8 y S4) encontró que se queda corta justo donde más importa:
- **Lo que decide la persona no llega a los pasos siguientes.** Las respuestas solo viajan dentro del paso que preguntó (`previousAnswers`) y a la comprobación final (`decisions`). El paso B puede volver a preguntar lo que ya se respondió en A.
- **Sin revisión IA la memoria casi no dice nada** (nombre del paso y archivos), y con ella depende de un resumen hecho por un modelo barato sobre datos recortados, sin procedencia.
- **Todos reciben todo**, también lo de ramas que no tienen nada que ver con el paso. Más texto cuesta y confunde.
- **Una vuelta borra la anterior** (R63.3): en bucles y retornos se pierde qué se rechazó y por qué.
- **El router, el juez de bucle y transformar no dejan rastro**, aunque deciden el camino.
- **Los agentes no pueden dejar nada** a los siguientes («lo dejé a medias a propósito», «no toques X»).
- **Va en el prompt de sistema** y cambia en cada paso, así que rompe la caché del prompt del agente.

Esta spec convierte la memoria en **bloques con estructura, procedencia y relevancia por grafo**, que salen casi todos de eventos sin IA y se pueden reconstruir desde `events.jsonl`.

### Las cuatro capas de la memoria
Esta spec es la pieza central de un sistema de memoria en cuatro capas, repartido en tres specs:

| Capa | Dura | Escribe | Lee | Spec |
| --- | --- | --- | --- | --- |
| 1. Intento | Un paso | El motor: error del intento anterior y archivos que dejó | El siguiente intento del mismo paso | SPEC-071 |
| 2. Ejecución | Una ejecución y sus reanudaciones | Los eventos, el Supervisor (resúmenes) y cada agente (su nota) | Cada paso, filtrado por el grafo | Esta |
| 3. Proyecto | Indefinida, en `.orquestador/memory/` | Propuestas que aprueba la persona | Todos los agentes del proyecto y el Supervisor | SPEC-076 |
| 4. Claude Code | La de la máquina | Claude Code | El agente | SPEC-076 (apagada por defecto) |

Reglas comunes a todas: la memoria son datos, no órdenes; nunca lleva secretos; cada paso deja registrado exactamente lo que recibió; y lo que cambia de un paso a otro va en el mensaje del usuario, mientras que lo estable va en el prompt de sistema para que se aproveche la caché.

## Cómo lo hacen otros
- **LangGraph** separa la memoria a corto plazo (el estado del hilo, que se guarda con un *checkpointer* y se lee al empezar cada paso) de la memoria a largo plazo en un almacén por espacios de nombres. Esta spec es la primera; la segunda es SPEC-076. [Memoria en LangGraph](https://docs.langchain.com/oss/python/langgraph/memory)
- **Letta (MemGPT)** organiza la memoria que está siempre en contexto en **bloques con nombre y límite de tamaño**, y deja fuera del contexto lo que se consulta bajo demanda. De ahí salen los bloques y sus topes de esta spec. [Memoria de Letta](https://docs.letta.com/guides/agents/memory)
- **Anthropic** recomienda dar al modelo el conjunto más pequeño de información útil, y que los agentes tomen **notas estructuradas** fuera de la conversación. En su sistema de investigación, los subagentes devuelven un resumen condensado y los detalles se quedan en archivos. [Ingeniería de contexto](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) · [Sistema multiagente](https://www.anthropic.com/engineering/built-multi-agent-research-system)

## Decisiones (08/11/2026)
1. **Qué forma tiene la memoria.**
   - *Primera:* seguir con el diario y añadirle las decisiones como otra entrada más.
   - *Revisión:* las decisiones quedarían mezcladas con los resúmenes y se recortarían igual que ellos al pasar del tope, que es justo lo que no puede pasar.
   - *Segunda (elegida):* **bloques fijos**, cada uno con su fuente, su alcance y su tope: Rama, Decisiones, Acuerdos, Notas, Avisos abiertos, Camino, Pasos y Archivos. Lo que un bloque no usa pasa al siguiente.
2. **Quién la escribe.**
   - *Primera:* el Supervisor, como hoy.
   - *Revisión:* entonces todo depende de la IA. Pero casi todo lo útil (qué se decidió, qué se tocó, por dónde fue) ya está en los eventos.
   - *Segunda (elegida):* **los eventos primero**. Seis de los ocho bloques salen de eventos sin IA. El Supervisor solo aporta el resumen de cada paso, y los agentes solo sus notas. Así la memoria funciona con la revisión apagada y es reproducible.
3. **Quién ve qué.**
   - *Primera:* todos ven todo lo que haya cuando arrancan (R60.23).
   - *Revisión:* lo que ve un paso depende de qué ramas acabaron antes, que es cuestión de tiempos y cambia de una ejecución a otra.
   - *Segunda (elegida):* **relevancia por grafo**. Un paso ve lo de sus antecesores y lo global (rama y decisiones). Dos ramas en paralelo nunca se ven, acabe antes la que acabe: lo que recibe un paso deja de depender de los tiempos.
4. **Dónde va en el prompt.**
   - *Primera:* en el prompt de sistema, como hoy.
   - *Revisión:* cambia en cada paso y en cada vuelta, así que el prompt del agente nunca se reutiliza de la caché.
   - *Segunda (elegida):* **en el mensaje del usuario**, antes de la tarea. El prompt de sistema queda igual para todos los pasos del mismo agente.
5. **¿Pueden escribir los agentes?**
   - *Primera:* una herramienta MCP `remember` para que cualquier agente escriba cuando quiera.
   - *Revisión:* es lo que SPEC-060 descartó con razón: crece sin control y las ramas en paralelo se pisan.
   - *Segunda (elegida):* **cada agente puede dejar una nota suya, una vez, al final de su entrega**, con una sección fija y un tope. No escribe en la memoria de otro ni la cambia, y la nota va marcada con su autor.
6. **Vueltas.**
   - *Primera:* guardar todas las vueltas enteras.
   - *Revisión:* un bucle de 10 vueltas llenaría la memoria de lo mismo.
   - *Segunda (elegida):* **la última vuelta entera y las anteriores en una línea** con su resultado («vuelta 2: rechazada — faltaban los tests»).

## Modelo
`RunMemory` (en `core`, sin conocer a Claude) es una función pura de los eventos y del diagrama: `memoryFromEvents(events, diagram)`. Durante la ejecución se mantiene de forma incremental (`MemoryBuilder`, suscrito al bus como el Supervisor) y siempre da lo mismo que la función pura sobre los mismos eventos.

| Bloque | Qué guarda | Fuente | Lo ve | Tope (tokens) |
| --- | --- | --- | --- | --- |
| Rama | La rama de git en la que va el trabajo y quién la creó (R60.26) | `git.branch` | Todos | Sin recorte |
| Decisiones | Cada pregunta respondida por la persona, con su paso y su respuesta; las automáticas (R70.15) marcadas | `agent.question`, `agent.answer`, `confirm.decided`, `correction.routed`, `correction.applied` | Todos | 400 |
| Acuerdos | La sección `## Común` del Coordinador y los archivos declarados de cada rama (SPEC-059) | Salida del Coordinador, `edge.traversed` | Descendientes del Coordinador | 250 |
| Notas | Lo que un paso dejó para los siguientes (R72.11) | `memory.note` | Descendientes del autor | 350 |
| Avisos abiertos | Avisos `warning` de los antecesores que nadie marcó como falsos (R75.21) | `supervisor.alert`, `supervisor.feedback` | Descendientes del paso del aviso | 150 |
| Camino | Rutas elegidas y su motivo, vueltas de bucle con su veredicto, rechazos de revisión | `route.decided`, `loop.iteration`, `decision`, revisiones | Antecesores | 150 |
| Pasos | Por paso: resumen, lo que decidió y su historial de vueltas | `supervisor.note` o resumen determinista (R72.10) | Antecesores | 500 |
| Archivos | Qué archivo tocó qué paso y cómo | `file.produced` | Antecesores | 200 |

Cada entrada guarda su procedencia: `source` (`events`, `supervisor` o `agent`), `nodeId`, `path`, `pass` y el `seq` del evento del que sale.

## Requisitos
### Construcción
- **R72.1** [M15c] `memoryFromEvents(events, diagram)` devuelve los ocho bloques de la tabla, cada entrada con su procedencia. Es pura: no llama al motor ni lee archivos.
- **R72.2** [M15c] El `MemoryBuilder` que se mantiene durante la ejecución da en todo momento el mismo resultado que `memoryFromEvents` sobre los eventos emitidos hasta ese momento. Hay un test que lo comprueba con las grabaciones de SPEC-056.
- **R72.3** [M15c] Lo activa la app (`createEngineOrchestrator`). Un `Orchestrator` sin memoria se comporta como antes, y por eso no cambian las grabaciones de SPEC-056.
- **R72.4** [M15c] Las decisiones incluyen las preguntas de tipo `question`, `unfinished`, `gate`, las confirmaciones con cambios pedidos, las revisiones humanas con su corrección y la corrección de la ejecución (R53.8). No incluyen los permisos (`permission`): son ruido para los siguientes.
- **R72.5** [M15c] Los acuerdos salen de la salida del Coordinador cuando su reparto es válido (`parseSplit`): el texto de `## Común` y, por rama, su nombre y su línea `Archivos:`.
- **R72.6** [M15c] El camino recoge: cada `route.decided` (de qué paso, a cuáles y por qué), cada `loop.iteration` (vuelta, veredicto y motivo) y cada rechazo de una revisión con su corrección. Así el router, el juez de bucle y la revisión dejan rastro (S4).

### Alcance
- **R72.7** [M15c] Un paso ve las entradas de sus **antecesores**: los nodos desde los que hay un camino hacia él por aristas que no son de retorno, en su nivel y, hacia fuera, los antecesores de cada contenedor (bucle o subdiagrama) en el que está.
- **R72.8** [M15c] Un paso también ve las entradas de **pasadas anteriores** de los pasos de su mismo tramo: las vueltas anteriores del cuerpo de su bucle y la pasada anterior de un tramo de retorno (R34.8). Dos ramas en paralelo no se ven nunca entre sí, termine antes la que termine. Las únicas excepciones son la Rama y las Decisiones, que son de toda la ejecución.
- **R72.9** [M15c] La memoria de un paso se calcula al arrancarlo y no cambia entre sus intentos ni sus vueltas de confirmación (como R60.23).

### Resúmenes de los pasos
- **R72.10** [M15c] Sin revisión con IA, el resumen de un paso es el primer párrafo de su salida, recortado a 300 caracteres, marcado como «sin revisar». Con revisión, es el `summary` del Supervisor. Además, `Decider.supervise` devuelve `decided`: hasta 3 decisiones que el paso tomó por su cuenta (p. ej. «eligió PostgreSQL»), de 160 caracteres como máximo. Solo valen las que el paso dice o hace explícitamente; el prompt prohíbe deducirlas.

### Notas de los agentes
- **R72.11** [M15c] Si la salida de un agente termina con la sección `## Notas para los siguientes pasos`, el motor la separa de la salida. Se emite `memory.note` (`nodeId`, `text`) y la salida que viaja al siguiente paso y al entregable ya no la lleva. El encabezado no puede confundirse con `## Para <id>` del reparto (R59.4).
- **R72.12** [M15c] Una nota tiene como mucho 1.200 caracteres; lo que pase se recorta por el final y salta el aviso `note-too-long` (`info`). Va neutralizada (`neutralizeTag`) y marcada con su autor.
- **R72.13** [M15c] El prompt de sistema de todo agente explica la sección, igual en todos los pasos para no romper la caché (R72.18); si el paso no tiene pasos de agente después, la nota se guarda y nadie la recibe. La explicación dice: para lo que los siguientes deben saber y no está en la entrega (algo dejado a medias a propósito, una decisión, un riesgo), como mucho 5 líneas, y que no es para repetir la entrega.

### Lo que recibe el agente
- **R72.14** [M15c] `renderMemory(memory, forStep, budgetTokens)` escribe los bloques visibles para ese paso en este orden: Rama, Decisiones, Acuerdos, Notas, Avisos abiertos, Camino, Pasos y Archivos. Cada bloque lleva un título que dice de dónde sale («Decisiones de la persona», «Notas que dejaron otros pasos (escritas por agentes)», «Resumen de los pasos»).
- **R72.15** [M15c] El tope total es `memoryTokens` (2.000 por defecto, en la nueva sección Ajustes › Memoria). Cada bloque tiene su tope de la tabla; lo que un bloque no usa pasa a los siguientes, en orden. Los tokens se estiman con `estimateTokens`, inyectable (por defecto, caracteres ÷ 3,5).
- **R72.16** [M15c] Al pasarse un bloque: Decisiones acorta cada entrada a 160 caracteres y, si no basta, deja las más recientes y dice cuántas omitió; Pasos deja las más antiguas en una línea y luego las quita (como R63.12); Archivos agrupa por carpeta con su número; Camino y Avisos quitan las más antiguas. Rama nunca se recorta. Nunca se corta una línea por la mitad.
- **R72.17** [M15c] Un paso con varias pasadas aparece una vez en Pasos: la última pasada entera y las anteriores en una línea cada una con su resultado (cambia R63.3).
- **R72.18** [M15c] La memoria va en el mensaje del usuario, entre `<memoria>` y `</memoria>`, antes de la tarea, y nunca en el prompt de sistema. Dos pasos del mismo agente con la misma configuración (tarea aparte) y memorias distintas tienen el mismo prompt de sistema (hay test).
- **R72.19** [M15c] `agent.request` guarda la memoria tal como la recibió el paso (R60.25) y `memoryStats`: los tokens estimados de cada bloque y cuáles se recortaron.

### Persistencia, reanudar y corregir
- **R72.20** [M15c] La ejecución escribe `runs/<runId>/memory.json` (con `schemaVersion`) y `memory.md`, la memoria completa sin topes, al terminar cada paso y al terminar la ejecución, con escritura atómica. `events.jsonl` sigue siendo la fuente: si no coinciden, manda lo que sale de los eventos.
- **R72.21** [M15c] Al reanudar o corregir, los pasos reutilizados vuelven a emitir su rastro (R41.7), incluidos sus `memory.note`, y el `MemoryBuilder` reconstruye sus entradas. Las decisiones de la ejecución anterior entran como decisiones, marcadas «de la ejecución anterior».

### Interfaz
- **R72.22** [M15c] La pestaña «Memoria» (R69.6) enseña los bloques en el orden de R72.14 como grupos de tarjetas (R69.5), con la procedencia de cada entrada: «de los eventos», «del Supervisor» o «de <paso>».
- **R72.23** [M15c] Junto a lo que recibió cada paso (R60.37) se ve la memoria que le llegó, qué bloques se recortaron y un enlace «Ver la memoria completa».
- **R72.24** [M15c] Una nota de un agente se ve en su conversación como tarjeta «Nota para los siguientes pasos».

## Escenarios
- **E72.a** *Dado* que la persona responde «usa PostgreSQL» a una pregunta del paso A, *entonces* el paso C, que no es descendiente de A, recibe esa decisión en «Decisiones de la persona» y no vuelve a preguntarlo.
- **E72.b** *Dado* un Coordinador con dos ramas en paralelo, *entonces* ninguna rama ve las entradas de la otra, y el paso que las junta ve las dos con sus archivos y el `## Común`.
- **E72.c** *Dado* un bucle de 4 vueltas con juez, *entonces* en la vuelta 4 el cuerpo ve «vuelta 1: continuar — falta X», «vuelta 2…» y «vuelta 3…» en una línea cada una.
- **E72.d** *Dado* la revisión con IA apagada, *entonces* la memoria sigue teniendo rama, decisiones, camino, archivos y el primer párrafo de cada paso.
- **E72.e** *Dado* un agente que termina con `## Notas para los siguientes pasos` y «dejé el login sin estilos a propósito», *entonces* el paso siguiente lo recibe como nota del autor y la salida que viaja no la lleva.
- **E72.f** *Dado* los mismos eventos de una ejecución terminada, *entonces* `memoryFromEvents` sobre `events.jsonl` da la misma memoria que se construyó en vivo.

## Cambia
- **R60.18:** la memoria tiene bloques, no solo una entrada por paso.
- **R60.20:** sin revisión, el resumen es el primer párrafo de la salida (R72.10).
- **R60.21:** va en el mensaje del usuario (R72.18).
- **R60.22:** los agentes pueden dejar una nota propia, una vez y con tope (R72.11).
- **R60.23:** lo que ve un paso lo decide el grafo, no qué terminó antes (R72.7–R72.9).
- **R60.24 y R63.12:** el tope se mide en tokens y por bloques (R72.15–R72.16).
- **R63.3:** un paso guarda sus pasadas anteriores en una línea (R72.17).

## Fuera de alcance
- Memoria entre ejecuciones (SPEC-076).
- Buscar en la memoria con una herramienta: con el tope de R72.15 cabe entera en la mayoría de ejecuciones. Se valorará si las mediciones de R72.19 dicen que se recorta a menudo.
- Que un agente edite o borre lo que escribió otro.
