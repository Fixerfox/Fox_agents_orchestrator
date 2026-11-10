# SPEC-084 · El bucle conserva la petición y el criterio

**Estado:** Implementada · **Hito:** M16c · **Paquetes:** `core`, `claude`, `runtime` · **Rama:** `feature/modo-prueba-mcp`

## Propósito
En una prueba real con el modo prueba (SPEC-082), un bucle «hasta que el evaluador diga que basta» con un poeta dentro dio tres vueltas:
- En la vuelta 1, el poeta no sabía que el haiku tenía que decir «azul»: el criterio del bucle solo lo ve el evaluador.
- Desde la vuelta 2, el poeta recibe como entrada su haiku anterior y nada más. La petición original («un haiku sobre un zorro al amanecer») ya no le llega.

La memoria de la ejecución (SPEC-072) le pasa los motivos del evaluador, pero puede estar recortada o apagada, y no lleva ni la petición ni el criterio.

## Decisiones (09/11/2026)
1. **Cómo llega.**
   - *Primera:* reescribir la entrada de la vuelta («Petición original… Resultado anterior…»).
   - *Revisión:* cambiaría lo que reciben las transformaciones por reglas (`{{entrada}}`) y lo que guarda la ejecución como entrada de cada paso.
   - *Segunda (elegida):* **un bloque aparte**, como la memoria: «## Estás dentro de un bucle», en el mensaje del usuario y antes de la tarea. La entrada no cambia.
2. **Qué lleva.** Por cada bucle que contiene el paso, de fuera a dentro:
   - la vuelta y el máximo;
   - el criterio del evaluador, si lo hay;
   - la petición con la que empezó el bucle, salvo que sea justo la entrada del paso;
   - desde la vuelta 2, el motivo del evaluador en la vuelta anterior y que la entrada es el resultado de esa vuelta.
3. **Grabaciones.** Las grabaciones de SPEC-056 tienen bucles. El bloque solo se añade si la app lo pide (`loopContext`), igual que la memoria.

## Requisitos
- **R84.1** [M16c] `loopContext(frames)` (pura, en `core`) devuelve el bloque de texto, o nada sin marcos. Cada marco es `{ label, round, max, mode, criterion?, request, lastReason? }`. El texto empieza por «## Estás dentro de un bucle» y, por cada marco:
  - `Bucle «<label>»: vuelta <round> de <max>` (en modo `ai-judge`, «de <max> como máximo»);
  - en modo `ai-judge`, «Termina cuando un evaluador confirme: <criterion>»;
  - «Petición con la que empezó el bucle:» y la petición, recortada a `LOOP_REQUEST_MAX` (4.000) caracteres con «…»;
  - desde la vuelta 2, «Tu entrada es el resultado de la vuelta anterior: mejóralo, no empieces de cero.» y, si lo hay, «En la vuelta anterior el evaluador dijo que aún no basta: <lastReason>», recortado a `LOOP_REASON_MAX` (1.000) caracteres.
- **R84.2** [M16c] `loopContext(frames, inputText)` omite la petición de un marco cuando es igual a `inputText` (sin espacios al principio ni al final), para no repetir lo que el paso ya recibe como entrada.
- **R84.3** [M16c] Con `loopContext: true` en `OrchestratorDeps`, el nodo bucle actualiza su marco antes de cada vuelta: la petición es la entrada de la vuelta 1, y `lastReason` es el motivo del evaluador de la vuelta anterior (en modo `count`, nada).
- **R84.4** [M16c] Cada paso de agente dentro del cuerpo de uno o varios bucles recibe el bloque en `AgentRequest.loop`, y el evento `agent.request` lo guarda en `loop`. Fuera de un bucle, o sin `loopContext`, no hay campo.
- **R84.5** [M16c] El adaptador de Claude pone el bloque en el mensaje del usuario, después de la memoria y antes de la tarea.
- **R84.6** [M16c] La app (`runtime`) arranca el orquestador con `loopContext: true`.

## Casos
- **E84.a** *Dado* un bucle `ai-judge` con criterio «menciona azul» y un agente dentro, con un evaluador que dice «no» y luego «sí», *entonces* la vuelta 1 recibe el criterio sin la petición (es su entrada), y la vuelta 2 recibe el criterio, la petición original y el motivo del «no».
