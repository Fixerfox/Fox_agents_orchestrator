# SPEC-076 · Memoria del proyecto

**Estado:** Borrador · **Hito:** M15g · **Paquetes:** `core`, `store`, `claude`, `runtime`, `editor`, `ui` · **Rama:** `feature/memoria-proyecto`

## Propósito
Cada ejecución empieza de cero. Lo que la persona enseña en una ejecución se pierde al terminarla (auditoría del 08/11, M5 y S6):
- Las correcciones («los tests van en `__tests__`, no junto al código»).
- Las respuestas que se repiten («usa PostgreSQL», ejecución tras ejecución).
- Los avisos del Supervisor que ya se sabe que son falsos.

Mientras tanto, los agentes sí pueden acumular memoria **por su cuenta y sin que se vea**: con la configuración de Claude Code cargada (`claudeConfig`), Claude Code tiene su propia memoria automática fuera del proyecto, en la máquina, y puede editar `CLAUDE.md`. Es memoria que cambia el comportamiento de las ejecuciones siguientes y que nadie ha revisado.

Esta spec añade la **capa 3 de la memoria**: lo que el proyecto ha aprendido, guardado en el propio proyecto, visible y editable, y **siempre aprobado por una persona**. También fija la política de la capa 4, la memoria propia de Claude Code.

## Cómo lo hacen otros
- **LangGraph** guarda la memoria a largo plazo en un almacén por **espacios de nombres**, compartido entre hilos, y la clasifica en semántica (hechos), episódica (experiencias) y procedimental (reglas, que en la práctica son el prompt del agente), siguiendo el marco CoALA. [Memoria en LangGraph](https://docs.langchain.com/oss/python/langgraph/memory) · [Conceptos de memoria](https://docs.langchain.com/oss/python/concepts/memory/index.html)
- **Mem0** no acumula sin más: cada recuerdo nuevo se compara con los parecidos que ya hay y se decide si **se añade, se actualiza, se borra el contradicho o no se hace nada**. Así se evita que la memoria se llene de lo mismo. [Mem0](https://github.com/mem0ai/mem0)
- **Claude Code** tiene `CLAUDE.md`, que escribe la persona, y una memoria automática con un índice `MEMORY.md`. Las primeras 200 líneas o 25 KB del índice se cargan al empezar y los archivos de cada tema se leen cuando hacen falta. Esa memoria es local a la máquina. [Memoria de Claude Code](https://code.claude.com/docs/en/memory)
- **La herramienta de memoria de Anthropic** guarda la memoria como archivos en un directorio que gestiona la aplicación, y exige rechazar cualquier ruta fuera de él. [Herramienta de memoria](https://platform.claude.com/en/docs/agents-and-tools/tool-use/memory-tool)
- **Letta** deja en el contexto un núcleo pequeño y siempre visible, y el resto en una memoria de archivo que el agente consulta con una herramienta. [Letta](https://docs.letta.com/guides/agents/memory)

## Decisiones (08/11/2026)
1. **Qué se recuerda.**
   - *Primera:* lo más útil de la memoria de cada ejecución.
   - *Revisión:* casi todo es de esa ejecución (qué paso tocó qué archivo) y no vale para la siguiente. Guardarlo llenaría la memoria de ruido.
   - *Segunda (elegida):* **lo que la persona enseñó o corrigió, y lo que es verdad del proyecto**. Hay cuatro tipos:
     - *convención*: un hecho del proyecto («los tests van en `__tests__`»);
     - *preferencia*: cómo quiere la persona que se hagan las cosas;
     - *lección*: algo que salió mal y cómo evitarlo;
     - *aviso falso*: para el Supervisor.

     Lo procedimental (cambiar cómo trabaja un agente) no es memoria: se propone como cambio de su ficha, que ya tiene su editor y su vista de diferencias.
2. **¿Aprende sola?** La auditoría dejó la pregunta abierta y no hubo respuesta, así que se toma la opción conservadora.
   - *Primera:* aprender sola, como la memoria automática de Claude Code.
   - *Revisión:* un recuerdo equivocado se aplica a todas las ejecuciones siguientes sin que nadie lo vea. La consolidación con IA (al estilo de Mem0) es probabilística.
   - *Segunda (elegida):* **la app propone y la persona aprueba**. Nada entra en la memoria sin un «Guardar».
3. **De dónde salen las propuestas.**
   - *Primera:* de todo lo que hicieron los agentes.
   - *Revisión:* lo que un agente dice no es lo que el proyecto ha aprendido.
   - *Segunda (elegida):* **solo de lo que dijo la persona**: correcciones, revisiones humanas con cambios, «Repetir el paso» con texto, confirmaciones con cambios, preguntas que se repiten entre ejecuciones y avisos que marcó como falsos (R75.21).
4. **Cómo se evita la memoria repetida.** Como Mem0: antes de proponer, cada candidata se compara con lo que ya hay en su ámbito, y la propuesta puede ser **añadir, actualizar una que ya existe, archivar la que contradice** o descartarse. La persona ve el cambio antes de guardarlo.
5. **Cómo la reciben los agentes.**
   - *Primera:* todo en el prompt.
   - *Revisión:* crece sin tope, y la mayor parte no tiene que ver con el paso.
   - *Segunda (elegida):* **como Claude Code**. Un índice con tope va siempre en el prompt de sistema; como no cambia durante la ejecución, no rompe la caché. El texto completo se lee bajo demanda con una herramienta de solo lectura.
6. **Ámbitos.** Como los espacios de nombres de LangGraph: el **proyecto**, un **diagrama** y un **agente**. Un paso recibe lo del proyecto, lo de su diagrama y lo de su agente.
7. **Dónde vive.** En la carpeta del proyecto (`.orquestador/memory/`), en JSON versionado, para que viaje con el repositorio y el equipo la comparta. No en la carpeta de usuario: la memoria del proyecto es del proyecto.
8. **La memoria propia de Claude Code** se apaga en los agentes que lanza el orquestador, para que toda la memoria que cambia su comportamiento esté a la vista. `CLAUDE.md` se sigue leyendo según Ajustes (`claudeConfig`). Que un paso lo edite salta como aviso, porque cambia todas las ejecuciones siguientes.

## Requisitos
### Modelo y almacén
- **R76.1** [M15g] Una entrada de memoria tiene: `id`, `kind` (`convention`, `preference`, `lesson`, `false-alarm`), `scope` (`project`, `diagram:<id>` o `agent:<id>`), `title` (80 caracteres como máximo), `text` (600 como máximo), `status` (`active` o `archived`), `source` (`runId?`, `nodeId?`, `origin`: `correction`, `review`, `retry`, `confirm`, `repeated-question`, `alert-feedback`, `manual` o `assistant`), `createdAt`, `updatedAt`, `lastUsedAt?`, `uses` e historial de cambios.
- **R76.2** [M15g] Las entradas se guardan en `.orquestador/memory/entries.json` (`schemaVersion`, con migración como el resto del proyecto, SPEC-010) y se vuelve a escribir `.orquestador/memory/MEMORIA.md`, un índice legible por ámbito. Escritura atómica.
- **R76.3** [M15g] Al escribir se ocultan los secretos (`redactSecrets`) y se rechaza el texto que parezca una clave. Ningún archivo de memoria puede estar fuera de `.orquestador/memory/` (se comprueba la ruta real, como R54.4).
- **R76.4** [M15g] Un proyecto tiene como mucho 300 entradas activas. Al pasar de 200 se avisa en la pantalla de memoria de que conviene archivar.

### Propuestas
- **R76.5** [M15g] Al terminar una ejecución (también fallida o cancelada), `proposeMemories` reúne las señales de la decisión 3: correcciones (R53), revisiones humanas con cambios, «Repetir el paso» con texto (R62.5), confirmaciones con cambios (R43.7), avisos marcados (R75.21) y preguntas cuyo texto ya se respondió en alguna de las 20 ejecuciones anteriores del proyecto.
- **R76.6** [M15g] Si hay señales, una sola consulta de un turno al modelo del Supervisor (`Decider.proposeMemory`) recibe las señales, como datos, y las entradas activas de los ámbitos afectados. Devuelve como mucho 5 propuestas, cada una `add`, `update` (con el `id` y el texto nuevo) o `archive` (con el `id` y el motivo), con su ámbito y su tipo. Lo que gasta cuenta en el uso de la ejecución, sin disparar su límite (como R60.14).
- **R76.7** [M15g] El prompt dice: que solo se propone lo que la persona dijo o corrigió; que una propuesta es general para el proyecto, no un detalle de esta ejecución; que no se repite lo que ya hay; y que en caso de duda no se propone.
- **R76.8** [M15g] Las propuestas salen como `memory.proposed` (`proposals`) después de `run.finished`, como `run.accepted` (R65.5). Ninguna se guarda sola.
- **R76.9** [M15g] Sin señales no se consulta al modelo. Con el motor simulado las propuestas salen de una regla fija para poder probarlas.

### Aprobación
- **R76.10** [M15g] El Resumen de la ejecución tiene «Para recordar» con cada propuesta: su tipo, su ámbito, el texto (en las de `update`, la diferencia con el actual) y de qué señal sale, con «Guardar», «Editar y guardar» y «Descartar». La bandeja avisa: «3 cosas para recordar de <diagrama>».
- **R76.11** [M15g] Guardar o descartar se anota en el historial de la entrada y en el registro de la ejecución (`memory.decided`). Una propuesta descartada no se vuelve a proponer igual (se compara el texto normalizado) en las 20 ejecuciones siguientes.
- **R76.12** [M15g] El asistente puede proponer y, con permiso de la persona (como R65), guardar entradas. Lo que guarda lleva `origin: 'assistant'`.

### Lo que reciben los agentes
- **R76.13** [M15g] Al lanzar una ejecución, la memoria del proyecto entra en su copia (R52.1): la ejecución usa la memoria tal como estaba al arrancar.
- **R76.14** [M15g] Cada paso de agente recibe en el prompt de sistema la sección «Memoria del proyecto», marcada como datos y no como órdenes, con las entradas activas de su proyecto, su diagrama y su agente: título y texto, en este orden de prioridad: agente, diagrama, proyecto; dentro de cada ámbito, las usadas más recientemente. El tope es 1.500 tokens (Ajustes › Memoria, R72.15); lo que no cabe se lista solo por título con «léela con `memoria_proyecto`».
- **R76.15** [M15g] Los agentes tienen la herramienta MCP de solo lectura `memoria_proyecto` (en proceso, sin red), con `buscar(texto)` y `leer(id)` sobre las entradas de sus ámbitos. No tiene forma de escribir.
- **R76.16** [M15g] `agent.request` registra qué entradas recibió el paso (`projectMemory`: ids). Al terminar la ejecución se actualizan `lastUsedAt` y `uses` de esas entradas.
- **R76.17** [M15g] El Supervisor recibe, en `supervise` y `verifyRun`, las entradas `false-alarm` del agente y del diagrama del paso, como «Avisos que la persona marcó como falsos antes». El prompt dice que no son para callar un problema con evidencia nueva.

### Memoria propia de Claude Code
- **R76.18** [M15g] El adaptador de Claude lanza los agentes con la memoria automática de Claude Code apagada (`CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` en el entorno). Ajustes › Memoria tiene «Dejar que Claude Code guarde su propia memoria» (apagado por defecto), con una línea que explica que esa memoria es local al equipo y no se ve en la app.
- **R76.19** [M15g] Regla `instructions-changed` (`warning`): un paso crea o modifica `CLAUDE.md`, `CLAUDE.local.md`, `AGENTS.md` o algo dentro de `.claude/`. El detalle dice que eso cambia todas las ejecuciones siguientes.

### Mantenimiento
- **R76.20** [M15g] Una entrada que no se usa en 60 días, o que nombra una ruta que ya no existe en la carpeta de trabajo, sale marcada «¿Sigue valiendo?» en la pantalla de memoria. Nunca se archiva sola.

### Interfaz
- **R76.21** [M15g] La pantalla «Memoria del proyecto» (en Proyecto) lista las entradas por ámbito y tipo, con búsqueda, filtro «¿Sigue valiendo?», edición, archivar, restaurar, el historial de cada una y de qué ejecución salió (con enlace).
- **R76.22** [M15g] Junto a lo que recibió cada paso (R60.37) se ve qué memoria del proyecto le llegó, y cada entrada abre su ficha.

## Escenarios
- **E76.a** *Dado* que la persona corrige «los tests van en `__tests__`» en una ejecución, *entonces* al terminar se propone una convención del proyecto y, guardada, la reciben los agentes de la siguiente ejecución.
- **E76.b** *Dado* una convención «usamos MySQL» y una corrección «ya no, ahora PostgreSQL», *entonces* la propuesta es actualizar la convención, no añadir otra.
- **E76.c** *Dado* un aviso `out-of-scope` sobre `docs/` marcado como falso, *entonces* se propone un aviso falso para ese agente y el Supervisor lo recibe en la siguiente revisión.
- **E76.d** *Dado* un agente que edita `CLAUDE.md`, *entonces* salta `instructions-changed` y el Resumen lo enseña.
- **E76.e** *Dado* una ejecución sin correcciones, preguntas ni avisos marcados, *entonces* no se consulta al modelo y no hay propuestas.

## Cambia
- **SPEC-060, Fuera de alcance:** la memoria entre ejecuciones pasa a estar dentro, como capa aparte.
- **R50 (Claude Code completo):** la memoria automática de Claude Code se apaga por defecto en los agentes (R76.18).

## Fuera de alcance
- Aprender sin aprobación. Se valorará cuando haya datos de cuántas propuestas se guardan sin editar.
- Memoria entre proyectos o de usuario.
- Búsqueda semántica con embeddings: con el tope de R76.4, la búsqueda por texto basta.
- Cambiar solas las fichas de los agentes.
