# SPEC-097 · Guarda de rama al ejecutar

**Estado:** Implementada · **Hito:** M18b · **Paquetes:** `core`, `git` (nuevo), `claude`, `runtime`, `editor`, `ui`, `apps/desktop` · **Rama:** `feature/guarda-de-rama`

## Propósito
El control de versión de las ejecuciones iba regular cuando ya se estaba en una rama (petición del 11/11/2026). La app solo **observaba** git (SPEC-058): al lanzar no miraba en qué rama se estaba ni si había cambios sin commit, y nada le decía al agente en qué rama trabajar. Cada agente decidía por su cuenta, así que desde `feature/x` podía salir otra rama encima, o acabar commits en la rama en la que se estaba, o directamente en `main`.

## Cómo lo hacen otros
- Los editores avisan o impiden hacer commit directo en una rama protegida y ofrecen crear una rama (en VS Code, `git.branchProtection`).
- Los agentes de código en segundo plano crean una rama propia por tarea, con prefijo, y terminan en una PR.
- Al cambiar de rama con cambios pendientes se pregunta si se llevan o se apartan (*stash*).
- Se apunta el commit de partida para poder comparar y volver.

## Decisiones (11/11/2026)
1. **Avisar o actuar.**
   - *Primera:* un aviso con «Continuar» antes de cada ejecución.
   - *Revisión:* choca con «sin preguntas por defecto» (SPEC-051), y un aviso que siempre se acepta no protege de nada.
   - *Segunda (elegida):* la rama es **un campo más del diálogo «Ejecutar»**. No hay ningún clic de más: en una rama protegida el campo ya viene en «Rama nueva», y quedarse en ella hay que elegirlo a mano.
2. **Quién decide.**
   - *Primera:* el proceso principal mira git y devuelve un veredicto ya hecho.
   - *Revisión:* el diálogo tendría que preguntar al proceso principal en cada tecla del nombre de la rama.
   - *Segunda (elegida):* la decisión es una **función pura de `core`** (`branchGuard`). El diálogo recibe el estado de git una vez (sin rutas) y valida en vivo; el proceso principal vuelve a decidir con la misma función justo antes de arrancar, que es lo que cuenta.
3. **Que el agente respete la rama.**
   - *Primera:* solo preparar la rama antes de empezar.
   - *Revisión:* el agente puede crear otra igualmente; es justo lo que pasaba.
   - *Segunda (elegida):* cada paso de agente recibe una **regla con la rama**, compuesta en `core` (vale para cualquier motor), y si se sale salta un aviso. Los pasos que gestionan ramas («Commit y PR») se marcan con una casilla y quedan exentos.
4. **Motor simulado.**
   - *Primera:* la guarda vale para cualquier ejecución.
   - *Revisión (al repasar la solución):* una ejecución de prueba con el motor simulado crearía ramas de verdad en el repositorio sin escribir nada en ellas.
   - *Segunda (elegida):* con el motor simulado la guarda no existe.
5. **Lanzamientos sin diálogo** (cola, asistente, trabajos).
   - *Primera:* no arrancar en una rama protegida.
   - *Revisión:* dejaría paradas las ejecuciones desatendidas, que es cuando más importa no tocar `main`.
   - *Segunda (elegida):* en una rama protegida **crean su rama** (`orq/<diagrama>-<fecha>`), como los agentes en segundo plano; en las demás siguen en la que están.
6. **Dónde vive git.**
   - *Primera:* en `packages/workspace`, que ya lanza `git` para los worktrees.
   - *Revisión:* mezcla aislar ramas en paralelo con el repositorio del usuario, y el visor (SPEC-098) lo ampliará mucho.
   - *Segunda (elegida):* un puerto `VersionControl` en `core` y un adaptador propio, `packages/git`.

## Requisitos

### Git de la carpeta
- **R97.1** [M18b] `core` define el puerto `VersionControl` (`state`, `createBranch`, `stash`). `packages/git` lo implementa con `GitCli`: lanza `git` con una lista de argumentos, sin shell y sin pedir nada por la terminal. Es una capa nueva de la matriz de arquitectura: solo depende de `core` y solo la crea `apps/desktop`. Con el motor simulado no se mira ni se toca git: la carpeta cuenta como si no fuera un repositorio.
- **R97.2** [M18b] `GitCli.state()` da, sin rutas: si la carpeta es un repositorio, la rama de `HEAD` (ninguna si está suelto), el commit abreviado (ninguno sin commits), cuántos archivos tienen cambios sin commit (también los nuevos), si hay una fusión, *rebase*, *cherry-pick*, *revert* o *bisect* a medias, cuántos commits va por detrás de su remota y las ramas locales. Fuera de un repositorio, o sin `git` instalado, `repo: false`.

### Decidir
- **R97.3** [M18b] Una ejecución elige rama con `GitChoice`: seguir en la actual (`stay`) o una nueva (`new`) con nombre, desde dónde (`here` u otra rama) y, si hace falta, qué hacer con los cambios sin commit (`carry` o `stash`).
- **R97.4** [M18b] Las ramas protegidas son `main`, `master`, `develop` y `trunk`. `defaultChoice` da «rama nueva desde aquí» en una protegida y «seguir» en las demás. Quedarse en una protegida solo vale si lo elige la persona (`explicit`).
- **R97.5** [M18b] `suggestBranchName` propone `orq/<diagrama>-<aaaammdd-hhmm>`: el nombre del diagrama sin acentos ni símbolos, y un número detrás si ya existe. `validBranchName` rechaza lo que git no aceptaría.
- **R97.6** [M18b] No se lanza, con cualquier elección, si `HEAD` está suelto, hay una operación de git a medias o el repositorio no tiene commits (`hardBlock`). Sin repositorio, `branchGuard` no decide nada y la ejecución arranca como siempre.
- **R97.7** [M18b] `branchGuard` rechaza una rama nueva si hay otra ejecución en marcha en la carpeta, si el nombre no vale o ya existe, si la base no existe, o si se parte de otra rama con cambios sin commit y no se ha dicho qué hacer con ellos. Si acepta, devuelve el plan: apartar cambios (solo con `stash`), crear la rama y en cuál queda.
- **R97.8** [M18b] `guardNotices` avisa, sin impedir lanzar, de los cambios sin commit sobre los que trabajará la ejecución y de que la rama va por detrás de su remota.

### Lanzar
- **R97.9** [M18b] Al lanzar, la guarda corre lo último, con el diagrama y la entrada ya validados, para no crear una rama de una ejecución que no arranca. Sin elección se aplica `defaultChoice`. Reanudar y corregir no cambian de rama: apuntan la actual.
- **R97.10** [M18b] Si el plan lo pide, primero se apartan los cambios y luego se crea la rama. Si git falla, la ejecución no arranca y el error lo explica; si los cambios ya estaban apartados, dice con qué etiqueta y cómo recuperarlos.
- **R97.11** [M18b] El evento `run.git` va justo después de `run.started` con la rama, el commit, si la rama se creó (y desde cuál), la etiqueta del *stash* y los archivos con cambios. El resumen de la ejecución lo enseña.

### Los agentes
- **R97.12** [M18b] Cada paso de agente recibe `branchRule` con la rama acordada (`AgentRequest.git`, y queda en `agent.request`). La compone `core`, así que es la misma con `MockAgent` y con Claude, que la añade a su prompt. No la reciben los pasos de una rama aislada (SPEC-073), que ya no pueden tocar git.
- **R97.13** [M18b] Un paso de agente puede marcarse con `ownsBranch` («Este paso gestiona ramas de git»): no recibe la regla ni genera avisos, y si se cambia a otra rama, los pasos siguientes reciben la regla con esa. En otro tipo de nodo es el error de validación `node-ownsbranch-not-agent`.
- **R97.14** [M18b] Si un paso que recibió la regla crea otra rama o se cambia a otra, salta `supervisor.alert` con la regla `branch-drift`, una vez por rama y paso.

### Contrato e interfaz
- **R97.15** [M18b] El contrato ofrece `gitGuard({ diagramId })` (estado de git, nombre propuesto y ejecuciones en marcha; `null` si el proyecto no tiene git) y `startRun` admite `git`. Los dos se validan: nombres de rama como los de git, y sin campos de más.
- **R97.16** [M18b] El diálogo «Ejecutar» enseña «Rama de git» si la carpeta es un repositorio: «Seguir en <rama>» o «Rama nueva para esta ejecución» con su nombre, «Desde» (donde se está o una rama protegida que exista) y, con cambios sin commit y otra base, «Llevarlos» o «Apartarlos». En una rama protegida viene marcada «Rama nueva». Con un problema, lo dice y «Ejecutar» queda apagado. Con otra ejecución en marcha, «Rama nueva» no se puede elegir.
- **R97.17** [M18b] El panel de un paso de agente tiene la casilla «Este paso gestiona ramas de git».

## Escenarios
- **E97.a** *Dado* `main` limpio, *cuando* se abre «Ejecutar», *entonces* viene marcada «Rama nueva» con `orq/<diagrama>-<fecha>`, y al ejecutar los agentes trabajan en ella y el resumen dice «Empezó en la rama orq/… · rama nueva desde main».
- **E97.b** *Dado* `feature/x` con tres archivos sin commit, *entonces* viene marcado «Seguir en feature/x» con el aviso de los tres archivos, y nadie crea otra rama encima.
- **E97.c** *Dado* un *rebase* a medias, *entonces* «Ejecutar» está apagado y dice por qué.
- **E97.d** *Dado* el asistente lanzando `run_diagram` en `develop`, *entonces* la ejecución crea su rama sin preguntar.
- **E97.e** *Dado* un Implementador que ejecuta `git checkout -b otra`, *entonces* salta el aviso `branch-drift`; el paso «Commit y PR», marcado como que gestiona ramas, no avisa.

## Limitaciones
- Si git no deja leer el repositorio (por ejemplo, por «dubious ownership»), la carpeta cuenta como si no fuera un repositorio y la guarda no actúa.
- La regla de la rama es una instrucción: un agente puede saltársela. Por eso existe el aviso; impedirlo de verdad (denegar `git switch` en la política de comandos) queda para SPEC-098, junto con el cerrojo de ramas.
- «Otra ejecución en marcha» cuenta las de esta sesión de la app, no las de otra ventana ni las de la terminal.
- Las ramas protegidas son fijas. Hacerlas configurables por proyecto queda para SPEC-098.
- En una carpeta que no es la raíz del repositorio, los cambios sin commit que se cuentan son los de todo el repositorio.

## Fuera de alcance
- El visor de control de versiones y las acciones de git del asistente (SPEC-098).
- Volver sola a la rama anterior al terminar la ejecución, y recuperar sola el *stash*.
- Elegir la rama al reanudar o corregir.
