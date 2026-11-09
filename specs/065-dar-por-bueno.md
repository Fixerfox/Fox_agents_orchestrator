# SPEC-065 · Lo que solo puede comprobar una persona, «Dar por bueno» y hablar de una ejecución

**Estado:** Implementada (M13) · **Hito:** M13 · **Paquetes:** `core`, `claude`, `store`, `runtime`, `editor`, `ui`, `apps/desktop` · **Rama:** `feature/dar-por-bueno`

## Propósito
El 07/11 una ejecución acabó «Falló» con este motivo de la comprobación final: «La medición real de 30 minutos de quickstart.md (SC-005) no se hizo: solo hay una estimación…». Esa medición solo la puede hacer una persona, y ningún agente podía cumplirla. El usuario preguntó por qué se da por malo algo que solo puede revisar un humano. Propuso que eso acabe como un aviso, y que ante un fallo se pueda hablar con el asistente o dar el trabajo por bueno. Al pedirle al asistente que diera esa ejecución por buena, contestó que no tenía cómo hacerlo, y el usuario pidió que pueda hacerlo cuando se le pide. También pidió un botón de asistente en el aviso del final de cualquier ejecución, para hablar de ella.

SPEC-063 (decisión 5) mantuvo que la comprobación final hace fallar la ejecución. Esta spec no lo cambia para lo que de verdad falta: separa lo que solo puede hacer una persona y da a la persona la última palabra.

## Decisiones (07/11/2026)
1. **Qué hacer con lo que solo puede comprobar una persona.**
   - *Primera:* que la comprobación final no haga fallar nunca, solo avisar.
   - *Revisión:* vuelve el caso del paso que hizo 1 de 44 tareas y la ejecución salía «Terminada bien».
   - *Segunda (elegida):* **tres resultados**: cumple, no cumple, y lo que queda **para una persona** (medir en la vida real, probar a mano, aprobar algo visual, decidir). Si solo falta esto último, la ejecución termina bien con el aviso «Te toca comprobarlo». Lo que de verdad falta sigue haciéndola fallar.
2. **Es una regla del Supervisor que se puede cambiar.**
   - *Primera:* fijo en el prompt.
   - *Revisión:* el usuario lo planteó como una regla, y hay quien prefiere que falle.
   - *Segunda (elegida):* un ajuste del Supervisor, «Lo que solo puede comprobar una persona»: **«Avisar»** (por defecto) o «Hacer fallar la ejecución».
3. **«Dar por bueno» no reescribe la historia.**
   - *Primera:* cambiar el estado guardado a «terminada bien».
   - *Revisión:* se perdería por qué falló, y el registro dejaría de contar lo que pasó.
   - *Segunda (elegida):* se **añade** al registro un evento `run.accepted` (quién, por qué y el motivo del fallo), como hace «cancelar una interrumpida» (R41.3). La ejecución pasa a verse como terminada bien, con «Aceptada por ti» o «Aceptada por el asistente» y el motivo. El fallo original sigue en el registro y en la pestaña «Supervisor». Solo vale para una ejecución fallida que no está en marcha.
4. **El asistente puede darla por buena, pero siempre con «Permitir».**
   - *Primera:* como el resto de sus herramientas, que en «Sin preguntar nunca» no piden permiso (SPEC-051).
   - *Revisión:* anula el veredicto del Supervisor, y un asistente que se equivoca de ejecución no debería poder hacerlo sin que la persona lo vea.
   - *Segunda (elegida):* la herramienta `accept_run` pide **siempre** «Permitir», sea cual sea el nivel de permisos, y su descripción dice que solo se usa cuando la persona lo pide.
5. **«Hablar con el asistente».** En el aviso del final, para cualquier ejecución terminada (bien, mal, cancelada o interrumpida), abre el asistente con una petición que ya lleva el id de la ejecución. El asistente la lee con `get_run`, sin copiar el registro en el chat.
6. **Reanudar una aceptada.** Ya terminó bien: no se reanuda.

## Requisitos
### Comprobación final
- **R65.1** [M13] `RunVerdict` tiene `forPerson?: string`: lo que solo puede hacer o comprobar una persona. El prompt de `verifyRun` del motor de Claude dice que eso no es una falta de los agentes, que va en `forPerson` y no en `missing`, y que si solo falta eso, `met` es `true`. Su respuesta JSON incluye `forPerson`.
- **R65.2** [M13] `AppSettings.supervisorHumanChecks?: 'warn' | 'fail'`, `'warn'` por defecto, validado y normalizado como el resto de los ajustes. `supervisorHumanChecks(settings)` devuelve el valor efectivo.
- **R65.3** [M13] Con `'warn'`: si `verifyRun` devuelve `met: true` y `forPerson`, la ejecución termina `succeeded`, `supervisor.verified` lleva `forPerson`, y queda el aviso `needs-person` (gravedad `warning`) con ese texto. Con `'fail'`: `forPerson` cuenta como falta y la ejecución acaba `failed` con «No cumple lo pedido: …», juntando lo que falta y lo que queda para una persona.
- **R65.4** [M13] El Resumen y la pestaña «Supervisor» dicen «Te toca comprobarlo» con el texto. El aviso `needs-person` tiene su título y su explicación. El aviso del final de una ejecución que terminó bien con algo para una persona lo dice: «Terminada · te toca comprobar algo». Ajustes del Supervisor tiene «Lo que solo puede comprobar una persona» con «Avisar» y «Hacer fallar la ejecución».

### Dar por bueno
- **R65.5** [M13] `RunRepository.acceptRun(runId, { by, reason })` añade al registro `run.accepted` (`by: 'user' | 'assistant'`, `reason`, `previousReason`) y actualiza `meta.json` (`status: 'succeeded'`, `accepted: { by, reason, at, previousReason }`). Devuelve `false` si la ejecución no había fallado. El almacén de archivos y el doble de pruebas lo implementan.
- **R65.6** [M13] `RunService.accept(runId, { by, reason })` rechaza una ejecución en marcha y exige un motivo (de 1 a 2000 caracteres). El contrato IPC tiene `acceptRun` (`run:accept`), con sus argumentos validados, y `memoryApi` y la app de escritorio lo implementan.
- **R65.7** [M13] `summarizeRun` trata `run.accepted` como terminada bien: `status: 'succeeded'`, `accepted: { by, reason, previousReason }` y el titular «Aceptada por ti: …» o «Aceptada por el asistente: …». `RunSummary` (la lista) lleva `accepted`, y una aceptada no se puede reanudar.
- **R65.8** [M13] El aviso del final de una ejecución fallida tiene «Dar por bueno». Abre una ventana que pide el motivo («¿Por qué lo das por bueno?», obligatorio). Al confirmar, la ejecución se ve aceptada, y la vista dice «Aceptada por ti» con el motivo y el fallo original.

### Asistente
- **R65.9** [M13] El asistente tiene `accept_run` (`runId`, `reason`). Llama a `acceptRun` con `by: 'assistant'` y pide «Permitir» siempre, aunque el proyecto no pida confirmar acciones. Su descripción dice que solo se usa cuando la persona lo pide. `list_runs` y `get_run` dicen si una ejecución está aceptada.
- **R65.10** [M13] El aviso del final de una ejecución terminada tiene «Hablar con el asistente». Abre el asistente con la petición «Quiero hablar de la ejecución <runId> (<diagrama>, <estado>).», sin salir de la pantalla.

## Fuera de alcance
- Deshacer una aceptación.
- «Dar por bueno» un solo paso dentro de una ejecución; para eso ya está «Pedir corrección».
