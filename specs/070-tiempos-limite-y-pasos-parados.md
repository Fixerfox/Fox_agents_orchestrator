# SPEC-070 · Tiempos límite y pasos parados

**Estado:** Borrador · **Hito:** M15a · **Paquetes:** `core`, `claude`, `runtime`, `editor`, `ui` · **Rama:** `feature/tiempos-limite`

## Propósito
La auditoría del 08/11 («Auditoría de la pipeline de ejecución, Supervisor y memoria», hallazgos P2 y S5) encontró que **ninguna ejecución tiene garantizado terminar**:
- Un paso de agente no tiene tiempo máximo ni latido. Si el proceso de Claude se queda colgado, o un comando de Bash no vuelve, el paso sigue «en marcha» para siempre.
- `questionTimeoutMs` no tiene valor por defecto, y el gancho de permisos espera hasta 24 horas (`HOOK_TIMEOUT_S`). Una pregunta que nadie ve deja la ejecución abierta y ocupando sus copias.
- Las decisiones (router, condiciones, juez de bucle, transformar) no tienen tiempo máximo.
- Un agente que repite la misma acción una y otra vez gasta presupuesto sin avanzar, y ninguna regla lo ve.

En un orquestador profesional (Temporal, Airflow, Step Functions) cada actividad tiene un tiempo máximo y un latido, y lo que se pasa de ahí cuenta como fallo reintentable. Esta spec trae eso al motor sin cambiar el modelo de pasos.

## Decisiones (08/11/2026)
1. **Qué cuenta como «parado».**
   - *Primera:* un tiempo máximo por paso (p. ej. 30 minutos).
   - *Revisión:* hay pasos legítimos de horas (una implementación grande) y pasos que se cuelgan a los dos minutos. Un único tope o corta trabajo bueno o llega tarde.
   - *Segunda (elegida):* **latido por inactividad**. Lo que mide el motor es el tiempo sin señales de vida del agente. El tiempo máximo total existe, pero es opcional y por paso.
2. **Un comando largo no es inactividad.**
   - *Primera:* cualquier evento reinicia el latido.
   - *Revisión:* un `npm test` de 20 minutos no emite nada entre `tool.called` y `tool.result`; con un latido de 10 minutos se cortaría.
   - *Segunda (elegida):* **dos umbrales**. Uno sin herramienta en curso (el modelo debería estar hablando o llamando a algo) y otro, mayor, mientras hay una herramienta en curso.
3. **Qué pasa al pasarse.**
   - *Primera:* fallar el paso.
   - *Revisión:* casi siempre es un cuelgue pasajero del proceso o de la red, y el siguiente intento suele ir bien.
   - *Segunda (elegida):* **el intento se cancela con un error reintentable**. Entra en la `RetryPolicy` como cualquier otro, y el siguiente intento sabe por qué se cortó el anterior (SPEC-071). Antes de cortar se avisa a mitad de camino.
4. **Preguntas que nadie responde.**
   - *Primera:* poner un tiempo máximo por defecto y fallar el paso.
   - *Revisión:* lo normal es que la persona esté y tarde; fallar tras 30 minutos tiraría trabajo pagado. Pero sin ningún límite, una ejecución lanzada antes de irse a casa queda abierta toda la noche.
   - *Segunda (elegida):* **política por ejecución** con tres opciones: esperar (por defecto), tomar la respuesta segura de la pregunta o fallar el paso. Siempre hay un **recordatorio** del sistema (SPEC-061) a los 15 minutos.
5. **La respuesta segura la decide quien pregunta, no el motor.** Para un permiso la segura es denegar. Para «no terminó lo pedido» es «Parar la ejecución». Una pregunta sin respuesta segura (la mayoría de las del agente) hace fallar el paso si la política no es esperar. Así nunca se aprueba nada por omisión.
6. **Bucle de herramientas.** La regla avisa y, si sigue, corta el intento como en la decisión 3. No bloquea la herramienta concreta: el motor no sabe si repetir era necesario (p. ej. esperar a que algo aparezca).

## Requisitos
### Latido de los pasos de agente
- **R70.1** [M15a] Cuentan como actividad de un intento de agente: `token.stream`, `tool.called`, `tool.result`, `file.produced`, `agent.usage`, `knowledge.used` y `knowledge.unmet`. Cada una reinicia su reloj de inactividad.
- **R70.2** [M15a] El reloj tiene dos umbrales: `idleMinutes` (sin herramienta en curso, 10 por defecto) y `toolMinutes` (con alguna herramienta entre `tool.called` y su `tool.result`, 30 por defecto). Lo que vale es el umbral del estado en que está el intento.
- **R70.3** [M15a] El reloj se detiene mientras el paso espera a la persona (pregunta, permiso, confirmación o revisión) y mientras la ejecución está en pausa. Vuelve a cero al seguir.
- **R70.4** [M15a] A la mitad del umbral se emite `supervisor.alert` con la regla `stalled`, `severity: 'info'`, y el detalle «Sin actividad desde hace N min» (con la herramienta en curso, si la hay).
- **R70.5** [M15a] Al llegar al umbral, el motor cancela el intento (aborta su señal propia, no la de la ejecución) y lo trata como `AgentError` reintentable con el mensaje «El paso no dio señales de vida en N min». Emite `node.timeout` (`nodeId`, `attempt`, `kind: 'idle' | 'tool' | 'total' | 'loop'`, `minutes`, `tool?`) antes del `error`.
- **R70.6** [M15a] Un paso puede tener `limits.maxMinutes`: la duración máxima de **cada intento**, sin contar la espera a la persona. Al llegar se actúa como en R70.5 con `kind: 'total'`. Sin valor no hay tope.
- **R70.7** [M15a] Los valores de R70.2 y R70.6 se toman, por orden: del paso (`node.limits`), de la ficha del agente (`limits`) y de Ajustes («Límites de tiempo»). Ajustes valida que `idleMinutes` esté entre 2 y 120 y `toolMinutes` entre 5 y 480.
- **R70.8** [M15a] Cancelar un intento por tiempo no deja procesos de Claude vivos: el adaptador aborta su `AbortController` y el intento se da por cerrado aunque el SDK tarde en devolver el control (máximo 10 s de gracia; después se abandona el iterador).
- **R70.9** [M15a] Los relojes usan el `now` y el `sleep` inyectables del orquestador, para probarlos sin esperar.

### Bucle de herramientas
- **R70.10** [M15a] Regla `tool-loop` (función pura de `applyRules`): un intento llama a la misma herramienta con la misma entrada (comparada tras normalizar espacios) 4 veces seguidas sin que cambie ningún archivo entre medias. Da `supervisor.alert` con `severity: 'warning'`.
- **R70.11** [M15a] Si llega a 8 veces seguidas, el motor corta el intento como en R70.5, con `node.timeout` `kind: 'loop'` y el mensaje «Repitió la misma acción 8 veces sin avanzar».

### Decisiones
- **R70.12** [M15a] Cada llamada a `Decider.route`, `condition`, `conditions`, `judge`, `judgeReview`, `blame` y `transform` tiene un tiempo máximo de 120 s (`decisionTimeoutMs` en `RunOptions`). Al pasarse se cancela su consulta y cuenta como error reintentable (los reintentos son de SPEC-071).

### Preguntas
- **R70.13** [M15a] `AgentQuestion` admite `fallback`: la opción que se elige si la política lo permite. El motor la pone en las suyas: permisos → la opción de denegar; `unfinished` → «Parar la ejecución»; `gate` (R39.4) → «Que lo rehaga». Las preguntas del agente y las confirmaciones no llevan `fallback`.
- **R70.14** [M15a] `RunOptions.unanswered` = `{ afterMinutes, action: 'wait' | 'fallback' | 'fail' }`. Por defecto `{ afterMinutes: 60, action: 'wait' }`; con `wait`, `afterMinutes` no se usa. Con `fallback`, al cumplirse el tiempo se responde con `fallback` si la pregunta lo tiene, y si no se falla el paso; con `fail`, se falla el paso.
- **R70.15** [M15a] Una respuesta automática emite `agent.answer` con `auto: true` y queda en la conversación del paso como «Respondida automáticamente: nadie respondió en N min».
- **R70.16** [M15a] A los 15 minutos de una pregunta sin responder llega un recordatorio del sistema (SPEC-061) con el paso y la pregunta. Solo uno por pregunta.
- **R70.17** [M15a] El gancho de permisos de Claude (`HOOK_TIMEOUT_S`) deja de ser el límite real: su espera la gobierna R70.14. El valor del SDK queda como tope técnico.
- **R70.18** [M15a] `questionTimeoutMs` se sustituye por `unanswered`. Las ejecuciones que lo pasaban se migran a `{ afterMinutes: questionTimeoutMs / 60000, action: 'fail' }`.

### Interfaz
- **R70.19** [M15a] El diálogo «Lanzar» tiene «Si nadie responde» con las tres opciones y el tiempo; la elegida se recuerda por diagrama.
- **R70.20** [M15a] El paso enseña «Sin actividad desde hace N min» desde el aviso de R70.4, y «Cortado por inactividad, se reintenta» tras R70.5.
- **R70.21** [M15a] Ajustes tiene la sección «Límites de tiempo» (inactividad, herramienta en curso, decisiones y la política de preguntas por defecto). La ficha del agente y el paso pueden cambiar los dos primeros y `maxMinutes`.

## Escenarios
- **E70.a** *Dado* un agente que lanza `npm test` y tarda 20 minutos, *entonces* no se corta (umbral de herramienta, 30 min) y no salta `stalled` hasta los 15.
- **E70.b** *Dado* un proceso de Claude que deja de emitir sin herramienta en curso, *entonces* a los 5 min hay aviso `stalled`, a los 10 se corta el intento y el siguiente intento recibe por qué (SPEC-071).
- **E70.c** *Dado* un permiso sin responder con la política `fallback` a 30 min, *entonces* se deniega solo, el agente sigue por otro camino y la conversación lo dice.
- **E70.d** *Dado* que un agente pregunta «¿qué base de datos uso?» con la política `fallback`, *entonces* al pasar el tiempo el paso falla: la pregunta no tiene respuesta segura.
- **E70.e** *Dado* un agente que lee el mismo archivo 8 veces seguidas, *entonces* hay aviso a la cuarta y el intento se corta a la octava.

## Cambia
- **R7.2:** la pausa también detiene los relojes de esta spec.
- **R62.8** no cambia: la revisión del Supervisor sigue con sus 60 s.

## Fuera de alcance
- Tiempos máximos de la ejecución entera. Se consiguen con el presupuesto (SPEC-077) y con `maxMinutes` por paso.
- Matar comandos concretos de Bash que siguen tras cortar el intento: es cosa del SDK. Se comprueba con el SDK real antes de aprobar la spec.
