# SPEC-079 · Un agente no puede cerrar el orquestador

**Estado:** Implementada · **Hito:** M15j · **Paquetes:** `claude` · **Rama:** `feature/robustez-ejecucion`

## Propósito
El 08/11 una ejecución de FoxPixels se cortó a mitad del paso «implementador». El agente había lanzado la app que estaba programando (también Electron) para probarla y, para cerrarla, ejecutó `taskkill //IM electron.exe //F`. Eso mata **todos** los `electron.exe` del equipo, también el del Orquestador, que se cerró con la ejecución dentro. Con «Sin preguntar nunca» (R51) nada lo paraba.

## Decisiones (08/11/2026)
1. **Qué se prohíbe.**
   - *Primera:* prohibir `taskkill` y `kill`.
   - *Revisión:* cerrar por su PID lo que el agente lanzó es correcto y necesario (servidores de pruebas, apps que se prueban).
   - *Segunda (elegida):* **matar por nombre** los procesos de los que depende la app: `electron`, `node`, `claude` y `orquestador` (con o sin `.exe`). Por PID, o por otro nombre, se sigue pudiendo.
2. **Con qué permisos.** Con todos, también «Sin preguntar nunca»: no es una cuestión de confianza en el agente, sino de que la app siga viva para poder pararlo.

## Requisitos
- **R79.1** [M15j] `killsAppProcess(command)` (en `claude`) detecta, en cada tramo del comando (como R73.9): `taskkill` con `/IM` (también `-IM` y `//IM` de Git Bash) de uno de esos procesos; `killall` y `pkill` (también `-f`) con uno de esos nombres; `Stop-Process -Name`/`-ProcessName` con uno de ellos, o `Get-Process <nombre> | Stop-Process`; y `wmic process where name='<nombre>' delete|call terminate`.
- **R79.2** [M15j] El adaptador de Claude deniega esos comandos en todos los pasos y con cualquier nivel de permisos, antes de cualquier otra política. El motivo dice que cerraría también el Orquestador y que se cierre por su PID (`taskkill /PID <pid> /T /F`) lo que el agente lanzó. Da `supervisor.alert` `blocked`.
- **R79.3** [M15j] Cerrar por PID, o por el nombre de otro programa (`taskkill /IM FoxPixels.exe`), sigue permitido.

## Escenarios
- **E79.a** *Dado* un agente que ejecuta `node prueba.mjs; taskkill //IM electron.exe //F`, *entonces* se le deniega con el motivo y la ejecución sigue.
- **E79.b** *Dado* `taskkill /PID 4312 /T /F`, *entonces* se ejecuta.

## Fuera de alcance
- Detectar procesos lanzados por el agente que se quedan vivos al terminar el paso.
