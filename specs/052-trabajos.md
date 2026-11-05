# SPEC-052 · Trabajos: lanzar el mismo diagrama varias veces y un diseñador que solo diseña

**Estado:** Implementada (M8g) · **Hito:** M8g · **Paquetes:** `core`, `claude`, `runtime`, `editor`, `ui`, `apps/desktop`

## Propósito
El 05/11 el usuario pidió poder lanzar el mismo diagrama varias veces, que una ejecución lanzada se viera en la pantalla de ejecuciones y que el diseñador sirviera solo para diseñar. Propuso una sección «Jobs» con la lista de diagramas para ejecutarlos. Se presentaron tres prototipos en el artefacto «Diseñador, Trabajos y Ejecuciones» y eligió **A**: una sección «Trabajos» desde la que se lanza. Después probó un tablero por columnas (En marcha, Te necesita, Por revisar, Finalizado) y decidió volver a la A, pero con una banda con el estado de las ejecuciones arriba y con iconos. La vista detallada de cada ejecución sigue en Ejecuciones. Lo común a los tres prototipos también entra en esta spec: el diseñador sin cerrojo ni estado de ejecución, la copia de lo que usa cada ejecución y la cola.

Qué lo impedía:
- El motor ya podía tener varias ejecuciones a la vez y guardaba la copia del diagrama (R35.16).
- El cerrojo R32.37 dejaba el diagrama y sus agentes en solo lectura mientras corría.
- Los agentes, skills, contextos, MCP y subdiagramas se leían del disco en cada paso, así que editar a mitad de una ejecución la cambiaba.
- El diseñador pintaba el estado de la ejecución que se seguía.

## Cómo lo hacen otros
- En GitHub Actions, Jenkins o n8n, el flujo se edita en un sitio y se lanza desde otro. Cada ejecución usa la definición del momento en que se lanzó, y la concurrencia se elige: en paralelo o en cola (`concurrency` de GitHub Actions).

## Requisitos

### Motor
- **R52.1** [M8g] Al lanzar, la ejecución se queda con una copia de lo que usa y sus pasos solo leen esa copia, así que cambiar, renombrar o borrar algo después no la afecta. La copia incluye:
  - el diagrama (R35.16);
  - los subdiagramas a los que llega, también los anidados;
  - las definiciones de los agentes, contextos, skills y servidores MCP del proyecto (`LibrarySnapshot`).
  
  Se leen en el momento los secretos de los MCP y los archivos de la carpeta de una skill que no son su `SKILL.md`. Reanudar (R41) hace una copia nueva. `ClaudeEnvironment` recibe el `runId` en `loadAgent`, `loadContexts`, `loadSkills` y `loadMcp`, y el orquestador lo pasa a `resolveTemplate`.
- **R52.2** [M8g] Puede haber varias ejecuciones a la vez, también del mismo diagrama. Ya no hay cerrojo (sustituye a R32.37):
  - guardar, renombrar o borrar un diagrama, un agente, una skill, un contexto o un MCP nunca se rechaza por estar en uso;
  - el asistente tampoco tiene esa limitación.
- **R52.3** [M8g] Cola por diagrama. Al lanzar se elige `whenBusy`: `parallel` (por defecto) o `queue`.
  - Con `queue`, si hay alguna ejecución del mismo diagrama en marcha o en cola, el lanzamiento no arranca: entra en la cola de ese diagrama con la copia de R52.1 tomada en ese momento, y `start` devuelve `{ queuedId }` en lugar de `{ runId }`.
  - Cuando termina, falla o se cancela la última ejecución en marcha de ese diagrama, arranca la primera de su cola. Si al arrancar da un error, se pasa a la siguiente.
  - `queued()` lista la cola (id, diagrama, nombre, entrada y hora) y `unqueue(id)` quita un lanzamiento.
  - Cerrar el proyecto vacía la cola. La cola no se guarda en disco.

### Contrato
- **R52.4** [M8g] IPC:
  - `startRun` acepta `whenBusy` y devuelve `{ runId }` o `{ queuedId }`.
  - Canales nuevos y validados: `listQueue` y `unqueue` (id seguro).
  - `listJobs` devuelve, por cada diagrama del proyecto, su id, su nombre, el número de pasos (los nodos que no son entrada ni salida, también dentro de bucles) y el número de problemas de validación.
  - La lógica pura `jobsBanner(runs, esperando, queue, now)` (`packages/editor`) cuenta las ejecuciones en marcha sin preguntas, las que esperan una respuesta, permiso o confirmación, los lanzamientos en cola y las terminadas en las últimas 24 h (cuántas de ellas fallaron o se interrumpieron).
  - La lógica pura `jobRows(jobs, runs, queue, pending, now)` (`packages/editor`) junta los diagramas con el historial. Por diagrama da: la última ejecución (estado y hace cuánto), cuántas hay en total, en marcha, esperando respuesta y en cola, y si se puede lanzar. Ordena primero lo que tiene algo en marcha o en cola, luego por la última ejecución más reciente y luego por nombre. `filterJobs(rows, texto)` busca por nombre sin distinguir mayúsculas ni acentos.

### Trabajos
- **R52.5** [M8g] El rail tiene «Trabajos», entre «Conocimiento» y «Ejecuciones».
- **R52.6** [M8g] La pantalla Trabajos (prototipo A) tiene un título, una explicación («Tus diagramas listos para lanzar. Cada lanzamiento es una ejecución independiente.») y una búsqueda.
  - **Banda de estado:** debajo del título hay cuatro piezas, cada una con su icono y su número: «En marcha», «Te necesitan», «En cola» y «Terminadas (24 h)», esta con «N con error» si alguna falló o se interrumpió. Se resaltan cuando su número no es cero (la de «Te necesitan», con el acento). Cada pieza lleva a Ejecuciones: «En marcha» y «En cola» a «En directo», «Te necesitan» a «Necesitan tu respuesta» y «Terminadas» a «Historial».
  - **Tarjetas:** una por diagrama, en el orden de R52.4, con los que tienen problemas al final. Cada una lleva el icono del diagrama, el nombre, «N pasos» y «última: <estado> hace <tiempo>» (o «nunca ejecutado») con sus iconos, «N ejecuciones», y las marcas «N en marcha», «N esperan respuesta» y «N en cola». Una con algo en marcha o en cola se resalta.
  - **Botones:** «Lanzar» (R52.7), «Ver ejecuciones» (solo si las hay; abre Ejecuciones › Historial filtrado por ese diagrama) y «Editar», que lo abre en el Diseñador.
  - Si el diagrama tiene problemas, no hay «Lanzar»: dice «N problemas» y ofrece «Arreglar en el diseñador».
  - Sin diagramas, invita a crear uno en el Diseñador. Si la búsqueda no encuentra nada, lo dice. Al pie: «Al lanzar se abre la ejecución en «Ejecuciones». Aquí ves de un vistazo cómo va todo y lanzas; el detalle está allí.»
- **R52.7** [M8g] Lanzar un diagrama abre el diálogo Ejecutar (SPEC-048) de ese diagrama, aunque no sea el que está abierto en el Diseñador. El diálogo trae su entregable, sus pasos finales y la última entrada que se usó con él.
  - «Guardar en el diagrama» guarda el entregable en ese diagrama.
  - Si ya hay ejecuciones de ese diagrama en marcha o en cola, el diálogo lo dice («Ya hay N ejecuciones de este diagrama en marcha.») y ofrece «A la vez, en la misma carpeta» (por defecto) o «En cola».
  - La casilla «Quedarme donde estoy» decide a dónde se va después:
    - sin marcar, se abre la vista de la nueva ejecución en Ejecuciones, o «En directo» si quedó en cola;
    - marcada, se queda en la sección y muestra un aviso con la ejecución lanzada.

### Diseñador
- **R52.8** [M8g] El Diseñador solo diseña:
  - Nunca queda en solo lectura por una ejecución. La paleta, los menús, el selector de diagramas, «Nuevo», renombrar, duplicar y eliminar funcionan siempre.
  - El lienzo, el panel del paso y su ventana grande no muestran el estado de ninguna ejecución: ni colores de paso, ni recorrido, ni «En marcha», ni el aviso de ejecución terminada, ni la tarjeta del hilo (SPEC-042).
  - En la barra, «Ejecutar» se llama «Lanzar…» y abre el diálogo de R52.7 con el diagrama abierto.
  - En el Diseñador, la barra no tiene el estado, el medidor ni pausar/cancelar de una ejecución. En cualquier sección muestra «N en marcha» cuando hay ejecuciones en curso, que abre Ejecuciones › En directo, y las preguntas pendientes de todas las ejecuciones. Fuera del Diseñador sigue mostrando el estado, el medidor y los controles de la última ejecución lanzada (R32.20).
  - Las marcas de la paleta de diagramas (el que corre y la mano levantada, R38 y R39.6) se mantienen.

### Ejecuciones
- **R52.9** [M8g] «En directo» muestra, debajo de las ejecuciones en marcha, «En cola» con cada lanzamiento en cola (diagrama, entrada, desde cuándo y «Quitar de la cola»). Sin nada en marcha ni en cola, conserva su aviso. El número del apartado cuenta lo que está en marcha y en cola.

## Escenarios
- En Trabajos pulso «Lanzar» en «Informe semanal» y se abre su ejecución. Vuelvo a Trabajos y lo lanzo otra vez con otra entrada, «A la vez». La banda dice «2 En marcha» y la tarjeta de «Informe semanal», «2 en marcha». Si una pide permiso para `git push`, la banda pasa a «1 Te necesitan» y la tarjeta dice «1 espera respuesta».
- Mientras corren, cambio la tarea del Redactor en el Diseñador y sus instrucciones en la ficha. Las dos ejecuciones siguen con lo de antes, y la siguiente que lance usará lo nuevo.
- Lanzo una tercera «En cola». Aparece en «En directo › En cola» y arranca sola cuando terminan las dos anteriores.
- «Revisión de PR» tiene un paso sin agente: su tarjeta dice «1 problema» y «Arreglar en el diseñador» lo abre allí.

## Fuera de alcance
- Lanzamientos guardados (prototipo B), una sección única «Ejecutar» (prototipo C) y el tablero por columnas (se probó y se descartó el 05/11).
- «Copia aislada» de la carpeta de trabajo para ejecuciones simultáneas: hoy comparten la carpeta (lo dice el diálogo).
- Guardar la cola en disco y seguir tras cerrar la aplicación.
- Copiar los archivos de la carpeta de una skill y los secretos de MCP.
