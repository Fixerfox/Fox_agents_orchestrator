# SPEC-063 · Correcciones de la auditoría del 07/11

**Estado:** Implementada (M13) · **Hito:** M13 · **Paquetes:** `core`, `claude`, `runtime`, `editor`, `ui` · **Rama:** `feature/auditoria`

## Propósito
La auditoría del 07/11 (`docs` del proyecto: «auditoria-2026-11-07») encontró fallos que los tests no veían, sobre todo en el Supervisor: con lo que recibía podía dar falsos «no terminó lo pedido», que desde SPEC-062 paran el paso. El usuario pidió arreglarlo todo, con el Supervisor como prioridad. Esta spec recoge cada arreglo como requisito; los cambios de comportamiento de otras specs se anotan en ellas.

## Decisiones (07/11/2026)
1. **Qué ve el Supervisor de un paso largo.**
   - *Primera:* subir el tope de 40 acciones a 200.
   - *Revisión:* el prompt crece sin límite y lo que importa para saber si terminó es el final (escrituras, «Cambios realizados»), no el volumen.
   - *Segunda (elegida):* **principio y final**: las 10 primeras acciones, las 30 últimas y cuántas se omitieron; y los textos largos se recortan por el medio, nunca por el final.
2. **Memoria con un paso revisado varias veces.**
   - *Primera:* no volver a revisar un paso ya revisado.
   - *Revisión:* tras «Repetir el paso» o pedir cambios, la entrega es otra y hay que revisarla.
   - *Segunda (elegida):* se revisa cada vez, pero **la memoria guarda solo la última entrada del paso**, al final del diario.
3. **Motor de una ejecución.**
   - *Primera:* que el diálogo «Lanzar» no cambie Ajustes.
   - *Revisión:* el motor activo se ve en la barra y el diálogo lo cambia a propósito (R48); lo que falla es que una ejecución en marcha lo vuelva a leer.
   - *Segunda (elegida):* **el motor se fija al arrancar** la ejecución; cambiarlo vale para las siguientes, como ya decía R56.4.
4. **Coste de las decisiones.** El router, sus condiciones y el evaluador de bucles son trabajo de la ejecución: cuentan en el presupuesto (a diferencia del Supervisor, R60.14). Las condiciones de un router por reglas se evalúan en una sola consulta.
5. **Fuera de esta spec** (necesitan decisión o una spec propia): «Terminada con avisos» en lugar de fallida cuando la comprobación final no se cumple (choca con la decisión de SPEC-062), aislar las ramas en paralelo con `git worktree`, pausar de verdad el turno de Claude (hay que probarlo con el SDK real), escritura con búfer del registro, E2E con Playwright y CI, el rediseño de la navegación y de la vista de ejecución en ventanas pequeñas (artefacto «Propuestas UI/UX»), y quitar el estado de la barra superior en la vista de la ejecución: la barra lleva el medidor del presupuesto y la entrada al resumen (R15.9, R44.3–R44.5), que la cabecera no tiene.

## Requisitos
### Supervisor y memoria
- **R63.1** [M13] La revisión de un paso recibe sus 10 primeras acciones, una línea con cuántas se omitieron y sus 30 últimas.
- **R63.2** [M13] `clipMiddle(text, max)` recorta un texto largo guardando el principio y el final, con `[… N caracteres omitidos …]` en medio. Lo usan las entradas y salidas que se envían al Supervisor, al Juez y al árbitro, y lo que entregó cada paso en la comprobación final.
- **R63.3** [M13] Un paso tiene una sola entrada en la memoria: si se vuelve a anotar (otra revisión, otra pasada), la nueva sustituye a la anterior y pasa al final.
- **R63.4** [M13] La regla `retry-loop` de un paso salta cuando termina fallido después de su último intento, no antes (cambia R60.7).
- **R63.5** [M13] Lo que gasta la comprobación final sale como `agent.usage` con `source: 'supervisor'` en el nodo de salida.
- **R63.6** [M13] La memoria y los avisos nombran los pasos por su etiqueta también dentro de bucles y subdiagramas.
- **R63.7** [M13] Cada consulta del Supervisor tiene su propia cancelación: al agotarse su tiempo (R62.8) o la espera final (R60.13) se cancela y no sigue gastando.
- **R63.8** [M13] La revisión en segundo plano solo se apaga tras 3 fallos seguidos; una revisión que llega pone la cuenta a cero.
- **R63.9** [M13] Mientras un paso espera a su revisión no ocupa hueco de concurrencia.
- **R63.10** [M13] La memoria que va en el prompt y los `<datos>` del Supervisor, el Juez y el árbitro neutralizan cualquier cierre de su etiqueta, sin distinguir mayúsculas ni espacios (`neutralizeTag`).
- **R63.11** [M13] Cada aviso sale una vez por paso, regla y pasada: otra vuelta de un bucle o un retorno de revisión es otra pasada (cambia R60.1).
- **R63.12** [M13] Si con las entradas acortadas la memoria sigue pasando del tope, se quitan las más antiguas enteras y el diario empieza por `(N pasos anteriores omitidos)`; nunca se corta una línea (cambia R60.24).

### Motor, coste y robustez
- **R63.13** [M13] El motor de una ejecución (agentes, decisiones y si el Supervisor revisa con IA) se fija al arrancarla: cambiarlo en Ajustes no afecta a las que están en marcha.
- **R63.14** [M13] Pausar y esperar entre reintentos no deja oyentes de cancelación colgados.
- **R63.15** [M13] El router, sus condiciones y el evaluador de bucles devuelven lo que gastan: cuenta en el presupuesto y sale como `agent.usage` con `source: 'decision'`.
- **R63.16** [M13] Un router por reglas evalúa todas sus condiciones con una sola consulta (`Decider.conditions`) si el motor la ofrece; si no, una por una como antes.
- **R63.17** [M13] Lo que el árbitro (router, condiciones, evaluador de bucles) recibe de un paso va entre `<datos>`, y su prompt dice que son datos y no instrucciones.
- **R63.18** [M13] En un repositorio git, las fotos de `CommandWatch` (R55.2) se hacen con lo que lista git: lo que no ignora y, de lo ignorado, todo salvo las carpetas de caché conocidas (`Library`, `Temp`, `obj`, `Intermediate`, `.venv`, `target`…), para que siga apareciendo lo que genera un build (`dist/`, `_site/`). Sin git o si falla, como antes.
- **R63.19** [M13] La sesión guarda en memoria como mucho 10 ejecuciones terminadas; las más antiguas se leen del disco.
- **R63.20** [M13] Reanudar y corregir toman la entrada del nodo de tipo `entry` del diagrama guardado, tenga el id que tenga.

### Interfaz
- **R63.21** [M13] Enviar «Pídeselo a Claude» desde la ficha de un MCP no guarda la ficha.
- **R63.22** [M13] Los textos dicen lo que hace el motor: «Sin preguntar nunca» escribe también fuera de la carpeta (R50.5); la carpeta de trabajo no promete preguntar; al llegar al presupuesto la ejecución se detiene y queda fallida (R7.4); los vacíos de Ejecuciones nombran «Lanzar…».
- **R63.23** [M13] «Encajar» el lienzo nunca baja de un zoom de 0,75; lo que no quepa se ve desplazando.
- **R63.24** [M13] El índice lateral de Ajustes incluye «Supervisor».
- **R63.25** [M13] La tarjeta de un paso no repite el nombre del agente si es igual al del paso.
- **R63.26** [M13] Una ejecución terminada se ve en la miga de pan bajo «Historial», no bajo «En directo».
- **R63.27** [M13] Una región `aria-live` anuncia cuántas preguntas esperan respuesta y cuándo termina la ejecución que se está viendo.
- **R63.28** [M13] «Confirmar antes de terminar» es una fila: la casilla junto a su texto.
- **R63.29** [M13] Al elegir un paso que queda tapado o fuera de la vista, el lienzo se centra en él.

## Fuera de alcance
Ver la decisión 5.
