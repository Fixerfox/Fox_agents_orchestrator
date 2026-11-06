# SPEC-058 · Ramas en el diagrama

**Estado:** Implementada (M8g) · **Hito:** M8g · **Paquetes:** `core`, `claude`, `editor`, `ui` · **Rama:** `feature/ramas-en-diagrama`

## Propósito
Cuando un agente crea una rama de git o trabaja en ella, hoy no se ve en ningún sitio: hay que abrir la transcripción. El usuario pidió (06/11) ver el nombre de la rama con el amarillo de la app, destacarlo en el resumen de la ejecución y, como varios pasos pueden trabajar en ramas distintas, rodear con rayas amarillas los pasos que actuaron sobre cada una.

## Decisiones (06/11/2026)
1. *Primera:* sacar la rama de los comandos git del agente. *Revisión:* Spec Kit crea la rama con un script, y los pasos siguientes no ejecutan ningún comando git, así que se quedarían fuera. *Segunda (elegida):* el adaptador **lee `HEAD`** del repositorio además de mirar comandos y MCP. Se lee el archivo, sin lanzar `git`.
2. *Primera:* contar un paso solo si escribía archivos. *Revisión:* en una ejecución real (06/11) cuatro pasos revisaron los archivos ya hechos, no escribieron nada y se quedaron fuera aunque trabajaban en la rama. *Segunda (elegida):* todo paso de agente cuenta en la rama de `HEAD` al terminar. Pero eso solo no basta para enseñarla: **si en toda la ejecución no hubo actividad de git** (ninguna rama creada, cambiada o usada con un comando o un MCP), no se pinta nada. Un proyecto que solo vive en `main` no se llena de recuadros.
3. El motor solo emite un evento (`git.branch`); saber qué dibujar es cosa de `editor`, y la UI solo consume (bus de eventos). Detectar es del adaptador porque leer el disco no es de `core`.
4. *Primera:* además del recuadro, una ficha con la rama en cada nodo. *Revisión:* al verla en la app (06/11) el usuario pidió quitarla, porque el recuadro ya dice la rama. *Segunda (elegida):* **solo el recuadro**. Un paso que actuó en varias ramas va en el de la vigente (R58.6), y el resumen las enseña todas.

## Requisitos
- **R58.1** [M8g] Evento `git.branch` (`nodeId`, `branch`, `via: 'head' | 'command' | 'mcp' | 'ran'`, `created?`). El paso lo emite cuando el motor le avisa con `{ type: 'branch' }`. `MockAgent` puede simularlo con `branches`.
- **R58.2** [M8g] El adaptador de Claude lee `HEAD` al empezar cada intento y tras cada herramienta, subiendo desde la carpeta de trabajo hasta encontrar `.git`, que también puede ser un archivo `gitdir:` (worktree). Si la rama cambia, avisa con `via: 'head'`, y también de la rama que deja con `via: 'ran'` si no es la principal: el paso estaba en ella. Con `HEAD` suelto o sin repositorio no avisa de nada.
- **R58.3** [M8g] De los comandos con éxito: `git checkout -b`, `git switch -c` y `git branch <nombre>` crean rama (`created`); `git push` con rama la usa; `commit`, `merge`, `rebase`, `cherry-pick`, `revert`, `pull`, `am` y `git push` sin rama actúan en la rama de `HEAD`. Lo que solo lee o borra (`status`, `log`, `branch -d`, `push --delete`) y lo que va a otro repositorio (`git -C`) no cuenta, ni el texto entre comillas de un mensaje.
- **R58.4** [M8g] De las herramientas MCP con éxito de un servidor de git (nombre con `git` o `bitbucket`) o con `branch` en su nombre: toma la rama de `branch`, `branch_name`, `new_branch`, `head` (sin el `dueño:` delante), `sha` o `ref`, descartando commits y etiquetas. `create_branch` la marca `created`. Leer una rama también cuenta, salvo la principal (`main`, `master`, `develop`, `trunk`), porque eso pasa en cualquier proyecto y no es actividad.
- **R58.5** [M8g] Al terminar el intento, si hay rama, avisa con `via: 'ran'`, aunque el paso solo leyera. Cada rama se avisa una vez por intento, salvo para añadir `created`. Una herramienta que falla no cuenta por lo que pedía, pero si `HEAD` cambió se avisa igual. Un nombre que git no aceptaría se descarta.
- **R58.6** [M8g] `branchesOf(events)` da las ramas de cada paso, por orden de uso, y la lista de ramas con sus pasos y si se crearon. Con solo avisos `via: 'ran'` no da ninguna (decisión 2). `LiveView.branches` lleva las de cada paso. La vigente es la última usada, pero una rama principal nunca desbanca a otra: si un agente fusiona y vuelve a `main`, el paso sigue en la rama en la que trabajó.
- **R58.7** [M8g] La rama se ve en el recuadro (R58.8), no en el nodo. Un bucle o subdiagrama cuenta con las ramas de lo que lleva dentro.
- **R58.8** [M8g] En el lienzo, los pasos de una misma rama se rodean con un recuadro de rayas amarillas con el nombre de la rama, que incluye sus enchufes y fichas. No se puede seleccionar ni tapa los clics. Se calcula a partir de los pasos: sus medidas no vuelven al estado del lienzo, porque eso lo haría entrar en bucle.
- **R58.9** [M8g] Si el recuadro de una rama pisaría un paso de otra, se parte en un recuadro por cada grupo de pasos conectados.
- **R58.10** [M8g] El resumen de la ejecución destaca bajo el titular las ramas en amarillo, con «nueva» si se crearon y los pasos que actuaron en cada una. `summarizeRun` las devuelve en `branches`.
- **R58.11** [M8g] Evento `git.action` (`nodeId`, `branch`, `action: 'commit' | 'push' | 'pr' | 'merge' | 'delete' | 'switch'`), una vez por rama y acción en cada intento. De los comandos con éxito: `git commit` (en la rama de `HEAD`), `git push`, `git branch -d` y `git push --delete`. De los MCP con éxito: `push_files` (push), `create_or_update_file` o con `commit` en el nombre (commit), `create_pull_request` (pr), `delete_branch` (delete) y `merge_pull_request` (merge, en la rama de la última PR de ese intento). Si cambia la rama de `HEAD`, `switch` en la rama nueva. Borrar una rama no es actuar en ella: no da `git.branch`.
- **R58.12** [M8g] El nodo enseña en amarillo lo que hizo: commit, push, PR, fusión, rama borrada, cambio de rama. `LiveView.gitActions` lleva las de cada paso.
- **R58.14** [M8g] Si el agente crea una PR o un merge request, `git.action` lleva su `url`, sacada de la respuesta del MCP (`create_pull_request`, `create_merge_request`) o de `gh pr create` y `glab mr create`. Solo vale una dirección `https` de PR o MR (`/pull/n`, `/-/merge_requests/n`, `/pull-requests/n`).
- **R58.15** [M8g] El enlace se ve en el nodo, en el aviso sobre el lienzo y en el resumen, y se abre en el navegador. La ventana sigue bloqueando todo lo demás: solo deja salir direcciones con esa forma, porque las vistas previas ejecutan HTML de los agentes (R54.4).
- **R58.13** [M8g] El resumen añade a cada paso lo que hizo en esa rama, entre paréntesis, y marca «borrada» la rama que se borró.

## Fuera de alcance
- Un `cd otra-carpeta && git …` se toma como del repositorio de la carpeta de trabajo.
- Los pasos reutilizados al reanudar o corregir no heredan la rama de la ejecución anterior.
- Crear la PR desde la propia app.
