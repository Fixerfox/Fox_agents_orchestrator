# SPEC-085 · Acciones del asistente fiables

**Estado:** Implementada · **Hito:** M16d · **Paquetes:** `ui` · **Rama:** `feature/modo-prueba-mcp`

## Propósito
En una prueba real con el modo prueba (SPEC-082), las acciones del asistente (SPEC-029), que también usa el modo prueba, fallaron así:
1. `remove_step` quitó un paso del medio de una cadena y dejó la Salida desconectada. Además, si el paso no existe, dice que lo quitó.
2. Después, `add_step` sin `after` dijo «hay varias conexiones que llegan a Salida» cuando no llegaba ninguna.
3. `run_diagram` respondió `started: true` con un diagrama no válido, y no arrancó nada.

Quien usa estas acciones es un agente: necesita que el resultado diga la verdad para poder corregirse.

## Decisiones (09/11/2026)
1. **Quitar un paso de una cadena.**
   - *Primera:* reconectar siempre cada paso anterior con cada siguiente.
   - *Revisión:* con varias entradas o salidas, o con salidas de revisión y condiciones, inventaría conexiones que nadie pidió.
   - *Segunda (elegida):* **reconectar solo si el paso tenía una conexión de entrada y una de salida**. Si no, se quita y el resultado dice qué pasos quedaron sin salida o sin entrada.
2. **Validar antes de lanzar.** `run_diagram` comprueba el diagrama con `validateDiagram`, lo mismo que el lanzador, y falla con todos los problemas. Si aun así no arranca, falla también.

## Requisitos
- **R85.1** [M16d] `remove_step` con un paso que no existe falla con «No existe el paso «<id>»». Con la Entrada o la Salida falla con «La Entrada y la Salida no se pueden quitar».
- **R85.2** [M16d] Si el paso tenía exactamente una conexión de entrada y una de salida, `remove_step` conecta el paso anterior con el siguiente, conservando la salida (`port`) y la condición de la conexión de entrada, salvo que esa conexión ya exista. El resultado dice `reconnected: { from, to }`.
- **R85.3** [M16d] En los demás casos, `remove_step` quita el paso y, en `disconnected`, lista los pasos que se quedaron sin ninguna conexión de salida o de entrada.
- **R85.4** [M16d] `add_step` y `add_parallel` sin `after`: si ninguna conexión llega a la Salida, fallan con «Ninguna conexión llega a la Salida: indica tras qué paso va (after)»; si llegan varias, con el mensaje de siempre.
- **R85.5** [M16d] `run_diagram` valida el diagrama abierto con `validateDiagram`. Con problemas falla con «El diagrama no se puede ejecutar:» y la lista, sin lanzar nada.
- **R85.6** [M16d] `run_diagram` devuelve `{ started: true, runId }`. Si la app no consigue lanzar la ejecución, falla con «No se pudo lanzar la ejecución» (el motivo lo enseña la app).
