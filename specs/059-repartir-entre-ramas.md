# SPEC-059 · Repartir el trabajo entre ramas en paralelo

**Estado:** Implementada (M8h) · **Hito:** M8h · **Paquetes:** `core`, `claude`, `editor`, `ui` · **Rama:** `feature/repartir-entre-ramas`

## Propósito
El 06/11 el usuario conectó un Especificador a dos Implementadores y preguntó si se repartían el trabajo. Hoy no: el motor manda la salida entera del paso a cada rama. El Especificador no sabe que detrás hay varios pasos, y los Implementadores trabajan aislados y no se hablan, así que hacen lo mismo dos veces y pueden pisarse los archivos al fusionar. El reparto solo se podía conseguir escribiendo a mano la tarea del origen y la de cada rama.

El usuario lo resumió así: el agente del que salen dos o más ramas en paralelo debe saber que su trabajo se va a dividir, y el motor debe repartirlo.

## Cómo lo hacen otros
- **Map-reduce / fan-out** (LangGraph Send, Temporal, Airflow con dynamic task mapping): un paso produce una lista de trozos y el planificador lanza una rama por trozo; otro paso los junta.
- **Planificador y trabajadores** (patrón orchestrator-workers de Anthropic): un agente divide la tarea en subtareas independientes con un formato fijo y cada trabajador recibe solo la suya.
- **Spec Kit:** `tasks.md` agrupa por historia de usuario y marca con `[P]` lo que se puede hacer en paralelo, siempre que no toque los mismos archivos.

## Decisiones (06/11/2026)
1. **Quién divide.**
   - *Primera:* el motor llama a un agente «repartidor» aparte que trocea la salida del origen.
   - *Revisión:* es una llamada más que cuesta, añade un paso invisible al diagrama, y quien mejor conoce el contenido es el propio agente de origen.
   - *Segunda (elegida):* **divide el agente de origen.** El motor le avisa de a quién va su trabajo y luego solo lee y reparte lo que escribió.
2. **Cómo se marcan las partes.**
   - *Primera:* encabezados libres y que el motor los adivine por parecido con el nombre de la rama.
   - *Revisión:* es frágil, y dos ramas pueden llamarse igual (en el diagrama del usuario las dos eran «speckit-implementador»).
   - *Segunda (elegida):* **marcadores fijos con el id del paso** (`## Para <id>`) más un `## Común`. El prompt enseña el id junto al nombre, el agente y la tarea de cada rama.
3. **Cuándo se reparte.**
   - *Primera:* siempre que un agente tenga dos o más salidas.
   - *Revisión:* a veces se quiere lo mismo en todas las ramas (dos revisores del mismo documento, o el Implementador que también va a la salida), y cambiarlo rompería los diagramas que ya existen.
   - *Segunda:* una opción de cada paso: «Enviar lo mismo a todos» o «Repartir entre los siguientes».
   - *Revisión:* con el Coordinador la opción sobra, y dos formas de repartir solo confunden.
   - *Tercera (elegida):* **solo reparte el Coordinador.** Un paso normal con varias salidas envía lo mismo a todos, como siempre.
4. **Qué pasa si el agente no cumple el formato.**
   - *Primera:* mandar la salida entera a las ramas que no tengan parte.
   - *Revisión:* así se vuelve en silencio a hacer el trabajo dos veces, que es justo lo que se quiere evitar.
   - *Segunda (elegida):* **el paso de origen se repite con el motivo**, como una corrección (SPEC-053). Después de 2 correcciones de reparto, el paso falla con el motivo.
5. **Choques de archivos.**
   - *Primera:* comparar al fusionar los archivos que de verdad tocó cada rama.
   - *Revisión:* entonces el trabajo ya está hecho y pagado; detectarlo tan tarde solo sirve para avisar.
   - *Segunda (elegida):* **cada parte declara los archivos o carpetas que toca** y el motor rechaza el reparto antes de lanzar las ramas si dos partes se cruzan. La comprobación al fusionar queda fuera de esta spec.
6. **Un paso que solo reparte.**
   - *Primera:* un agente secreto, siempre activo, que conoce el contexto de todos.
   - *Revisión:* un paso invisible que gasta y decide va contra ver qué hace cada agente, y conoce el trabajo peor que quien lo acaba de hacer.
   - *Segunda (elegida):* **un paso visible y fijo, el Coordinador**, que se coloca solo donde hace falta y no se edita: así el formato de reparto siempre funciona igual. Vigilar la ejecución entera es otra pieza (SPEC-060).
7. **Dónde vive en la arquitectura (SPEC-056).** El texto que se añade al prompt y la lectura de las partes son funciones puras de `execution/text/` (`splitRule`, `parseSplit`, `checkSplit`). El orquestador sigue sin lógica de tipos de nodo: cuando un paso con reparto termina, usa la lectura de las partes para saber qué entrada lleva cada conexión, igual que hoy usa `mergeInputs` al juntar.

## Requisitos
### Modelo y validación
- **R59.1** [M8h] Reparte el Coordinador (R59.19) y solo él: un paso reparte porque su agente es `COORDINATOR_ID` (`isCoordinator`), sin ninguna opción en el modelo. Cualquier otro paso con varias salidas envía lo mismo a todos. Los diagramas que ya existen no cambian.
- **R59.2** [M8h] Las ramas de reparto de un paso son los destinos de sus conexiones normales de salida, excepto los nodos de salida y las conexiones de retorno de una revisión. Los nodos de salida reciben siempre la salida entera.
- **R59.3** [M8h] Validación: `node-split-needs-two` (un Coordinador necesita al menos 2 ramas de reparto). Es un error que impide lanzar el diagrama, como el resto de errores de validación.

### Prompt del origen
- **R59.4** [M8h] El prompt del Coordinador añade la regla de reparto (`splitRule`). La regla dice: que su trabajo se repartirá entre N pasos que trabajan a la vez, aislados y sin hablarse; cada paso con su id, su nombre, el nombre de su agente, para qué sirve, sus skills y MCP (R59.18) y su tarea (o «sin tarea»); que debe terminar con una sección `## Común` (lo compartido: contratos, tipos, decisiones) y una sección `## Para <id>` por paso, con el trabajo de ese paso; que cada sección `## Para <id>` empieza con una línea `Archivos: …` con los archivos o carpetas que tocará ese paso, y que dos partes no pueden tocar el mismo archivo ni uno dentro de una carpeta de otra; y que lo que escriba antes de `## Común` no llega a ninguna rama, solo al registro.
- **R59.5** [M8h] La regla se añade también con el motor simulado (`MockAgent`), para que los tests vean el prompt exacto, y se ve en la pestaña «Contexto» del inspector de conexiones (SPEC-042).

### Reparto
- **R59.6** [M8h] `parseSplit(output, branchIds)` es una función pura que devuelve, por cada id, `{ common, part, files }` o los problemas encontrados: `missing-part` (falta la sección de una rama, o está vacía), `unknown-part` (hay una sección `## Para <id>` de un id que no es una rama), `missing-files` (una parte no tiene línea `Archivos:`) y `overlap` (dos partes declaran el mismo archivo, o uno está dentro de una carpeta de otra; rutas normalizadas, sin distinguir `\` y `/`). Que falte `## Común` no es un error: se toma vacío.
- **R59.7** [M8h] Cuando un Coordinador termina bien, cada rama de reparto recibe como entrada `## Común` y después su parte, en este orden y con esos encabezados. Su parte nunca le llega a otra rama. `edge.traversed` lleva la entrada que se envió por esa conexión, y el inspector de conexiones enseña esa parte en «Lo que envió».
- **R59.8** [M8h] Si `parseSplit` encuentra problemas, el paso de origen no se da por terminado: se repite con su entrada original y una sección «### Corrige el reparto» con la lista de problemas, sin lanzar ninguna rama. Cuenta como intento del paso y emite `split.rejected` con los problemas. Después de 2 repeticiones por reparto, el paso falla con el motivo `split-invalid` y la lista de problemas.
- **R59.9** [M8h] El reparto se aplica después de lo que ya cierra un paso: con «Confirmar antes de terminar» (SPEC-043), se reparte la salida aprobada; con `askFirst` (SPEC-039), se reparte la salida que se dio por buena; al reanudar (SPEC-041), una salida reutilizada se vuelve a repartir con las ramas del diagrama copiado y, si ya no cumple el formato, el paso se ejecuta de nuevo en vez de reutilizarse.
- **R59.10** [M8h] Dentro de un bucle o tras una vuelta de revisión, cada pasada del origen se reparte de nuevo con su propia salida.
- **R59.11** [M8h] El reparto no cambia la espera al juntar: un paso con varias entradas sigue esperando a todas y las combina con «## nombre» (R56.14).

### Interfaz
- **R59.12** [M8h] El panel de un paso no ofrece repartir: para eso está el Coordinador, cuyo panel dice lo que hace y no deja cambiar de agente.
- **R59.13** [M8h] En el lienzo, las conexiones de reparto de un Coordinador se dibujan discontinuas, y su tarjeta lleva «· reparte entre N». El asistente añade un Coordinador con `add_coordinator` y lo conecta con `connect`.
- **R59.14** [M8h] En la vista de una ejecución, un `split.rejected` se ve en el cronograma y en el Resumen como «Reparto rechazado: …» con sus problemas.

### Quien reparte
- **R59.18** [M8h] Quien reparte conoce a cada rama por una ficha corta, no por todo su contexto: el nombre del agente, para qué sirve (recortado a 200 caracteres), y los nombres de sus skills y MCP, los del agente y los enchufados a ese paso. Se leen de la biblioteca, de la copia de la ejecución si la hay (`OrchestratorDeps.agentProfile`). Si no se puede leer, la regla sigue con el id y la tarea.
- **R59.19** [M8h] El Coordinador es una pieza fija de la app: un paso de la paleta cuyo agente (`COORDINATOR_ID`) divide el trabajo sin hacerlo. Sus instrucciones las fija esta spec (`coordinatorAgent`): no aparece en Agentes, no se edita, no se cambia por otro agente, y ningún otro paso se puede convertir en él. Sí se le pueden enchufar skills y contextos en el paso. Si un proyecto tuviera un agente con ese id, gana el de la app.

### Tests
- **R59.15** [M8h] Tests del motor con `MockAgent` y reloj determinista: `entry → coordinador → [A, B] → junta → output`, donde A recibe solo «Común + Parte A», B solo «Común + Parte B», y `junta` arranca cuando terminan los dos; el prompt del origen contiene la regla con los ids, nombres, agentes y tareas de A y B, aunque usen el mismo agente; si falta la parte de B, el origen se repite con «### Corrige el reparto», emite `split.rejected` y, si lo arregla, sigue, y tras 2 repeticiones fallidas el paso falla con `split-invalid` y ninguna rama arranca; dos partes con archivos que se cruzan (`src/a.ts` y `src/`) se rechazan como `overlap`; con un paso normal, los eventos son iguales a la grabación de referencia de SPEC-056; con una rama hacia un nodo de salida, la salida recibe el texto entero y las demás ramas, su parte.
- **R59.16** [M8h] Tests puros de `parseSplit` y `checkSplit` (rutas con `\`, mayúsculas en el id, sección vacía, `## Común` ausente) y de la validación (`node-split-needs-two`).
- **R59.17** [M8h] Tests de interfaz: el panel de un paso normal no ofrece repartir, el Coordinador sale de la paleta y el lienzo dibuja discontinuas las conexiones de reparto.

## Fuera de alcance
- Que los agentes se coordinen mientras trabajan (tablero compartido de reservas o un agente coordinador). Se verá aparte si el reparto previo no basta.
- Comprobar al fusionar los archivos que realmente tocó cada rama (solo se comprueba lo declarado).
- Un número de ramas que dependa del contenido (que el origen decida cuántas ramas lanzar). Las ramas son las del diagrama.
