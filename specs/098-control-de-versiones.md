# SPEC-098 · Control de versiones: visor y acciones del asistente

**Estado:** Implementada · **Hito:** M18c · **Paquetes:** `core`, `git`, `store`, `runtime`, `editor`, `ui`, `apps/desktop` · **Rama:** `feature/versiones-local`

## Propósito
El usuario pidió (11/11/2026) un visor de control de versiones, con algo visual, y que el asistente pueda gestionar ramas. De los tres prototipos del lienzo «Visor de control de versiones» eligió el **A, tres columnas**: ramas, historial con grafo y cambios. Y añadió: «estaría genial ver cuál ha creado qué job, si es que lo ha creado», es decir, saber qué trabajo (ejecución) creó cada rama y cada commit.

Esta spec cubre el git **local**. GitHub y GitLab (PR, MR y comprobaciones) van en la siguiente, en su rama.

## Decisiones (11/11/2026)
1. **Alcance.**
   - *Primera:* un cliente de git completo (rebase, cherry-pick, resolver conflictos).
   - *Revisión:* es un producto entero y duplica la terminal integrada.
   - *Segunda (elegida):* **se ve todo, se actúa con lo de cada día**: crear, cambiar, fusionar y borrar rama, commit, subir, bajar, traer, apartar y recuperar cambios. Una fusión con conflictos se deshace sola y se manda a la terminal.
2. **Saber qué trabajo creó cada cosa.**
   - *Primera:* apuntar el hash de cada commit cuando el agente hace `git commit`.
   - *Revisión:* el motor ve el comando, no el hash; y un commit hecho por un script o un MCP se perdería.
   - *Segunda (elegida):* la ejecución apunta **el commit en el que empezó y en el que quedó la carpeta al terminar**. Sus commits son los que hay entre uno y otro (`git rev-list desde..hasta`). Las ramas salen de lo que ya se registra: la que creó la guarda (SPEC-097) y las que crearon sus agentes (SPEC-058).
3. **Dónde se guarda.**
   - *Primera:* leer los eventos de todas las ejecuciones cada vez que se abre el visor.
   - *Revisión:* son archivos grandes y el visor se abre a menudo.
   - *Segunda (elegida):* en `meta.json` de cada ejecución (`git`), que ya se lee para el historial. El tramo de commits de cada ejecución se calcula una vez y se recuerda.
4. **Cerrojo.**
   - *Primera:* bloquear todo el visor mientras hay una ejecución.
   - *Revisión:* mirar, traer del remoto, hacer commit y subir no le quitan el suelo a ningún agente.
   - *Segunda (elegida):* con una ejecución en marcha solo se bloquea **lo que mueve la carpeta**: crear rama, cambiar, bajar, fusionar, apartar y recuperar.
5. **Permisos del asistente.**
   - *Primera:* decidir en cada llamada, según la rama, si pide permiso.
   - *Revisión:* el permiso de una herramienta del asistente es fijo por herramienta (R29.3); cambiarlo es otra spec.
   - *Segunda (elegida):* cambiar, bajar y fusionar piden «Permitir» salvo con el proyecto en «Sin preguntar nunca»; **subir y borrar una rama lo piden siempre**. Mirar, crear rama, hacer commit y apartar no preguntan.
6. **Motor simulado.** La guarda de rama sigue apagada con el motor simulado (SPEC-097), pero el visor no depende del motor: es el repositorio del usuario.

## Requisitos

### Git de la carpeta
- **R98.1** [M18c] El puerto `VersionControl` amplía el de la guarda (`BranchGuardPort`) con las lecturas y acciones del visor, y `GitCli` lo implementa con `git` por lista de argumentos. Subir, bajar y traer tienen dos minutos de tope y no piden nada por la terminal. Los nombres de rama se comprueban antes de llegar a git.
- **R98.2** [M18c] `branches()` da las ramas locales y remotas (sin `origin/HEAD`), la actual, y de las que siguen a una remota, cuánto van por delante y por detrás, o si la remota ya no existe. `history(n)` da los últimos commits de todas las ramas con sus padres, autor, fecha y las ramas y etiquetas que apuntan a cada uno. `stashes()` da los cambios apartados con su etiqueta.
- **R98.3** [M18c] `changes()` da los archivos con cambios sin commit con su estado (modificado, nuevo, borrado, renombrado, sin seguir, en conflicto) y sus líneas añadidas y quitadas. `diff(archivo)` da su diferencia con el último commit, con tope de tamaño; un archivo nuevo se enseña entero como añadido y uno binario se dice. Solo admite rutas relativas dentro del repositorio.

### Qué trabajo creó cada cosa
- **R98.4** [M18c] Cada ejecución que apunta git guarda en su `meta.json` la rama en la que empezó, si se creó para ella, las ramas que crearon sus agentes y el commit de partida (`run.git` lleva `sha`). Al terminar, con el registro ya cerrado, se añade `run.git.ended` con el commit en el que quedó la carpeta.
- **R98.5** [M18c] `branchOrigins` da, para cada rama, el trabajo que la creó (si varios la nombran, el más reciente). `GitService.history` da, para cada commit, el trabajo que lo hizo: los commits entre el de partida y el de llegada de cada ejecución; si dos ejecuciones comparten un commit, es de la primera. Lo que no hizo ningún trabajo no lleva nada.

### Acciones
- **R98.6** [M18c] Las acciones (`GitAction`) son crear rama, cambiar, commit de todos los cambios, subir la rama actual a `origin`, bajar sin commits de fusión, traer, fusionar otra rama en la actual, borrar una rama ya fusionada, apartar cambios y recuperarlos. `GitService.act` comprueba la acción con el estado de ese momento, la hace y devuelve cómo queda todo. Una fusión con conflictos se deshace y lo explica.
- **R98.7** [M18c] `gitActionProblem` (pura) dice por qué una acción no se puede hacer: no hay repositorio, la rama no existe o ya existe, es la actual, hay una operación de git a medias, no hay cambios que guardar o apartar, hay cambios sin commit antes de fusionar. La rama actual y las protegidas no se borran.
- **R98.8** [M18c] Con una ejecución en marcha en la carpeta no se puede crear rama, cambiar, bajar, fusionar, apartar ni recuperar. Sí se puede mirar, traer, hacer commit y subir.

### Contrato
- **R98.9** [M18c] El contrato ofrece `gitOverview` (estado, ramas, cambios, apartados, ejecuciones en marcha y el trabajo que creó cada rama; `null` si la carpeta no es un repositorio), `gitHistory` (commits y el trabajo que hizo cada uno), `gitDiff` y `gitAct`. Nada lleva rutas del equipo. El visor funciona también con el motor simulado.
- **R98.10** [M18c] El contrato valida cada acción (tipo conocido, nombres de rama como los de git, mensaje no vacío, sin campos de más), el tope de `gitHistory` y la ruta de `gitDiff`. La diferencia de un archivo que puede llevar secretos no llega a la interfaz, y un commit no se hace si se llevaría un archivo nuevo de esos (un `.env` sin ignorar): lo dice y lo deja para la terminal.

### Interfaz
- **R98.11** [M18c] El rail tiene la sección «Versiones». En una carpeta sin repositorio lo explica. Con repositorio enseña tres columnas: ramas (locales, remotas y cambios apartados), historial con el grafo de commits y, a la derecha, los cambios sin commit con su diferencia y el formulario de commit.
- **R98.12** [M18c] `commitGraph` (pura) reparte los commits en carriles: cada commit sigue por el carril de su primer padre y abre uno por cada padre más; las filas dicen qué carriles llegan, salen y pasan de largo.
- **R98.13** [M18c] Cada rama y cada commit creados por un trabajo llevan una ficha con su nombre que abre esa ejecución. Al elegir un commit, el detalle dice qué trabajo lo hizo, o que no lo hizo ninguno.
- **R98.14** [M18c] Desde el visor se puede: crear una rama (nombre y «Desde»), elegir una rama para cambiar a ella, fusionarla en la actual o borrarla, traer, bajar, subir, hacer commit con un mensaje, apartar y recuperar. Lo que no se puede hacer sale apagado con su motivo. Borrar una rama y subir a una protegida piden confirmación. Si git falla, el motivo se ve en la pantalla. Al volver a la ventana se vuelve a leer git, por si cambió desde la terminal.
- **R98.15** [M18c] Con ejecuciones en marcha, la pantalla lo avisa y las acciones bloqueadas salen apagadas.

### Asistente
- **R98.16** [M18c] El asistente tiene `git_status`, `git_history`, `git_create_branch`, `git_switch_branch`, `git_commit`, `git_push`, `git_pull`, `git_merge_branch`, `git_delete_branch` y `git_stash`, sobre las mismas acciones y con las mismas comprobaciones que el visor. `git_status` y `git_history` dicen qué trabajo creó cada rama y cada commit.
- **R98.17** [M18c] Cada acción queda en el chat como una línea («Ha creado la rama X desde Y»). `git_switch_branch`, `git_pull` y `git_merge_branch` piden «Permitir» según el nivel del proyecto; `git_push` y `git_delete_branch` lo piden siempre.

## Escenarios
- **E98.a** *Dado* un trabajo «Spec Kit» lanzado en `develop`, *entonces* en «Versiones» la rama `orq/spec-kit-…` lleva la ficha «Spec Kit» y sus cuatro commits también; pulsarla abre esa ejecución.
- **E98.b** *Dado* un commit hecho a mano en la terminal, *entonces* no lleva ficha y su detalle dice que no lo hizo ningún trabajo.
- **E98.c** *Dado* una ejecución en marcha, *entonces* «Cambiar a esta» sale apagado con el motivo, y se puede seguir haciendo commit.
- **E98.d** *Dado* «crea una rama para el menú y sube lo que hay» al asistente, *entonces* crea la rama y hace el commit sin preguntar, y pide «Permitir» antes de subir.

## Limitaciones
- Un commit se atribuye al trabajo en cuya ejecución apareció. Si dos ejecuciones corren a la vez en la misma carpeta, o se hace un commit a mano mientras corre una, ese commit puede atribuirse a ella.
- Solo se miran las 60 ejecuciones más recientes que apuntaron git, y los 500 commits más recientes de cada una.
- Las ejecuciones anteriores a esta spec no guardaron sus commits: sus ramas pueden llevar ficha (si las creó la guarda) pero sus commits no.
- Subir necesita que git tenga guardadas las credenciales del remoto; si no, falla con el mensaje de git.
- La regla de la rama de SPEC-097 sigue siendo una instrucción con aviso: denegar a los agentes los comandos que cambian de rama no entra aquí.

## Fuera de alcance
- GitHub y GitLab: PR, MR, comprobaciones y abrir una revisión (siguiente spec, `feature/versiones-remoto`).
- Rebase, cherry-pick, renombrar ramas, elegir qué archivos entran en un commit y resolver conflictos dentro de la app.
- El indicador de rama en la barra superior y las ramas protegidas configurables.
- Varios repositorios o submódulos en un proyecto.
