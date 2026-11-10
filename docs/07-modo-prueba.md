# Modo prueba: probar la app con un agente

El modo prueba arranca la app de escritorio con un servidor MCP local. Con él, Claude Code (u otro cliente MCP) puede usar la app como una persona y comprobar que un cambio funciona de verdad. Lo define [SPEC-082](../specs/082-modo-prueba-mcp.md).

## Arrancar

```bash
npm run start:test
```

El comando compila la app y la abre con `--test-mcp`. Para usar otro puerto, añade `--test-mcp-port=<n>` (por defecto, 47321).

Si la terminal tiene `ELECTRON_RUN_AS_NODE=1` (pasa en algunas terminales integradas de VS Code), Electron arranca como Node y falla con «Cannot read properties of undefined (reading 'isPackaged')». En ese caso, arráncala sin esa variable: `env -u ELECTRON_RUN_AS_NODE npx electron apps/desktop --test-mcp`.

Al arrancar, la salida estándar muestra la dirección del servidor y dónde está el token:

```
[modo prueba] MCP en http://127.0.0.1:47321/mcp · token en …/Orquestador-test/test-mcp.json
```

Qué cambia respecto a la app normal:
- **Datos aparte.** El modo prueba usa la carpeta `Orquestador-test`: sus propios ajustes, clave, recientes y registros. Puede estar abierto a la vez que la app normal y empieza con el **motor simulado**, que no gasta tokens.
- **Título.** La ventana se llama «Orquestador · modo prueba».
- **Sin «Permitir».** Las acciones que normalmente piden «Permitir» (borrar, ejecutar…) se hacen sin preguntar.
- **Solo en desarrollo.** La app instalada ignora `--test-mcp`.

## Conectar Claude Code

El token está en `test-mcp.json` y no cambia entre arranques. Se registra una vez, con ámbito local (no se guarda en el repositorio):

```bash
claude mcp add --transport http orquestador-test http://127.0.0.1:47321/mcp --header "Authorization: Bearer <token>"
```

Después, en una sesión de Claude Code, las herramientas aparecen como `mcp__orquestador-test__*`.

## Herramientas

| Herramienta | Para qué |
| --- | --- |
| `app_state` | Pantalla, proyecto, diagrama abierto, asistente y ejecuciones en marcha |
| `ui_snapshot` | Lo que hay en pantalla: títulos y elementos con su rol, nombre y estado |
| `ui_click`, `ui_type`, `ui_press`, `ui_wait` | Pulsar, escribir (también elegir en un selector), pulsar teclas y esperar a un texto |
| `screenshot` | Captura de la ventana |
| `open_project` | Abrir o crear (`create: true`) el proyecto de una carpeta |
| `queue_dialog` | Respuesta para el siguiente diálogo de archivos (`[]` lo cancela) |
| `call_api` | Cualquier método de la API de la interfaz, con sus validaciones |
| `wait_run` | Esperar a que una ejecución termine o pregunte |
| `logs`, `reload` | Errores de la consola de la interfaz y recargarla |
| `list_agents`, `create_agent`, `add_step`, `run_diagram`… | Las mismas acciones que el asistente de la app |

## Una sesión de prueba

1. `open_project` con `path: "C:/tmp/orq-prueba"` y `create: true`. Usa una carpeta de pruebas, no un proyecto real.
2. `create_agent` («Escritor»), `create_diagram` («Prueba») y `add_step` con el agente y una tarea.
3. `run_diagram` con una entrada y después `wait_run`: con el motor simulado termina enseguida.
4. `ui_click` en «Ejecuciones», `ui_snapshot` para ver la lista y `screenshot` para comprobar cómo se ve.
5. `logs` al final, para ver si la interfaz dio algún error.

Para probar con Claude de verdad, cambia el motor en Ajustes (`ui_click` en «Ajustes») o con `call_api` (`saveSettings`). Gasta tokens.

## Seguridad
- El servidor escucha solo en `127.0.0.1` y exige el token.
- Rechaza cualquier petición que traiga cabecera `Origin`, así que ninguna web abierta en el navegador puede llamarlo.
- No arranca en la app instalada y nunca toca los datos de la app normal.
