# SPEC-073 · Ramas en paralelo aisladas, con fusión

**Estado:** Borrador · **Hito:** M15d · **Paquetes:** `core`, `workspace`, `claude`, `runtime`, `apps/desktop`, `editor`, `ui` · **Rama:** `feature/ramas-aisladas`

## Propósito
La constitución y el documento base prometen «agentes en paralelo con espacio de trabajo aislado y fusión», y SPEC-013 especificó el gestor (`WorkspaceManager`: worktree de git o copia, fusión por orden de llegada, conflictos e instantáneas). El gestor está hecho y probado, pero **nunca se conectó**: `composition.ts` solo usa `workspaceFiles`. Hoy todas las ramas en paralelo trabajan en la misma carpeta (auditoría del 08/11, P1). Consecuencias:
- Dos ramas que tocan el mismo archivo se pisan sin que nadie lo vea: gana la última que escribe.
- El límite de archivos de cada rama (R60.16, `withScope`) solo existe con Supervisor y Coordinador, y un comando de Bash lo salta.
- Una rama puede leer a medias lo que está escribiendo otra.

Además, conectar el gestor tal como está tendría un fallo: `git worktree add --detach HEAD` parte del último commit, **sin los cambios aún no guardados en git** que dejaron los pasos anteriores. La rama no vería ese trabajo, y al fusionar cualquier archivo cambiado antes del abanico parecería un conflicto.

## Cómo lo hacen otros
- Claude Code y otros agentes de código usan **un `git worktree` por tarea en paralelo** para que cada agente tenga su carpeta y su índice, y se fusiona al final.
- Los sistemas de compilación distribuida y los CI aíslan cada trabajo en una copia y **fusionan por archivo con detección de conflictos**, nunca escribiendo dos a la vez en el mismo sitio.

## Decisiones (08/11/2026)
1. **Qué se aísla.**
   - *Primera:* cada paso de agente que puede escribir, como decía R13.1.
   - *Revisión:* los pasos en serie no necesitan aislarse, y aislarlos cuesta crear y fusionar una copia en cada paso, también cuando no hay nadie más trabajando.
   - *Segunda (elegida):* **solo las ramas que corren en paralelo**. La unidad es la rama entera, desde el paso que sale del abanico hasta antes del paso que las junta, con todo lo que tenga dentro (bucles, revisiones, subdiagramas). Los pasos en serie siguen en la carpeta de trabajo.
2. **Worktree o copia.** La auditoría dejó la pregunta abierta y no hubo respuesta, así que se toma lo que ya hace el gestor: **worktree de git si la carpeta de trabajo es un repositorio, copia si no**, con el aviso de tamaño de R13.8.
3. **Con qué empieza la rama.**
   - *Primera:* el último commit, como hace hoy el gestor.
   - *Revisión:* pierde el trabajo sin commit de los pasos anteriores (ver Propósito).
   - *Segunda (elegida):* **el estado real de la carpeta en el momento del abanico**. Se crea el worktree y se copian encima los cambios sin guardar y los archivos nuevos no ignorados. La foto que sirve de base para fusionar es la de la carpeta, no la del commit.
4. **Git dentro de una rama aislada.**
   - *Primera:* dejar que la rama haga commits en su worktree y fusionar ramas de git al final.
   - *Revisión:* eso convierte cada abanico en una fusión de historiales, con conflictos que la persona no ve en el diagrama, y choca con el seguimiento de ramas de SPEC-058.
   - *Segunda (elegida):* **en una rama aislada no se cambia el historial**. Los comandos de git que leen se permiten; los que escriben (commit, checkout, switch, merge, rebase, reset, stash, push, branch con cambios) se deniegan con un mensaje que explica que el commit se hará después de juntar las ramas. Lo habitual (un paso «Commit y PR» después de juntar) sigue funcionando.
5. **Cómo se fusiona.**
   - *Primera:* por archivo entero, como hace el gestor.
   - *Revisión:* dos ramas que tocan funciones distintas del mismo archivo darían conflicto sin motivo.
   - *Segunda (elegida):* **por archivo y, si los dos cambiaron el mismo archivo de texto, a tres bandas por líneas** (`git merge-file`, también sin repositorio). Solo es conflicto si se solapan las líneas.
6. **Qué pasa con un conflicto.** No se para la ejecución en seco ni se elige solo: **pregunta a la persona**, como «no terminó lo pedido» (R62.4), con las dos versiones a la vista.

## Requisitos
### Cuándo y cómo se aísla
- **R73.1** [M15d] `parallelRegions(diagram)` (pura, en `core`) devuelve, por cada nodo del que salen dos o más aristas que pueden correr a la vez (no un router ni una revisión, que eligen), las ramas que salen de él: el conjunto de nodos alcanzables desde cada salida antes de llegar al nodo que las junta. Un nodo alcanzable desde dos ramas es el que las junta y no pertenece a ninguna.
- **R73.2** [M15d] Con «Aislar las ramas en paralelo» activo (Ajustes › Ejecución, activo por defecto), cada rama que contiene algún paso de agente que puede escribir recibe su espacio al arrancar su primer paso. Todos los pasos de la rama trabajan en ese espacio. Una rama solo de lectura (R13.4) no se aísla.
- **R73.3** [M15d] Las ramas anidadas (un abanico dentro de una rama) se aíslan a partir del espacio de su rama, y se fusionan en él, no en la carpeta de trabajo.
- **R73.4** [M15d] El espacio se crea a partir de la carpeta de trabajo (R31.1), no de la carpeta del proyecto, si son distintas.
- **R73.5** [M15d] Con git, tras `worktree add`, se copian al worktree los archivos cambiados y los nuevos no ignorados de la carpeta (`git status --porcelain`), y se borran los que la carpeta borró. La base de la fusión (`base`) es el manifiesto de la carpeta en ese momento. Hay un test con cambios sin commit antes del abanico.
- **R73.6** [M15d] Los espacios viven fuera de la carpeta de trabajo (en la carpeta de datos de la app, por ejecución), para que no aparezcan en `git status` ni en las fotos de `CommandWatch`.
- **R73.7** [M15d] Se emite `workspace.opened` (`regionId`, `branchNodeIds`, `strategy: 'git' | 'copy'`, `warning?`). La ruta del espacio no sale en el evento: el renderer nunca ve rutas.

### Lo que puede hacer una rama aislada
- **R73.8** [M15d] El adaptador recibe la carpeta del espacio como `cwd` y como raíz de la política de escritura. Escribir en la carpeta de trabajo original desde una rama aislada se deniega siempre, también con «Sin preguntar nunca», porque rompería el aislamiento; da `supervisor.alert` `blocked`. Fuera de las dos carpetas vale lo de siempre (R31.3, R50.5).
- **R73.9** [M15d] En una rama aislada, `classifyCommand` marca como «git que escribe» `commit`, `checkout`, `switch`, `merge`, `rebase`, `reset`, `stash`, `push`, `pull`, `tag` y `branch` con argumentos que crean, borran o mueven. Se deniegan con el mensaje «En una rama en paralelo no se cambia git: el commit se hace después de juntar las ramas». Da `supervisor.alert` `blocked`.
- **R73.10** [M15d] El seguimiento de ramas de git (SPEC-058) no registra nada desde un espacio aislado.

### Fusión
- **R73.11** [M15d] Cuando el último paso de una rama termina bien, su espacio se fusiona en el destino (la carpeta de trabajo o el espacio de la rama que la contiene), en orden de llegada, antes de que pueda arrancar el nodo que junta las ramas.
- **R73.12** [M15d] Para cada archivo cambiado en el espacio: si el destino no lo cambió desde la base, se copia; si los dos lo cambiaron igual, nada; si los dos lo cambiaron distinto y es texto, se fusiona a tres bandas por líneas (`git merge-file -p base destino rama`); si se solapan, o es binario, es conflicto.
- **R73.13** [M15d] Se emite `workspace.merged` (`regionId`, `nodeId`, `files`, `mergedByLines`) y, si hay conflictos, `workspace.conflict` (`nodeIds`, `files`).
- **R73.14** [M15d] Con un conflicto, el nodo que junta las ramas no arranca y se pregunta a la persona (`agent.question` con `kind: 'conflict'`): los archivos, las dos versiones para comparar y las opciones «Quedarme con la de <rama A>», «Quedarme con la de <rama B>», «Que lo junte un agente» y «Parar la ejecución». Su `fallback` (R70.13) es «Parar la ejecución».
- **R73.15** [M15d] «Que lo junte un agente» lanza un paso interno con el agente del nodo que junta si es un paso de agente, y si no con el del último paso de la rama que terminó después. Recibe las dos versiones y la base de cada archivo en conflicto y la tarea de unirlas sin perder nada de ninguna. Cuenta en el presupuesto y en el registro como un paso más (`nodeId` del nodo que junta, `kind: 'merge'`).
- **R73.16** [M15d] Las dos versiones de cada conflicto se guardan en `runs/<runId>/conflicts/<rama>/` y se pueden previsualizar (SPEC-054) desde la pregunta.
- **R73.17** [M15d] Una rama que falla o se cancela no se fusiona. Su espacio se guarda en `runs/<runId>/discarded/<rama>/` (solo lo cambiado) para poder verlo, y luego se borra.

### Limpieza y vista previa
- **R73.18** [M15d] Los espacios se borran al fusionar, al cancelar y al terminar la ejecución, y también al arrancar la app si quedaron de un cierre inesperado (R13.7), con `git worktree prune`.
- **R73.19** [M15d] La vista previa de un archivo de un paso en marcha dentro de una rama aislada lee de su espacio; después de fusionar, de la copia del paso (R54.3).

### Interfaz
- **R73.20** [M15d] En el lienzo, las ramas aisladas de una ejecución llevan una marca «aislada» y, al fusionar, «fusionada» o «conflicto» en el nodo que junta.
- **R73.21** [M15d] En el editor, un abanico sin aislamiento (Ajustes apagado) avisa: «Estas ramas comparten carpeta: si tocan los mismos archivos, se pisan».

## Escenarios
- **E73.a** *Dado* un paso que deja `spec.md` sin commit y un abanico a dos Implementadores, *entonces* los dos ven `spec.md` y su fusión no da conflicto por él.
- **E73.b** *Dado* dos ramas que cambian funciones distintas de `api.ts`, *entonces* se fusionan por líneas sin preguntar.
- **E73.c** *Dado* dos ramas que cambian la misma línea de `config.json`, *entonces* el paso que junta espera y la persona elige con las dos versiones a la vista.
- **E73.d** *Dado* un agente de una rama aislada que ejecuta `git commit`, *entonces* se le deniega con el motivo y el paso «Commit y PR» que va después de juntar hace el commit de todo.
- **E73.e** *Dado* un cierre inesperado con dos espacios abiertos, *entonces* al abrir la app se borran y `git worktree list` ya no los muestra.

## Cambia
- **R13.1:** solo se aíslan las ramas en paralelo, no todo paso que escribe (R73.1–R73.2).
- **R13.2:** la base de la fusión es la carpeta en el momento del abanico (R73.5), y se fusiona por líneas cuando se puede (R73.12).
- **R13.3:** un conflicto pregunta a la persona (R73.14) en vez de dejar la ejecución «requiere atención».
- **SPEC-013** pasa a decir que su integración con el orquestador está en esta spec.

## Fuera de alcance
- Aislar ejecuciones simultáneas del mismo diagrama (SPEC-052 avisa de que comparten carpeta). El mismo gestor serviría; se hará en una spec aparte.
- Instantáneas por vuelta de bucle (R13.5).
- Fusionar historiales de git de varias ramas.
