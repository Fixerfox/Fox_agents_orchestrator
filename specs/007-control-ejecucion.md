# SPEC-007 · Control de ejecución: pausa, cancelación, presupuesto y reintentos

**Estado:** Implementada (M1) · **Hito:** M1 · **Paquete:** `core`

## Requisitos
- **R7.1** [M1] `cancel()` aborta los agentes en curso mediante `AbortSignal`; los nodos en curso terminan `cancelled`; se emite `run.cancelled` antes de `run.finished`, con estado `cancelled`.
- **R7.2** [M1] `pause()` impide iniciar nodos y procesar nuevos eventos de agentes hasta `resume()`; emite `run.paused` y `run.resumed`. Ambas operaciones son idempotentes. La pausa es cooperativa (no interrumpe a mitad de un paso).
- **R7.3** [M1] Cancelar durante una pausa funciona y libera la ejecución.
- **R7.4** [M1] Presupuesto: al llegar a `maxTokens` (entrada + salida) o a `maxCostUsd` se emite una sola vez `run.budget_reached`, se aborta la ejecución, el estado es `failed` con `reason: 'budget_exceeded'` y no empiezan nodos posteriores.
- **R7.5** [M1] Reintentos: ante un error `retriable` se reintenta hasta `maxAttempts` intentos totales (3 por defecto) con espera `baseDelayMs · 2^(n−1)`; cada reintento emite `node.retrying`; agotados los intentos el nodo falla.
- **R7.6** [M1] Un error no `retriable` falla el nodo en el primer intento, sin reintentos.
- **R7.7** [M1] Cada intento emite `agent.request` (con `attempt`) y cada fallo emite `error`.
- **R7.8** [M4b] Pausar y reanudar por nodo individual. *(La pausa global ya existe; la de un solo nodo llega con la UI.)*

## Escenarios
- **E7.a** *Dado* un agente que falla 2 veces con error temporal, *cuando* se ejecuta con 3 intentos, *entonces* se emiten 2 `node.retrying` (esperas 1× y 2× la base) y el nodo termina `succeeded`.
- **E7.b** *Dado* un presupuesto de 50 tokens y un agente que consume 100, *entonces* la ejecución termina `failed` con `budget_exceeded` y el nodo siguiente nunca empieza.
