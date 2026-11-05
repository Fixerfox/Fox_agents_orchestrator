# SPEC-046 · Entregable de la ejecución

**Estado:** Implementada (M8g) · **Hito:** M8g · **Paquetes:** `core`, `claude`, `store`, `runtime`, `editor`, `ui`, `desktop`

## Propósito
El usuario pidió el 05/11 poder definir, antes de ejecutar, qué quiere recibir al final: un enlace a lo generado, un resumen en `.md` o lo que sea. Además, los agentes tienen que tenerlo en cuenta para respetar esa salida.

## Cómo lo hacen otros orquestadores
- CrewAI pone en cada tarea `expected_output`, `output_pydantic` y `output_file`, y los inyecta en el prompt.
- Dify, n8n y Flowise usan un nodo final que declara qué devuelve la ejecución.
- LangGraph y OpenAI Agents SDK definen un esquema del estado o del resultado final y lo validan.

Lo habitual es contar poco el objetivo a los agentes y garantizar el formato al final.

## Decisiones (05/11/2026)
1. **Primera propuesta:** un campo «Salida esperada» que se inyecta en todos los agentes.
   - **Revisión:** gasta tokens en cada paso, despista a los intermedios (un QA se pone a escribir el resumen) y nadie comprueba el resultado.
   - **Segunda propuesta (elegida):** un contrato en tres capas.
     - **Definir:** en el diagrama, con la posibilidad de cambiarlo al lanzar.
     - **Avisar:** solo a los pasos finales, por defecto.
     - **Garantizar:** lo hace el nodo Salida.
2. **Lo que se puede hacer sin IA se hace sin IA.** Los enlaces salen del registro de archivos tocados (R31.12) y de las URLs que aparecen en las salidas.
3. **Dónde se define.** El valor por defecto va en el diagrama (`Diagram.deliverable`) y se edita en el panel del nodo Salida. Al lanzar se puede cambiar solo para esa ejecución (`RunOptions.deliverable`). Queda en `run.started`, y «Reanudar» (SPEC-041) usa el de la ejecución anterior.
4. **A quién se avisa.** Por defecto, a los pasos finales. También se puede elegir «Todos» o «Ninguno».
5. **Si no se cumple.** Por defecto la ejecución termina bien con un aviso, porque lo hecho ya está pagado. Se puede elegir «Fallar la ejecución».
6. **Solo cuenta el nivel principal.** Las Salidas de bucles y subdiagramas no componen entregable.
7. **El agente no escribe el entregable.** Se le pide que deje su salida y sus archivos preparados para él, así no hay dos versiones del resumen.
8. **Revisión de la implementación (segunda iteración):**
   - **La composición reutiliza `Decider.transform`,** el turno sin herramientas de SPEC-037, en vez de un método nuevo.
   - **El presupuesto se comporta como en el resto del motor:** al alcanzarlo se detiene la ejecución entera, no solo un elemento.
   - **Los archivos no se abren con la aplicación del sistema,** porque podría lanzar un `.bat`. Sus rutas se muestran para copiarlas, y «Abrir entregable» lo abre en la vista previa de Resultados.
   - **`core` no escribe en disco.** El archivo lo escribe `store`, que es quien ya escribe `events.jsonl`, al recibir `deliverable.done`.

## Modelo
```ts
type DeliverableItem =
  | { kind: 'links' }
  | { kind: 'summary'; instructions?: string }
  | { kind: 'json'; schema?: string; instructions?: string }
  | { kind: 'custom'; title: string; instructions: string };
interface DeliverableSpec { items: DeliverableItem[]; notify?: 'final' | 'all' | 'none'; onMissing?: 'warn' | 'fail'; fileName?: string }
```

## Requisitos
- **R46.1** [M8g] `deliverableProblems(spec)` y `validateDiagram` comprueban el entregable:
  - Tiene de 1 a 6 elementos, y `links` y `summary` aparecen como mucho una vez.
  - Un esquema JSON no válido da `deliverable-bad-schema`.
  - Un elemento `custom` sin título o sin instrucciones da `deliverable-empty`.
  - Los textos tienen como máximo 20 000 caracteres y los títulos 80.
  - `notify` y `onMissing` solo admiten sus valores.
  - `fileName` cumple `^[a-z0-9][a-z0-9_-]{0,40}$` (`deliverable-bad-name`).
  - Cualquier otro problema da `deliverable-invalid`.
- **R46.2** [M8g] `finalSteps(diagram)` devuelve los pasos de agente y de subdiagrama del nivel principal desde los que se llega a la Salida sin pasar por otro de esos pasos. Los routers, «Transformar», las revisiones y las conexiones de retorno no cortan el camino.
- **R46.3** [M8g] Entregable efectivo: el de `RunOptions.deliverable` si viene (`null` lo quita para esa ejecución) y, si no, el del diagrama. `run.started` lo lleva en `deliverable`.
- **R46.4** [M8g] Aviso a los agentes. `AgentRequest.deliverable` es `{ role: 'final' | 'goal', text }` y se registra igual en `agent.request`:
  - Con `notify` `final` (o sin indicar), los pasos de agente finales del nivel principal reciben `role: 'final'` con el texto de `deliverableBrief(spec)`.
  - Con `all`, además, los demás agentes (también los de dentro de bucles y subdiagramas) reciben `role: 'goal'` con una sola línea.
  - Con `none`, nadie recibe nada.
- **R46.5** [M8g] El `ClaudeAdapter` añade al prompt de sistema:
  - Con `final`, `DELIVERABLE_RULE` con el texto: lo que se entregará, que no lo escriba él y que nombre cada archivo y cada enlace que genere y para qué sirve.
  - Con `goal`, una sola línea con el objetivo final.
- **R46.6** [M8g] Composición. Cuando el nodo Salida del nivel principal se ejecuta y hay entregable efectivo, compone los elementos en su orden:
  - `links`, sin IA: los archivos de `file.produced` (que llevan `change`) y de las salidas de los pasos de agente, sin repetir y hasta 200, con «creado» o «modificado» si se sabe. Se añaden las URLs `http(s)` de las salidas de los pasos de agente, hasta 50. Si no hay nada, dice que no se crearon ni cambiaron archivos.
  - `summary`, `custom` y `json`: un turno por elemento con `Decider.transform`. El formato es `markdown`, o `json` con su esquema. La entrada lleva la petición, lo que llegó a la Salida, la última salida de cada paso (recortada) y los archivos, hasta 30 000 caracteres.
  - Si el resultado no cumple el formato o el esquema, se repite una vez con el error. Un error temporal del motor también gasta intento.
  - Sin `Decider.transform`, esos elementos fallan.
- **R46.7** [M8g] El nodo Salida emite `deliverable.done` con:
  - `ok`, `fileName` y `markdown`, que es el documento entero: `# Entregable` y una sección `##` por elemento.
  - `json`, si hay elemento JSON.
  - `links` (`files` y `urls`).
  - `items`: `{ kind, title, ok, error?, attempts, tokens? }`, con el título de su sección.

  La salida del nodo Salida pasa a ser ese `markdown` con los archivos que recibió. Un elemento que falla deja en su sección «No se pudo completar: …».
- **R46.8** [M8g] Con `onMissing: 'fail'`, si falla algún elemento, el nodo Salida falla y `run.finished` queda `failed` con el motivo «El entregable no se pudo completar: …». Con `warn` (o sin indicar), la ejecución termina bien.
- **R46.9** [M8g] Los tokens de la composición se emiten como `agent.usage` del nodo Salida y cuentan en el presupuesto como cualquier turno: si se alcanza, la ejecución se detiene como siempre. Si se cancela durante la composición, no se emite `deliverable.done`.
- **R46.10** [M8g] Motor simulado: `MockDecider.transform` con `deliverable` en la petición devuelve un texto determinista, sin tokens. El resumen dice cuántos pasos hubo y cuántos archivos; la sección personalizada dice su título; el JSON es un ejemplo del esquema.
- **R46.11** [M8g] `store`:
  - Al recibir `deliverable.done`, `RunLogWriter` escribe `<fileName>.md` (y `<fileName>.json` si hay JSON) en `output/` de la ejecución.
  - Si `ok` es `false`, añade el aviso a `meta.warnings`.
  - `RunService.start` acepta `deliverable` y lo valida (falla con `bad-request`).
  - `resumeRun` reutiliza el de `run.started`.
- **R46.12** [M8g] Editor:
  - `setDeliverable(diagram, spec | undefined)` es una operación con historial; con `undefined` lo quita.
  - `deliverableLabel(spec)` da el subtítulo, por ejemplo «enlaces + resumen .md + 1 sección».
  - `summarizeRun` incluye `deliverable`: ok, archivo, markdown y elementos.
  - El IPC `startRun` acepta y valida `deliverable`.
- **R46.13** [M8g] Interfaz del diagrama:
  - El panel del nodo Salida del nivel principal tiene la sección «Qué quieres al final»: casillas por elemento, instrucciones, esquema con aviso en el acto, título de la sección propia, «Avisar a», «Si no se cumple» y una vista previa de lo que leerán los pasos finales, con sus nombres.
  - En el lienzo, la Salida lleva el subtítulo del entregable y los pasos finales llevan «· entrega».
- **R46.14** [M8g] Al lanzar, el diálogo de ejecutar tiene «Entregable», plegado, con el del diagrama:
  - Lo que se cambie ahí vale solo para esa ejecución.
  - «Guardar en el diagrama» lo guarda también en el diagrama.
- **R46.15** [M8g] La pestaña «Resumen» de una ejecución empieza por el bloque «Entregable»:
  - Muestra el Markdown, ✓ o ⚠ por elemento con sus tokens, «Copiar» y «Abrir entregable», que lleva a su vista previa en Resultados.
  - Si la ejecución tenía entregable pero no llegó a componerse, lo dice.
- **R46.16** [M8g] Asistente: `get_run` incluye el entregable, y la herramienta `set_deliverable` cambia el del diagrama abierto con las mismas comprobaciones de R46.1.

## Fuera de alcance
- Abrir cada archivo con su aplicación (depende de R31.7, M6f).
- Confirmar el entregable antes de cerrar.
- Plantillas de entregable reutilizables.
- Enviarlo por correo o por Slack.
- Un entregable por rama.
