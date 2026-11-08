# SPEC-071 · Reintentos con contexto

**Estado:** Borrador · **Hito:** M15b · **Paquetes:** `core`, `claude`, `runtime`, `editor`, `ui` · **Rama:** `feature/reintentos`

## Propósito
La auditoría del 08/11 (hallazgos P4, P5 y P7) encontró que reintentar es hoy **volver a empezar a ciegas**:
- `buildUserPrompt` no le dice al siguiente intento qué error hubo ni qué hizo el anterior. Si el intento 1 escribió la mitad de los archivos y se cortó, el intento 2 los encuentra sin saber de dónde salen.
- Los archivos que dejó el intento fallido se quedan como estaban. No hay forma de volver al punto de partida, aunque las copias de seguridad de R31.6 lo permitirían.
- La espera entre intentos (1 s, 2 s, 4 s) no tiene jitter ni respeta `retry-after`. Cuatro ramas que reciben un 429 a la vez reintentan a la vez y vuelven a chocar.
- Qué es reintentable se decide con una expresión regular sobre el texto del error.
- Las decisiones (router, condiciones, juez, transformar) **no se reintentan nunca**: un 529 en un router falla el paso como definitivo.

Esta spec es también la **capa 1 de la memoria** (la del intento): lo que un intento le deja al siguiente.

## Cómo lo hacen otros
- **Temporal** distingue errores reintentables y no reintentables por tipo, no por texto, y aplica espera exponencial con tope. Cada intento sabe su número y el último fallo.
- La guía de AWS sobre espera exponencial recomienda **jitter completo** (esperar un valor aleatorio entre 0 y el tope) para que los clientes que fallan a la vez no reintenten a la vez.
- La API de Anthropic devuelve `retry-after` en los 429 y 529; respetarlo evita gastar intentos dentro de la ventana de limitación.
- El Agent SDK ofrece `resume` de sesión y `rewindFiles` para volver atrás los cambios de archivos de una consulta; hay que probar si sirven aquí antes de usarlos (ver Fuera de alcance). [Referencia del SDK de TypeScript](https://platform.claude.com/docs/en/agent-sdk/typescript)

## Decisiones (08/11/2026)
1. **Qué recibe el siguiente intento.**
   - *Primera:* la transcripción entera del intento anterior.
   - *Revisión:* puede ser enorme, cuesta en cada intento y arrastra el razonamiento que llevó al fallo.
   - *Segunda (elegida):* **un resumen determinista** sin IA: el error, cómo acabó (cortado, error de Claude, faltó lo obligatorio), las últimas acciones y los archivos que dejó tocados. Con un tope.
2. **Qué hacer con lo que dejó el intento fallido.**
   - *Primera:* restaurar siempre los archivos al estado de antes del intento.
   - *Revisión:* muchas veces lo escrito es bueno y el corte llegó al final (un timeout en el último comando). Restaurar tiraría trabajo pagado.
   - *Segunda (elegida):* **conservar por defecto y decírselo al agente**, que sabe qué archivos son suyos y puede revisarlos. Cada paso puede elegir «Volver al punto de partida antes de reintentar», que restaura lo modificado con la copia de R31.6 y borra lo creado.
3. **Cómo clasificar los errores.**
   - *Primera:* seguir con la expresión regular y ampliarla.
   - *Revisión:* depende del idioma y del formato del mensaje, y no distingue un límite de uso (esperar) de un fallo del servidor (reintentar pronto).
   - *Segunda (elegida):* `AgentError` lleva **un tipo**: `rate_limit`, `overloaded`, `transient`, `timeout`, `unmet` (faltó lo obligatorio) o `fatal`. La expresión regular queda solo como último recurso cuando el SDK no da código.
4. **Límites de uso.** Un 429 no es culpa del agente. Se espera lo que diga `retry-after` (o la espera exponencial, lo que sea mayor), y estos reintentos tienen su propia cuenta (5 por defecto) para no consumir los 3 del paso.
5. **Decisiones.** Se reintentan con la misma política y su propia cuenta (3). Una decisión que sigue fallando falla el paso, como hoy.

## Requisitos
### Clasificación y espera
- **R71.1** [M15b] `AgentError` tiene `kind: 'rate_limit' | 'overloaded' | 'transient' | 'timeout' | 'unmet' | 'fatal'` y `retryAfterMs?`. `retriable` se deriva del tipo: todos salvo `fatal`.
- **R71.2** [M15b] El adaptador de Claude asigna el tipo desde el código del SDK (`rate_limit`, `server_error`, `overloaded_error`, `authentication_failed`, `billing_error`, `invalid_request`) y desde el estado HTTP; lee `retry-after` cuando viene. La expresión regular de `errors.ts` solo se usa si no hay ni código ni estado.
- **R71.3** [M15b] La espera tras el intento `n` es un valor aleatorio entre `0` y `min(maxDelayMs, baseDelayMs · 2^(n−1))` (jitter completo). `maxDelayMs` es 60 s por defecto. El generador aleatorio se inyecta para los tests.
- **R71.4** [M15b] Con `retryAfterMs`, la espera es `max(retryAfterMs, la de R71.3)`, con un tope de 10 minutos.
- **R71.5** [M15b] Los errores `rate_limit` y `overloaded` tienen su propia cuenta de intentos (`retry.limitAttempts`, 5 por defecto), separada de `maxAttempts`. Un paso puede acumular ambas.
- **R71.6** [M15b] `node.retrying` añade `kind` (el tipo del error) y `cause: 'error' | 'timeout' | 'loop'` (los dos últimos vienen de SPEC-070).

### Lo que recibe el siguiente intento
- **R71.7** [M15b] Tras un intento fallido, el motor arma `previousAttempt`: número, tipo y mensaje del error; cómo acabó (`error`, `timeout`, `loop`, `unmet` o `interrupted`, este último al reanudar, R74.5); sus 10 últimas acciones; y los archivos que tocó con su cambio (`created`, `modified`, `deleted`), con si se restauraron (R71.10).
- **R71.8** [M15b] `AgentRequest.previousAttempt` lo lleva al adaptador, y `agent.request` lo registra. El prompt de usuario añade la sección «Intento anterior», marcada como datos: qué pasó, qué archivos dejó y la indicación de revisar esos archivos antes de rehacerlos. Tope: 3.000 caracteres, recortados por el medio (`clipMiddle`).
- **R71.9** [M15b] Solo viaja el intento inmediatamente anterior, no todos. Las respuestas de la persona siguen llegando todas (`previousAnswers`, R32.2).

### Volver al punto de partida
- **R71.10** [M15b] Un paso puede tener `onRetry: 'keep' | 'restore'` (`keep` por defecto). Con `restore`, antes del siguiente intento se restauran desde la copia de R31.6 los archivos que el intento fallido modificó o borró, y se borran los que creó. Emite `files.restored` (`nodeId`, `attempt`, `restored`, `removed`, `failed`).
- **R71.11** [M15b] Restaurar nunca toca archivos que el intento no tocó, ni archivos que otro paso cambió después (se compara el hash con el que dejó el intento). Los que no se pueden restaurar van en `failed` y el siguiente intento los recibe como «tocados, sin restaurar».
- **R71.12** [M15b] Los archivos que cambiaron comandos de Bash (R55.1, `via: 'command'`) no tienen copia: con `restore` se listan en `failed` con el motivo «cambiado por un comando».

### Decisiones
- **R71.13** [M15b] `route`, `condition`, `conditions`, `judge`, `judgeReview`, `blame` y `transform` se llaman a través de la `RetryPolicy` con `decisionAttempts` (3 por defecto) y la espera de R71.3–R71.5. Cada reintento emite `node.retrying` del nodo que decide.
- **R71.14** [M15b] El uso de cada intento de decisión cuenta en el presupuesto aunque el intento falle, si el motor lo conoce (R63.15).

### Interfaz
- **R71.15** [M15b] La conversación del paso enseña cada reintento como un separador: «Intento 2 · el anterior se cortó por inactividad» con el error desplegable y lo que se le pasó al nuevo intento.
- **R71.16** [M15b] El lateral del paso tiene «Al reintentar»: «Conservar lo que hizo» o «Volver al punto de partida», con una línea que explica que lo cambiado por comandos no se puede deshacer.

## Escenarios
- **E71.a** *Dado* un intento que escribió `a.ts` y `b.ts` y se cortó por inactividad, *entonces* el intento 2 recibe «se cortó por inactividad; dejaste modificados a.ts y b.ts» y los revisa antes de seguir.
- **E71.b** *Dado* `onRetry: 'restore'` y un intento que modificó `a.ts`, *entonces* antes del intento 2 `a.ts` vuelve a su contenido original y el intento 2 no recibe a.ts como tocado.
- **E71.c** *Dado* cuatro ramas que reciben un 429 con `retry-after: 20`, *entonces* ninguna reintenta antes de 20 s, no reintentan a la vez y no gastan sus 3 intentos.
- **E71.d** *Dado* un router que recibe un 529 y luego responde, *entonces* el paso sigue con la ruta elegida y hay un `node.retrying` del router.

## Cambia
- **R7.5:** la espera pasa a ser con jitter y tope (R71.3); hay cuenta aparte para límites de uso (R71.5).
- **R27.6:** qué es reintentable se decide por tipo (R71.1–R71.2).

## Fuera de alcance
- Reanudar la sesión del SDK (`resume`) en vez de abrir una nueva, y `rewindFiles`. Ahorrarían contexto, pero hay que probar con el SDK real cómo se comportan tras un corte. Se valorará en una spec aparte.
- Reintentos a nivel de ejecución entera (eso es reanudar, SPEC-074).
