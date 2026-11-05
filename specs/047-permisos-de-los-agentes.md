# SPEC-047 · Permisos de los agentes: tres niveles en el proyecto y en cada agente

**Estado:** Implementada (M8f) · **Hito:** M8f · **Paquetes:** `core`, `claude`, `editor`, `ui`

## Propósito
El 05/11, tras SPEC-045 (R45.1), los agentes con el motor real pasaron a pedir permiso para cualquier comando, también para un `mkdir`, aunque «Modificar existentes sin preguntar» estuviera activado. Es lo que decía R31.5, pero antes no se notaba porque `allowedTools` aprobaba `Bash` sin pasar por la política.

Primero se quitaron las preguntas de los comandos sencillos (R47.1–R47.3). Después, el usuario pidió que en modo automático los comandos no preguntasen nunca, salvo lo muy delicado, y que no hubiera permisos tan específicos. Por eso se cambiaron los dos interruptores («Modificar existentes sin preguntar» y «Comandos sencillos sin preguntar») por tres niveles: Preguntar, Automático y Sin preguntar nunca. Además, cada agente puede tener su nivel, o «Solo lectura».

## Cómo lo hacen otros
- Claude Code tiene modos de permisos (`default`, `acceptEdits`, `bypassPermissions`), aprueba sin preguntar los comandos de solo lectura y permite reglas por prefijo (`Bash(npm test:*)`).
- Cursor y Copilot tienen un modo automático con una lista de comandos que siempre preguntan.

## Requisitos

### Comandos sencillos
- **R47.1** [M8f] `classifyCommand(command, root, cwd?, { readOnly? })` decide si un comando es «sencillo». Lo es solo si se cumplen todas estas condiciones:
  - No tiene `;`, `|`, `||`, `&` suelto, `>`, `<`, `` ` ``, `$`, `~`, `%`, `\`, saltos de línea ni comillas sin cerrar. Se pueden encadenar varios con `&&`, y cada uno tiene que ser sencillo.
  - El programa es uno de estos: `mkdir`, `touch`, `ls`, `dir`, `pwd`, `cd`, `echo`, `cat`, `head`, `tail`, `wc`, `tree`, `stat`, `file`, `which`, `where`, `grep`, `rg` y `find` (sin `-exec`, `-execdir`, `-ok`, `-okdir`, `-delete` ni `-fprint*`); `git` con `status`, `diff`, `log`, `show`, `rev-parse`, `ls-files` o `branch` sin opciones de cambio; y `node`, `npm`, `npx`, `python`, `python3` o `pip` solo con `--version`/`-v`/`-V`.
  - Todas sus rutas quedan dentro de la carpeta de trabajo, también tras los enlaces simbólicos y tras los `cd` anteriores de la cadena. `mkdir` y `touch` no pueden tocar `.git`, `node_modules` ni `.orquestador`. En `grep`/`rg` el primer argumento es el patrón, no una ruta, y en `find` solo son rutas las que van antes de la primera expresión.
  - Con `readOnly`, `mkdir` y `touch` no son sencillos.
- **R47.2** [M8f] Los comandos sencillos no preguntan en ningún nivel. Un agente que debe preguntar antes de actuar (R39.3) sigue sin poder ejecutar nada hasta haber preguntado. El comando queda en la transcripción y en la auditoría como cualquier herramienta.
- **R47.3** [M8f] En «Preguntar», al preguntar por un comando que no es delicado, además de «Permitir» y «Denegar» se ofrece «Permitir «<clave>» en esta ejecución». La clave es el programa, y para `npm`, `npx`, `pnpm`, `yarn`, `git`, `pip`, `cargo`, `dotnet` y `go` incluye el subcomando (por ejemplo, `npm test`). Desde ese momento, los comandos con esa clave y sin caracteres especiales no preguntan en ninguna parte de esa ejecución. Nunca se ofrece para un comando delicado (R47.5), para programas que borran, mueven o cambian permisos, ni para un comando con caracteres especiales.
- **R47.4** [M8f] Los ajustes anteriores a esta spec se migran al leerlos: «preguntar todos los comandos» (`askCommands`) pasa a «Preguntar» y «Modificar existentes sin preguntar» (`autoWrite`), a «Automático». Si no había ninguno, queda «Automático». Esos dos campos ya no se guardan ni los acepta el contrato.

### Comandos delicados
- **R47.5** [M8f] `sensitiveCommand(command, root)` dice si un comando es delicado. Solo hay tres motivos, que son los que ve el usuario:
  - **Borra o descarta cambios:** `rm`, `rmdir`, `del`, `erase`, `rd`, `shred`, `unlink`, `Remove-Item`, `find -delete`; y en git, `clean`, `rebase`, `filter-branch`, `filter-repo`, `update-ref`, `rm`, `restore`, `reflog`, `reset --hard`, `checkout --`/`.`/`-f`, borrar ramas o etiquetas y `stash drop`/`clear`.
  - **Puede afectar a algo fuera de la carpeta del proyecto:** rutas absolutas ajenas (también `C:\…` y rutas de red), `..` que sale, `~`, `$HOME`, `$TMP`, `%APPDATA%` y similares, valores de opciones (`--out=../x`), destinos de `>`/`>>` fuera o en `.git`, `node_modules` o `.orquestador` (salvo `/dev/null` y `NUL`) y `cd` fuera. También lo que actúa sobre el sistema o no se puede comprobar: administrador (`sudo`, `su`, `runas`, `doas`), sistema (`dd`, `mkfs`, `format`, `diskpart`, `fdisk`, `shutdown`, `reboot`, `reg`, `setx`, `crontab`, `schtasks`, `systemctl`, `service`, `sc`, `chown`, `icacls`, `takeown`), procesos (`kill`, `taskkill`, `Stop-Process`…), `eval`, `iex`, `Invoke-Expression`, `powershell -EncodedCommand`, una shell o un intérprete que recibe algo por una tubería (`curl … | sh`), git con otro repositorio (`-C`, `--git-dir`, `--work-tree`) o con `config --global`, instalar de forma global (`-g`) y `pip uninstall`.
  - **Publica fuera del equipo:** `git push`, y `publish`, `unpublish`, `login`, `adduser`, `logout`, `token`, `owner` o `deprecate` en un gestor de paquetes.
  - Mira cada tramo del comando: los separados por `&&`, `||`, `;`, `|`, `&` y saltos de línea, y lo que va dentro de `$(…)` y `` `…` ``, también entre comillas dobles. También mira lo que se ejecuta con `bash -c`, `sh -c`, `cmd /c` o `powershell -Command`, con `xargs` y con `find -exec`. En la duda, es delicado.
- **R47.6** [M8f] Un comando delicado pregunta en «Preguntar» y en «Automático». La pregunta dice el motivo («¿Puedo ejecutar este comando? (borra o descarta cambios)») y no ofrece «en esta ejecución».
- **R47.7** [M8f] En Ajustes, «Reglas de los agentes» describe modificar y comandos según el nivel del proyecto, y añade la regla «Por agente». Hay 8 reglas.

### Niveles
- **R47.8** [M8f] Hay cuatro niveles (`PermissionLevel`). El proyecto usa tres (`AppSettings.permissions`; por defecto era «Automático» y desde R51.1 es «Sin preguntar nunca»), y «Solo lectura» es solo para un agente:
  - **Solo lectura** (`readonly`): lee y busca. No crea, modifica ni borra archivos, y solo ejecuta comandos sencillos que leen.
  - **Preguntar** (`ask`): crea archivos nuevos sin preguntar. Pregunta antes de modificar y antes de ejecutar comandos que no son sencillos.
  - **Automático** (`auto`): modifica sin preguntar (con copia antes) y ejecuta comandos sin preguntar, salvo los delicados.
  - **Sin preguntar nunca** (`full`): todo sin preguntar, también los comandos delicados.
- **R47.9** [M8f] La política de herramientas (R31.11) aplica el nivel efectivo. En todos los niveles se mantiene lo siguiente: escribir con las herramientas de archivos fuera de la carpeta, o en `.git`, `node_modules` o `.orquestador`, se deniega (R31.5), salvo en «Sin preguntar nunca», que solo deniega `.orquestador` (R50.5), y un agente supervisado no actúa hasta preguntar (R39.3). En «Solo lectura», escribir y los comandos que no son sencillos de lectura se deniegan sin preguntar, con un motivo que pide proponer los cambios en la respuesta.
- **R47.10** [M8f] Un agente puede tener su nivel (`AgentDefinition.permissions`, uno de los cuatro). Sin él, usa el del proyecto. `effectivePermission(agent, settings)` lo calcula y el `ClaudeAdapter` lo usa en cada paso. Se valida y el contrato IPC lo acepta.

### Interfaz
- **R47.11** [M8f] El selector «Permisos de los agentes» (Preguntar, Automático y Sin preguntar nunca, cada uno con una línea que explica lo que hace) sustituye a los interruptores en dos sitios: en el bloque «Archivos» del panel del paso (guarda al momento) y en Ajustes, en «Carpeta de trabajo». «Sin preguntar nunca» muestra un aviso. Si el agente del paso tiene su propio nivel, el bloque lo dice («Este agente usa los suyos: Solo lectura»). En «Proyecto», el apartado «Acceso» y el resumen del asistente de carpeta muestran el nivel.
- **R47.12** [M8f] La ficha del agente tiene la sección «Permisos», con «El del proyecto (<nivel>)», «Solo lectura», «Preguntar», «Automático» y «Sin preguntar nunca». Si tiene uno propio, la tarjeta de la ficha muestra «Permisos: <nivel>».

## Escenarios
- En «Automático», el Implementador ejecuta `mkdir -p src/x`, `npm install`, `sed -i …` y `npm test 2>&1 | tail -20` sin preguntar. Si intenta `git push origin main` o `rm -rf dist`, la bandeja pregunta «(publica fuera del equipo)» o «(borra o descarta cambios)».
- En «Preguntar», el Implementador pide `npm test`: elijo «Permitir «npm test» en esta ejecución» y el Revisor de la misma ejecución lanza `npm test -- --run` sin preguntar.
- Pongo al Revisor en «Solo lectura»: puede leer y ejecutar `git diff`, pero si intenta escribir un archivo se le deniega y lo propone en su respuesta.

## Fuera de alcance
- Reglas permanentes por proyecto («permitir siempre `npm test`»).
- Confinar o registrar lo que hace un comando ya permitido (sigue el límite de R31.12). Lo que modifique un comando no tiene copia previa: solo la tienen las herramientas de escritura.
- Lo que hace un script lanzado (`node build.js`, `npm run x`) no se analiza: se juzga por la línea de comando.
- Permisos por paso del diagrama (hoy son por agente y por proyecto).
