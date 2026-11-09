# SPEC-074 · Ejecución duradera

**Estado:** Implementada · **Hito:** M15e · **Paquetes:** `core`, `store`, `runtime`, `apps/desktop`, `editor`, `ui` · **Rama:** `feature/robustez-ejecucion`

## Propósito
El planificador (`executeDiagram`) guarda en memoria todo lo que sabe de una ejecución: qué aristas se entregaron, en qué vuelta va cada revisión, qué preguntas esperan respuesta. Si la app se cierra, se cuelga o se apaga el equipo, la ejecución queda `interrupted` y se pierde ese estado (auditoría del 08/11, P3 y P11):
- **Reanudar (SPEC-041) solo reutiliza pasos del nivel principal** (`path.length === 0`). Un bucle que iba por la vuelta 7 de 8, o un subdiagrama a medias, se repite entero y se paga otra vez.
- **Las decisiones se vuelven a tomar.** Al reanudar, el router y el juez de bucle vuelven a consultar a la IA y pueden elegir otro camino, con lo que lo reutilizado deja de encajar.
- **Las respuestas de la persona se pierden** para los pasos que se repiten, y hay que volver a responder.
- **Un subdiagrama inválido falla a mitad**, después de haber gastado, porque cada diagrama se valida al llegar a él.

Una ejecución duradera es la que, tras un corte, sigue desde donde estaba y por el mismo camino, sin repetir lo que ya se pagó. Es la propiedad central de Temporal y del *checkpointer* de LangGraph. Aquí no hace falta una base de datos: `events.jsonl` ya registra todo lo necesario.

## Cómo lo hacen otros
- **Temporal** guarda el historial de eventos de cada flujo y, al recuperarse, **vuelve a ejecutar el código del flujo reproduciendo el historial**: lo que ya ocurrió (actividades terminadas, señales, temporizadores) se toma del historial en vez de repetirse. Exige que el flujo sea determinista.
- **LangGraph** guarda el estado del grafo en cada paso con un *checkpointer*, y un hilo se puede retomar desde el último punto guardado. [Memoria en LangGraph](https://docs.langchain.com/oss/python/langgraph/memory)

## Decisiones (08/11/2026)
1. **Guardar el estado o reproducir los eventos.**
   - *Primera:* guardar el estado interno del planificador (aristas, vueltas, retornos) en un `checkpoint.json` tras cada paso.
   - *Revisión:* es un segundo formato que mantener y migrar, y puede no coincidir con los eventos si el cierre llega entre las dos escrituras.
   - *Segunda (elegida):* **reproducir, como Temporal**. Reanudar vuelve a recorrer el diagrama desde el principio, y todo lo que ya terminó (pasos, decisiones, respuestas) se toma de los eventos en vez de repetirse. El único estado es `events.jsonl`.
2. **Cómo se reconoce «lo mismo» al reproducir.**
   - *Primera:* por id de nodo, como hoy.
   - *Revisión:* dentro de un bucle el mismo nodo corre varias veces, y lo mismo en un tramo de retorno.
   - *Segunda (elegida):* por **clave de paso**: la ruta de contenedores, el id del nodo y la pasada (`stepKey = path/nodeId#pass`). Es determinista si las decisiones también se reproducen.
3. **Decisiones.** Se reutilizan siempre al reanudar: sin eso no se puede garantizar el mismo camino. Al **corregir** (SPEC-053) sí se vuelven a tomar a partir del paso corregido, porque la entrada cambia.
4. **¿Reanudar solo?**
   - *Primera:* reanudar automáticamente al abrir la app.
   - *Revisión:* cuesta dinero, y puede que la persona cerrara a propósito.
   - *Segunda (elegida):* **avisar y ofrecerlo**. Al abrir, las interrumpidas salen en la bandeja con «Reanudar».

## Requisitos
### Reproducción
- **R74.1** [M15e] Cada paso tiene una clave estable `stepKey(path, nodeId, pass)`, donde `pass` cuenta desde 1 las veces que ese nodo arranca en esa ruta (vueltas de bucle, retornos de revisión, repeticiones por «no terminó lo pedido»). La pasada no se guarda en los eventos: se cuenta con `stepKeysOf(events)` (los `node.started` de la misma ruta), así que no hay dos fuentes que puedan no coincidir y las grabaciones de SPEC-056 no cambian.
- **R74.2** [M15e] `ResumeCache` se indexa por `stepKey` y no solo por id del nivel principal: se reutilizan pasos de cualquier nivel, también dentro de bucles y subdiagramas (cambia R41.1).
- **R74.3** [M15e] Al reanudar se reutilizan, por `stepKey`: la salida de los pasos que terminaron bien (con su rastro, R41.7), el resultado de cada `decision` (ruta, condiciones, veredicto del juez y de la revisión) y cada respuesta de la persona a una pregunta del mismo paso y pasada.
- **R74.4** [M15e] Una decisión reutilizada emite `decision` con `reused: true` y no consulta al motor ni gasta. Si el diagrama cambió y la ruta (o las condiciones) reutilizadas ya no existen, se vuelve a decidir y se avisa con `supervisor.alert` `resume-diverged`.
- **R74.5** [M15e] Un paso que estaba en marcha al cortarse se ejecuta de nuevo. Recibe como `previousAnswers` las respuestas que ya había dado la persona en esa pasada y, como intento anterior (SPEC-071), «la ejecución se interrumpió» con los archivos que había tocado.
- **R74.6** [M15e] Una pregunta que esperaba respuesta al cortarse vuelve a salir cuando el paso llega otra vez a ella, y el aviso del sistema (SPEC-061) se repite. Si al repetirse el paso hace la misma pregunta (mismo `stepKey` y mismo texto) que ya tenía respuesta, se responde sola con esa respuesta: salen `agent.question` y `agent.answer` con `reused: true`.
- **R74.7** [M15e] Al corregir, se reutilizan como hoy los pasos anteriores al corregido; desde el corregido en adelante no se reutiliza nada, tampoco las decisiones (R53.8).
- **R74.8** [M15e] Una revisión humana ya aprobada se reutiliza por `stepKey` (cambia R53.9, que solo valía en el nivel principal).

### Validación antes de empezar
- **R74.9** [M15e] Antes de `run.started` se resuelven todas las plantillas de los subdiagramas (de la copia de la ejecución, R52.1) y se valida el árbol entero: tipos sin handler (R56.12), `validateDiagram` de cada nivel, profundidad máxima y referencias circulares. Si algo falla, la ejecución termina `failed` sin haber ejecutado ningún paso, con `reason: 'invalid-diagram'` (o `node-no-handler`, como R56.12) y un `error` por problema con su ruta. La ejecución usa las plantillas que se resolvieron aquí.

### Lo que se escribe en disco
- **R74.10** [M15e] Tras `node.finished` con `succeeded`, tras cada `decision` y tras cada `agent.answer`, el registro hace `fsync` de `events.jsonl` antes de seguir, para que lo reutilizable nunca se pierda en un corte. Los demás eventos se siguen escribiendo sin esperar.
- **R74.11** [M15e] `meta.json` guarda `lastStepKey` y cuántos pasos terminaron, para enseñar en la bandeja hasta dónde llegó sin leer todo el registro.

### Al abrir la app
- **R74.12** [M15e] Al abrir un proyecto, las ejecuciones `interrupted` de las últimas 72 horas (sin reanudar aún) salen en el menú de la bandeja (SPEC-061) como «<diagrama>: interrumpida tras «<último paso terminado>»» con «Reanudar» y «Descartar», y un aviso del sistema lo dice. No se reanuda nada solo.
- **R74.13** [M15e] «Reanudar» crea una ejecución nueva enlazada a la anterior (`resumedFrom`), como hoy. El Resumen dice cuántos pasos, decisiones y respuestas se reutilizaron y cuánto se ahorró según lo que costaron en la anterior.
- **R74.14** [M15e] Los espacios aislados de una ejecución interrumpida (SPEC-073) se borran al abrir la app (R73.18). Una rama que no llegó a fusionarse se repite entera al reanudar: `replayPlan` no reutiliza sus salidas ni sus decisiones.

## Escenarios
- **E74.a** *Dado* un bucle de 8 vueltas cortado en la 7, *entonces* al reanudar las vueltas 1 a 6 se reutilizan con sus veredictos y la 7 se ejecuta de nuevo.
- **E74.b** *Dado* un router que eligió «Frontend» antes del corte, *entonces* al reanudar se elige «Frontend» sin consultar a la IA.
- **E74.c** *Dado* un paso que había preguntado y recibido respuesta antes del corte, *entonces* al repetirlo recibe la respuesta y no vuelve a preguntar.
- **E74.d** *Dado* un subdiagrama con un tipo de nodo desconocido en el segundo nivel, *entonces* la ejecución falla antes de ejecutar el primer paso.
- **E74.e** *Dado* que se corta la luz justo después de que un paso termine bien, *entonces* al reanudar ese paso se reutiliza (su `node.finished` está en disco).

## Cambia
- **R41.1:** se reutiliza en cualquier nivel por `stepKey`, y también las decisiones y las respuestas (R74.2–R74.3).
- **R53.9:** las aprobaciones de revisión humana se reutilizan por `stepKey` (R74.8).
- **R6.6:** una plantilla que falta o no es válida hace fallar la ejecución antes de empezar, no al llegar al nodo (R74.9).

## Fuera de alcance
- Retomar un paso de agente a mitad de su turno (sesión del SDK). Se repite entero con lo que dejó (R74.5).
- Reanudar en otro equipo.
