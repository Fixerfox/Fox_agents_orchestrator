# SPEC-075 · Supervisor con evidencia, gravedad y verificador

**Estado:** Borrador · **Hito:** M15f · **Paquetes:** `core`, `claude`, `runtime`, `store`, `apps/desktop`, `editor`, `ui` · **Rama:** `feature/supervisor-evidencia`

## Propósito
El Supervisor (SPEC-060 y SPEC-062) revisa cada paso con un modelo barato y comprueba al final si se consiguió lo pedido. Funciona, pero **juzga lo que los agentes cuentan, no lo que hicieron** (auditoría del 08/11, S1–S8):
- La revisión recibe texto recortado: las 10 primeras y las 30 últimas acciones a 160 caracteres, y 3.000 caracteres de la salida. Nadie ejecuta los tests ni mira el diff. SPEC-062 lo dejó escrito en «Fuera de alcance»: *un agente que dice haber terminado sin hacerlo no se detecta*. Es el fallo más caro que puede tener un orquestador.
- El veredicto es sí o no, sin gravedad. Un «no» de un modelo barato para el paso y pregunta a la persona: cada falso positivo cuesta una interrupción.
- La revisión en segundo plano ya solo se dispara en pasos que fallan o se cancelan: gasta revisando fallos.
- No hay forma de decir «este aviso era falso», así que no se sabe cuánto acierta el Supervisor ni se puede mejorar.
- Si la comprobación final falla, la ejecución pasa como buena con un aviso, también cuando nadie la está mirando.

Esta spec añade al Supervisor lo que usan los equipos que evalúan agentes en producción: **comprobaciones deterministas primero, evidencia para el juez, un veredicto con gravedad y un verificador opcional que ejecuta y observa**.

## Cómo lo hacen otros
- **Comprobaciones deterministas antes que el juez.** La práctica consolidada con jueces LLM es poner delante lo que se comprueba sin modelo (formato, esquema, tests): es gratis, instantáneo y fiable, y el juez solo ve lo que ya pasó ese filtro. [Por qué LLM como juez (2026)](https://futureagi.com/blogs/why-llm-as-a-judge-2026) · [Sesgos del juez](https://grepture.com/blog/llm-as-a-judge-bias)
- **Rúbrica y evidencia antes del veredicto.** Un juez fiable recibe criterios explícitos y una salida estructurada, y tiene que señalar la evidencia antes de decidir. Así se reducen el sesgo de autoridad (premiar el tono seguro) y el de longitud. [LLM como juez](https://klu.ai/glossary/llm-as-a-judge)
- **Calibrar contra personas.** Antes de fiarse de un juez se compara con casos revisados por personas, y se vuelve a medir cuando cambia el modelo o el prompt.
- **Bucles de verificación de Anthropic.** Claude Code usa como base las señales deterministas (tipos, linter, tests, errores en ejecución) y una skill `/verify` que compila, ejecuta y observa el cambio. Los agentes gestionados tienen un evaluador aparte que comprueba el resultado contra una rúbrica, y lo que falla vuelve a rehacerse. Anthropic publica además una skill `code-review` oficial. [Bucles de verificación con skills](https://claude.com/de/resources/articles/building-verification-loops-in-claude-code-with-skills)

## Decisiones (08/11/2026)
1. **Cómo dejar de juzgar solo por lo que se dice.**
   - *Primera:* dar a la revisión más texto (más acciones, salida entera).
   - *Revisión:* sigue siendo juzgar afirmaciones. Un agente que dice «añadí los tests» sin añadirlos pasa igual.
   - *Segunda (elegida):* **tres capas por paso**. (a) Comprobaciones deterministas que declara la persona. (b) Evidencia para la IA: el diff de lo que tocó el paso, el resultado de las comprobaciones y los errores de herramientas. (c) Juicio con rúbrica que tiene que citar evidencia.
2. **Quién decide qué se comprueba.**
   - *Primera:* que el Supervisor adivine los comandos (`npm test`, `cargo test`) y los ejecute.
   - *Revisión:* ejecutaría comandos que nadie ha revisado, con coste y efectos imprevisibles, y en proyectos que no son de código no hay nada que adivinar.
   - *Segunda (elegida):* **las comprobaciones las declara la persona** en el paso, en la ficha del agente o en el diagrama. El asistente puede proponerlas, pero no se ejecuta nada que no esté declarado.
3. **Comandos de terceros.** Un diagrama importado o cambiado por el asistente puede traer comandos. **La primera vez que se va a ejecutar un comando de comprobación se pide aprobación**, como con los paquetes (SPEC-012).
4. **Cuándo para la IA.**
   - *Primera:* mantener el sí o no y subir el modelo.
   - *Revisión:* cuesta más en cada paso y no arregla que un «no» leve pare igual que uno grave.
   - *Segunda (elegida):* **veredicto con gravedad** y umbral configurable. Por defecto solo pregunta con gravedad alta; lo demás avisa. Una comprobación determinista que falla siempre cuenta como alta. Un «no» sin evidencia citada no para nada: queda como aviso.
5. **Verificar ejecutando.**
   - *Primera:* un agente verificador en cada paso.
   - *Revisión:* tarda minutos y gasta como un paso más. En la mayoría de pasos sobra.
   - *Segunda (elegida):* **opcional, por paso o por diagrama**. «Verificar con un agente» lanza un agente de solo lectura con una skill de verificación. La app incluye una, «Verificar lo pedido», basada en el patrón `/verify`. Se pueden usar otras skills instaladas (por ejemplo `code-review`).
6. **Calibración.** Cada aviso se puede marcar como falso o como acertado. Queda en el registro, se cuenta por regla y se guarda como caso de referencia para medir los cambios del prompt. No se ajusta nada solo.
7. **Modelo de la comprobación final.** Se hace una vez por ejecución y es la última red, así que **usa un modelo más capaz que la revisión de cada paso** (Sonnet 5.5 por defecto, configurable).

## Requisitos
### Comprobaciones deterministas
- **R75.1** [M15f] Un paso, una ficha de agente y un diagrama pueden declarar `checks`: lista de comprobaciones con `id`, `label` y uno de estos tipos:
  - `command`: `run` (la línea de comandos), `timeoutSec` (300 por defecto) y `expectExit` (0 por defecto).
  - `files`: `mustExist` y `mustChange`, listas de patrones glob relativos a la carpeta de trabajo.
  - `output`: `contains`, `notContains` o `matches` (expresión regular) sobre la salida del paso.
  - `schema`: un JSON Schema que debe cumplir la salida del paso (que tiene que ser JSON).
- **R75.2** [M15f] Las de la ficha del agente valen en todos sus pasos; las del paso se suman. Las del diagrama son de la ejecución (R75.17).
- **R75.3** [M15f] Cuando un paso de agente acaba bien, antes de la revisión con IA, se ejecutan todas sus comprobaciones y cada una emite `check.result` (`nodeId`, `checkId`, `kind`, `ok`, `detail`, `durationMs`). `detail` es la salida del comando o el motivo, recortado por el medio a 2.000 caracteres y sin secretos (`redactSecrets`).
- **R75.4** [M15f] Los comandos se ejecutan con el puerto `CheckRunner` de `core`, que implementa `apps/desktop`: en la carpeta del paso (o su espacio aislado, SPEC-073), sin las claves de la app en el entorno, matando el árbol de procesos al pasar su tiempo. No gastan tokens.
- **R75.5** [M15f] Si falla alguna comprobación, el paso no se cierra: se repite una vez solo (`checksRetry`, 1 por defecto) con la entrada original, su entrega anterior y lo que falló, como «Repetir el paso» (R62.5). Si vuelve a fallar, se pregunta a la persona como en R62.4, con las comprobaciones que fallan como motivo.
- **R75.6** [M15f] La primera vez que se va a ejecutar una comprobación `command` cuyo texto no está aprobado en el proyecto, se pregunta a la persona (`kind: 'permission'`) enseñando el comando. Lo aprobado se guarda por proyecto con su hash en `.orquestador/approved-checks.json`. Cambiar el texto obliga a aprobarlo otra vez. El `fallback` es no ejecutarla, y entonces la comprobación cuenta como `ok: false` con el motivo «sin aprobar».

### Evidencia para la revisión
- **R75.7** [M15f] `SupervisorReview` añade `evidence`:
  - `diff`: el diff unificado de lo que el paso cambió respecto a cómo estaba al empezar. Lo modificado se compara con la copia de R31.6 y lo creado va entero. Lo que cambiaron comandos (R55.1) solo se lista. El tope es 12.000 caracteres: primero los archivos declarados para el paso (R60.16) y los del entregable, luego los más pequeños; los que no caben se listan con sus líneas añadidas y quitadas.
  - `checks`: el resultado de cada comprobación.
  - `toolErrors`: cuántas herramientas fallaron y los 5 últimos mensajes.
  - `stats`: archivos creados, modificados y borrados.
- **R75.8** [M15f] El prompt de la revisión dice:
  - que decide por la evidencia;
  - que una afirmación de la salida que la evidencia no respalda no cuenta como hecha (p. ej. «añadí tests» sin ningún archivo de tests en el diff);
  - que cada problema tiene que citar su evidencia (un archivo y línea del diff, una comprobación o una acción);
  - que no premie la longitud ni el tono seguro.
- **R75.9** [M15f] `SupervisorVerdict` pasa a ser `{ ok, severity: 'none' | 'low' | 'medium' | 'high', problems: { text, evidence }[], outOfScope?, summary, decided }`. Con `ok: false` y ningún problema con evidencia, el veredicto se trata como `severity: 'low'` y salta el aviso `unsupported-verdict` (`info`).

### Cuándo para
- **R75.10** [M15f] Ajustes › Supervisor tiene «Parar y preguntarme cuando el problema sea…»: «grave» (por defecto), «medio o grave» y «nunca, solo avisar». Si `ok` es `false` y la gravedad llega al umbral, se pregunta como en R62.4. Si no llega, solo da el aviso `ai-review` con su gravedad. Una comprobación determinista que falla cuenta siempre como grave.
- **R75.11** [M15f] Un paso tiene «Revisar con IA»: «siempre» (por defecto), «solo si es un paso final o tiene comprobaciones» y «nunca». Las comprobaciones deterministas se ejecutan igual.
- **R75.12** [M15f] Los pasos que fallan o se cancelan no se revisan con IA, y su entrada de memoria es la determinista (R72.10). Desaparece la revisión en segundo plano de `Supervisor.finished` (cambia R60.13 y R60.15).

### Verificador
- **R75.13** [M15f] Un paso o un diagrama puede activar «Verificar con un agente» con un agente (por defecto «Verificador», que incluye la app), sus skills, un presupuesto (0,50 $ por defecto) y un tiempo máximo (10 min por defecto, R70.6). Corre después de las comprobaciones y antes de la revisión con IA, en la carpeta del paso.
- **R75.14** [M15f] El verificador no puede editar archivos (las herramientas de escritura se deniegan) pero sí ejecutar comandos. Si un comando suyo cambia archivos (R55.1), salta el aviso `verifier-wrote` con la lista. Su gasto cuenta en el presupuesto como un paso más, y su rastro va en el registro con `kind: 'verify'`.
- **R75.15** [M15f] El verificador termina con la sección `## Verificación`: una línea `Resultado: cumple` o `Resultado: no cumple` y un hallazgo por línea, `- [grave|media|leve] <archivo:línea o comando> — <qué>`. El motor la interpreta (`parseVerification`); los hallazgos pasan como evidencia a la revisión (R75.7) y un «no cumple» con algún hallazgo grave cuenta como grave en R75.10.
- **R75.16** [M15f] La biblioteca incluida (`builtin-library`) trae el agente «Verificador» y la skill «Verificar lo pedido». La skill dice que hay que: leer lo pedido y la tarea del paso; revisar el diff; ejecutar las comprobaciones que el proyecto documenta (README, CLAUDE.md, scripts del proyecto); probar el cambio de principio a fin cuando se pueda; informar de cada hallazgo con su evidencia en el formato de R75.15; y no arreglar nada. Se puede copiar al proyecto y editar, y se puede elegir otra skill instalada (SPEC-025).

### Comprobación final
- **R75.17** [M15f] Las comprobaciones del diagrama se ejecutan cuando la ejecución va a acabar bien, antes de `verifyRun`. Si alguna falla, la ejecución acaba `failed` con «No cumple lo pedido: falló <comprobación>» y su detalle, sin consultar a la IA.
- **R75.18** [M15f] `verifyRun` recibe también: los archivos que cambió la ejecución con sus líneas añadidas y quitadas, el resultado de las comprobaciones del diagrama, el estado de cada elemento del entregable (R46) y, por paso, la gravedad y los problemas de su revisión.
- **R75.19** [M15f] La comprobación final usa `supervisorVerifyModel` (Sonnet 5.5 por defecto); la revisión de cada paso sigue con `supervisorModel` (R60.14).
- **R75.20** [M15f] Ajustes › Supervisor tiene «Si no se puede comprobar el resultado»: «Avisar» (por defecto, R62.12) o «Hacer fallar la ejecución».

### Calibración
- **R75.21** [M15f] Cada aviso tiene «No era un problema» y «Sí lo era». Al pulsar uno se emite `supervisor.feedback` (`alertSeq`, `verdict: 'false-alarm' | 'confirmed'`, `note?`). También vale con la ejecución terminada, como `run.accepted` (R65.5). Un aviso marcado como falso deja de contar como abierto (R72) y sale atenuado.
- **R75.22** [M15f] La pestaña «Supervisor» enseña, por regla, cuántos avisos hubo, cuántos se marcaron falsos y cuántos acertados, en esta ejecución y en las últimas 50 del proyecto.
- **R75.23** [M15f] Cada aviso marcado se guarda como caso de referencia en `.orquestador/supervisor/cases.jsonl`: la regla, lo que recibió la revisión (recortado y sin secretos), su veredicto y lo que dijo la persona. `npm run supervisor:eval` vuelve a pasar esos casos por el prompt actual con un modelo real y da cuántos coinciden con la persona. No forma parte de `npm run check`.

### Interfaz
- **R75.24** [M15f] El lateral del paso tiene la sección «Comprobaciones», para añadirlas, ordenarlas y probarlas con «Ejecutar ahora», y «Verificar con un agente». El lateral del diagrama tiene sus comprobaciones de la ejecución.
- **R75.25** [M15f] En la conversación del paso, las comprobaciones salen como una fila «3 de 4 comprobaciones bien», que se despliega con la salida de cada una. En la pestaña «Supervisor», cada aviso de la revisión enseña su evidencia (el trozo del diff o la comprobación citada).

## Escenarios
- **E75.a** *Dado* un Implementador con la comprobación `npm test` que dice «todo hecho» y deja un test rojo, *entonces* el paso se repite una vez con la salida del test y, si sigue rojo, pregunta a la persona.
- **E75.b** *Dado* un paso que dice «añadí la documentación» y un diff sin ningún `.md`, *entonces* la revisión da `ok: false`, gravedad alta y la evidencia «ningún archivo de documentación en el diff».
- **E75.c** *Dado* un «no» de gravedad baja sobre el estilo de un texto, *entonces* el paso sigue con un aviso y nadie es interrumpido.
- **E75.d** *Dado* un diagrama importado con la comprobación `rm -rf build && make`, *entonces* antes de ejecutarla la persona ve el comando y decide.
- **E75.e** *Dado* «Verificar con un agente» con la skill «Verificar lo pedido» en el último paso, *entonces* el verificador ejecuta los tests documentados, informa de cada hallazgo con archivo y línea, y su «no cumple» grave para la ejecución antes del commit.
- **E75.f** *Dado* que la persona marca como falso un aviso `out-of-scope`, *entonces* el aviso deja de estar abierto, la pestaña lo cuenta y queda un caso de referencia.

## Cambia
- **R60.12 y R62.2:** la revisión recibe evidencia y devuelve gravedad y problemas (R75.7–R75.9).
- **R60.13 y R60.15:** los pasos que fallan no se revisan (R75.12).
- **R62.4:** solo se pregunta si la gravedad llega al umbral (R75.10).
- **R62.12:** «Si no se puede comprobar» es configurable (R75.20).
- **SPEC-062, Fuera de alcance:** comprobar el resultado en sí pasa a estar dentro, con las comprobaciones y el verificador.

## Fuera de alcance
- Deducir comprobaciones solas a partir del proyecto. El asistente puede proponerlas y la persona las acepta.
- Varios jueces que votan. Se valorará con los datos de R75.22–R75.23.
- Cambiar solas las instrucciones de un agente a partir de lo que encuentra el Supervisor. Eso es memoria del proyecto (SPEC-076), siempre con aprobación.
