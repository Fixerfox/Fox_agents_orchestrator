# SPEC-062 · Control de lo pedido

**Estado:** Implementada (M12) · **Hito:** M12 · **Paquetes:** `core`, `claude`, `runtime`, `editor`, `ui`, `apps/desktop` · **Rama:** `feature/bandeja-avisos`

## Propósito
El 06/11 una ejecución pidió añadir diagramas a la documentación. El Implementador hizo 1 de 44 tareas, se detuvo y lo dijo en su salida («Solo he completado T001»). Aun así su paso quedó «correcto», el diagrama siguió con auditoría, commit y PR, la PR se fusionó y la ejecución salió «Terminada bien». Los diagramas no existían.

El usuario lo dijo claro: esto no puede fallar, y el Supervisor tiene que comprobar también que el resultado final cumple lo pedido. Esta spec cambia la decisión 2 de SPEC-060 («la IA avisa») para lo más importante: un paso que no terminó no pasa de largo.

## Decisiones (06/11/2026)
1. **Cuál es el criterio.**
   - *Primera:* contar las casillas de `tasks.md`.
   - *Revisión:* solo vale para Spec Kit, y una lista interna puede estar mal o incompleta. El usuario lo avisó: el control no se basa en el documento de tareas.
   - *Segunda (elegida):* **manda lo que pidió la persona.** Las listas y los planes de los agentes son pistas, y lo planificado no cuenta como hecho.
2. **Cuándo se comprueba un paso.**
   - *Primera:* solo al final de la ejecución.
   - *Revisión:* el commit y la PR ya estarían hechos.
   - *Segunda:* mantener la revisión en segundo plano y parar si llega a tiempo.
   - *Revisión:* entonces depende de la suerte, que es justo lo que falló.
   - *Tercera (elegida):* **antes de que el paso termine.** Cuesta unos segundos por paso, frente a pasos de minutos, y a cambio el siguiente recibe en su memoria lo que hizo el anterior.
3. **Qué hace al detectarlo.**
   - *Primera:* fallar el paso.
   - *Revisión:* un modelo barato puede equivocarse, y parar en seco tiraría trabajo pagado.
   - *Segunda (elegida):* **pregunta a la persona**, que decide. El paso espera y llega un aviso del sistema (SPEC-061).
4. **Un paso solo responde de su parte.** Un Planificador que no implementa ha terminado; un informe que encuentra problemas está terminado. Si no, se pararía todo diagrama por fases. Los agentes se configuran de muchas formas, así que nada de esto supone un tipo de agente, un flujo ni un formato: la revisión lee para qué sirve ese agente en su ficha, su tarea en el paso y lo pedido.
5. **Seguir igualmente no blanquea el resultado.** La comprobación final se hace igual, así que una ejecución que no consiguió lo pedido sale fallida aunque la persona dejara seguir un paso.
6. **Una corrección no se juzga como el pedido entero.**
   - *Primera:* comparar siempre con el pedido original.
   - *Revisión:* el 07/11 una corrección de un solo diagrama salió bien y quedó fallida: el paso repetido solo hablaba de ese diagrama, su entrega anterior se había sustituido y el control creyó que los demás no existían.
   - *Segunda (elegida):* **cada paso responde de la corrección, y el resultado final suma lo anterior y lo nuevo.** El pedido original sigue siendo el criterio del conjunto.
7. **Si la comprobación no se puede hacer.** No se para la ejecución por un fallo de red, pero queda un aviso a la vista: «no comprobado» nunca se enseña como «bien».

## Requisitos
### Cada paso
- **R62.1** [M12] Con la revisión activa, un paso de agente que acaba bien se revisa antes de cerrarse: `node.finished` y los pasos siguientes esperan al veredicto. Los pasos en paralelo se revisan cada uno por su lado.
- **R62.2** [M12] `Decider.supervise` recibe también lo que pidió la persona (`order`), para qué sirve el agente según su ficha (`purpose`) y las preguntas y respuestas del paso. `ok` es `false` si el paso dice que paró, hizo solo una parte, dejó pendiente lo suyo o espera una decisión.
- **R62.3** [M12] El prompt dice que manda lo pedido, que las listas de tareas y los planes son solo pistas, que un paso responde solo de lo que le toca según su agente y su tarea (planificar sin implementar, o un informe que encuentra problemas, es terminar) y que no supone ningún tipo de agente ni de flujo.
- **R62.4** [M12] Con `ok: false`, además del aviso, el paso pregunta a la persona (`agent.question` con `kind: 'unfinished'`): qué falta y las opciones «Repetir el paso», «Seguir igualmente» y «Parar la ejecución». Mientras espera libera su hueco de concurrencia.
- **R62.5** [M12] «Repetir el paso» lo vuelve a ejecutar con su entrada, su entrega anterior y lo que faltaba. Cualquier otro texto hace lo mismo con ese texto como instrucción. Se revisa otra vez al acabar.
- **R62.6** [M12] «Seguir igualmente» cierra el paso con su salida.
- **R62.7** [M12] «Parar la ejecución» falla el paso, y los siguientes no se ejecutan.
- **R62.8** [M12] Si la revisión falla o tarda más de 60 segundos, el paso sigue, queda el aviso `unchecked` en ese paso y los siguientes se revisan igual.

### El resultado final
- **R62.9** [M12] Cuando una ejecución va a acabar bien, `Decider.verifyRun` compara lo que pidió la persona con el entregable acordado y con lo que hicieron los pasos. Emite `supervisor.verified` (`met`, `detail`) antes de `run.finished`. Su gasto va como el de la revisión.
- **R62.10** [M12] Si no se cumple, la ejecución acaba `failed` con el motivo «No cumple lo pedido: …» y un aviso `requirements-unmet` de la ejecución.
- **R62.11** [M12] El prompt de esa comprobación dice que manda lo pedido, que lo planificado o pospuesto no cuenta como hecho, y que documentar un trabajo no es hacerlo.
- **R62.12** [M12] Si no se puede comprobar, el estado no cambia y queda el aviso `unchecked` de la ejecución. Una ejecución fallida o cancelada no se comprueba.
- **R62.15** [M12] En una corrección, la revisión de cada paso recibe la corrección (`correction`) y el paso responde solo de ella: el trabajo anterior no hay que entregarlo otra vez. Sigue parando si dice que no la terminó.
- **R62.16** [M12] En una corrección, `verifyRun` recibe también la corrección y lo que entregaron en la ejecución anterior los pasos que se repiten (`before`), y juzga el conjunto: el pedido cumplido sumando ambos y la corrección aplicada.
- **R62.17** [M12] `verifyRun` recibe también lo que decidió la persona durante la ejecución (`decisions`: cada pregunta con su respuesta). Lo que decidió aceptar o dejar para después no cuenta como falta, y las mejoras que señala un informe tampoco, salvo que lo pedido las exigiera.

### Interfaz
- **R62.13** [M12] La pestaña «Supervisor» y el Resumen dicen si el resultado final cumple lo pedido y, si no, qué falta. Los avisos `ai-review`, `unchecked` y `requirements-unmet` tienen su título y su explicación.
- **R62.14** [M12] Los avisos del sistema dicen «<paso> no ha terminado lo pedido» y «Ejecución incompleta».

## Escenarios
- **E62.a** *Dado* el pedido «añade diagramas» y un Implementador que dice que solo hizo una tarea, *entonces* el paso se detiene antes del commit y la persona decide.
- **E62.b** *Dado* un Planificador que entrega el plan y dice «no he implementado nada», *entonces* sigue: era su parte.
- **E62.c** *Dado* que la persona elige «Seguir igualmente» y nadie hace lo pedido, *entonces* la ejecución acaba fallida con lo que falta.
- **E62.d** *Dado* un pedido de «escribe la spec» y una spec terminada, *entonces* se cumple aunque nada esté implementado.

## Fuera de alcance
- Comprobar el código en sí: se juzga por lo que declaran los pasos y sus archivos. Un agente que dice haber terminado sin hacerlo no se detecta aquí.
- Con la revisión con IA apagada en Ajustes no hay estos controles.
