# SPEC-090 · Seguridad para la 1.0, tercera parte

**Estado:** Implementada · **Hito:** M16i · **Paquetes:** `core`, `claude`, `store`, `desktop` · **Rama:** `feature/seguridad-1.0-c`

## Propósito
Cierra lo que quedaba de la fase 1 de la auditoría para la 1.0 (09/11/2026), después de SPEC-087, 088 y 089:
- **M2.** «Solo lectura» podía ejecutar código:
  - `rg --pre=bash x script.sh` ejecuta el script, y `rg` contaba como comando «sencillo» también en «Preguntar».
  - `git status`, `git diff` y `git log -p` ejecutan `core.fsmonitor`, los `textconv` y el `diff.external` de un `.git/config` que venga con el proyecto (por ejemplo, en un zip).
  - `tree -o archivo` escribe.
- **M7.**
  - La ocultación de secretos en los registros solo reconocía unos pocos patrones (`sk-…`, `ghp_…`, `Bearer …`): un token de Slack, Google, AWS o Notion, o el valor de un secreto MCP que devolviera una herramienta, quedaba tal cual en `events.jsonl`.
  - Además, `.orquestador/runs/` no tenía `.gitignore`.
- **Linux sin llavero.** Electron puede cifrar con `basic_text`, una clave conocida, y aun así decir que el cifrado está disponible.
- **Puntos bajos:**
  - SPEC-079 no veía comodines (`taskkill /IM electron*`), filtros de PowerShell ni `wmic … like`, ni matar el orquestador por su PID.
  - El asistente no tenía esa protección.
  - El IPC no miraba qué marco llamaba.
  - El modo prueba dejaba abrir terminales por `call_api`.
  - La propuesta de corrección (`blame`) metía la salida de los agentes sin `<datos>`.
  - Un enlace simbólico dentro de una skill permitía leer o escribir fuera de ella.

## Decisiones (10/11/2026)
1. **Git en «Solo lectura».**
   - *Primera:* denegar `git diff`, `show`, `log` y `blame`.
   - *Revisión:* un revisor de solo lectura los necesita.
   - *Segunda (elegida):* **se ejecutan con `--no-textconv --no-ext-diff`** (la política devuelve el comando cambiado). Para todos los agentes, `core.fsmonitor` va apagado por el entorno (`GIT_CONFIG_COUNT`), que manda sobre el `.git/config`.
2. **Secretos en los registros.** Además de los patrones, se ocultan los **valores exactos** que la app conoce: la clave API y los secretos MCP que se cargan para los agentes.
3. **Fuera de alcance.** La clave API sigue llegando a los agentes en su entorno (Claude Code la necesita así en modo «Clave API»). Se documenta como riesgo aceptado: un agente que puede ejecutar comandos puede verla.

## Requisitos

### M2 · «Solo lectura» no ejecuta código
- **R90.1** [M16i] `rg` con `--pre` o `--pre-glob`, y `tree` con `-o` o `--output`, no son comandos sencillos en ningún nivel ni valen en «Solo lectura».
- **R90.2** [M16i] En «Solo lectura», cada `git diff`, `git show`, `git log` o `git blame` del comando (también encadenado, como `git diff && ls src`) se ejecuta con `--no-textconv --no-ext-diff` justo después del subcomando, si no los llevaba. Así un revisor sigue pudiendo usarlos y no se deniega nada nuevo.
- **R90.3** [M16i] El entorno de los agentes lleva `core.fsmonitor=false` por `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_n`/`GIT_CONFIG_VALUE_n`, respetando las entradas que ya hubiera.

### M7 · Secretos en los registros
- **R90.4** [M16i] `redactWith(values)` oculta, además de lo de siempre, cada valor de `values` de 6 caracteres o más allí donde aparezca. El bus de eventos usa los valores de `OrchestratorDeps.secretValues`.
- **R90.5** [M16i] Se reconocen también tokens de Slack (`xox?-`), Google (`AIza…`), AWS (`AKIA…`), Notion (`secret_…`, `ntn_…`), GitLab (`glpat-…`) y npm (`npm_…`), y las claves `x-api-key`, `private_key` y `client_secret`.
- **R90.6** [M16i] La app pasa como `secretValues` la clave API y los valores de los secretos MCP que ha cargado para los agentes del proyecto.
- **R90.7** [M16i] Al crear o abrir un proyecto, si `.orquestador/.gitignore` no existe, se crea con `runs/`, `copias/`, `attachments/`, `supervisor/` y `approved-checks.json`.

### Linux
- **R90.8** [M16i] `secureStorageAvailable(storage, platform)` es falso en Linux cuando el sistema cifra con `basic_text` (o no lo dice). Con eso, la clave API y los secretos MCP no se guardan, y la app avisa como en un sistema sin cifrado.

### Puntos bajos
- **R90.9** [M16i] `killsAppProcess` reconoce:
  - comodines en `taskkill /IM`, `Stop-Process -Name` y `wmic … name like '…%'`;
  - `Where-Object`/`?` con `Name -eq|-like|-match` seguido de `Stop-Process`;
  - matar por PID (`taskkill /PID`, `kill`, `Stop-Process -Id`) uno de los PID protegidos, que son el del proceso principal.
- **R90.10** [M16i] El asistente deniega también esos comandos (`APP_KILL_DENY`).
- **R90.11** [M16i] El proceso principal solo atiende el IPC del marco principal de la ventana (`senderFrame` sin padre); el resto se rechaza.
- **R90.12** [M16i] En modo prueba, `call_api` no permite los métodos de terminal (`terminalStart`, `terminalWrite`, `terminalResize`, `terminalKill`), igual que `open_terminal`.
- **R90.13** [M16i] La propuesta de qué paso rehace el trabajo (`blame`) mete la tarea y la entrega de cada paso dentro de `<datos>`.
- **R90.14** [M16i] Leer, escribir o guardar un archivo de una skill falla si su ruta real (enlaces resueltos) sale de la carpeta de la skill.
