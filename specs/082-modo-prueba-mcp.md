# SPEC-082 · Modo prueba: la app con un MCP para agentes

**Estado:** Implementada · **Hito:** M16a · **Paquetes:** `editor`, `ui`, `desktop` · **Rama:** `feature/modo-prueba-mcp`

## Propósito
Para comprobar que un cambio funciona en la app de verdad, hoy alguien tiene que abrirla y probarla a mano. No hay tests E2E, y el servidor MCP de la app (SPEC-029) solo lo usa el asistente de dentro.

Esta spec añade un **modo prueba**: la app de escritorio, arrancada con `--test-mcp`, abre un servidor MCP local. Con él, Claude Code (u otro cliente MCP) puede:
- usar las mismas acciones que el asistente;
- manejar la interfaz: ver qué hay en pantalla, pulsar, escribir, esperar y hacer capturas;
- abrir proyectos, responder los diálogos de archivos, llamar a la API y esperar ejecuciones.

## Decisiones (09/11/2026)
1. **Qué se prueba.** La app en marcha, con su interfaz, y no solo el motor: es lo que los tests unitarios no cubren.
2. **Quién la usa.** Claude Code desde fuera, mientras se desarrolla.
3. **Permisos.** En modo prueba no hay nadie para pulsar «Permitir»: las acciones destructivas se hacen sin preguntar. A cambio, el modo:
   - solo se enciende a mano y nunca en la app instalada;
   - escucha solo en el propio equipo, con token;
   - usa su propia carpeta de datos (decisión 4).
4. **Datos aparte.**
   - *Primera:* usar los datos normales de la app.
   - *Revisión:* la prueba tocaría los recientes, los ajustes y la clave del usuario. Además, el bloqueo de instancia única impediría arrancarla con la app normal abierta.
   - *Segunda (elegida):* **carpeta de datos propia** (`Orquestador-test`). Arranca con el motor simulado y puede convivir con la app normal.
5. **Protocolo.**
   - *Primera:* el SDK de MCP.
   - *Revisión:* solo llega como dependencia de otro paquete y complica el empaquetado del proceso principal.
   - *Segunda (elegida):* **HTTP con respuestas JSON** (el «Streamable HTTP» de MCP sin streaming), escrito a mano. Son cinco métodos de JSON-RPC y queda probado entero.

## Requisitos

### Activación y aislamiento
- **R82.1** [M16a] La app entra en modo prueba con el argumento `--test-mcp` (y `--test-mcp-port=<n>`, por defecto 47321). En la app empaquetada (`app.isPackaged`) el argumento no hace nada.
- **R82.2** [M16a] En modo prueba, los datos de la app (ajustes, clave, secretos, recientes, espacios y registros) van a la carpeta `Orquestador-test`, junto a la normal, antes de pedir la instancia única. Así puede convivir con la app normal y arranca con el motor simulado.
- **R82.3** [M16a] La ventana se titula «Orquestador · modo prueba».

### Servidor
- **R82.4** [M16a] `handleMcp(message, tools)` (puro) atiende JSON-RPC 2.0, también por lotes:
  - `initialize`: responde con la versión de protocolo pedida si la conoce (si no, la más reciente que conoce), la capacidad `tools` y `serverInfo` (`orquestador-test`);
  - `notifications/initialized` y las demás notificaciones: no responde;
  - `ping`: responde un objeto vacío;
  - `tools/list`: cada herramienta con su `inputSchema` (JSON Schema de tipo `object`);
  - `tools/call`: ejecuta la herramienta.

  Un método desconocido da el error `-32601`, y unos parámetros que no cumplen el esquema dan `-32602`. Si la herramienta falla, la respuesta es un resultado con `isError: true` y el mensaje.
- **R82.5** [M16a] El servidor HTTP escucha solo en `127.0.0.1`, en `POST /mcp`:
  - Sin `Authorization: Bearer <token>` correcto responde 401.
  - Con cabecera `Origin`, es decir, desde un navegador, responde 403.
  - Si el cuerpo no es JSON, devuelve un error de JSON-RPC `-32700`.
  - Solo con notificaciones, responde 202 sin cuerpo.
  - `GET` y los demás métodos responden 405.
- **R82.6** [M16a] El token se crea la primera vez y se guarda en `<datos>/test-mcp.json` con la dirección, para que no cambie entre arranques. Al arrancar, la app escribe la dirección y la ruta de ese archivo en la salida estándar. Si el puerto está ocupado, lo dice ahí y la app sigue sin servidor.

### Herramientas
- **R82.7** [M16a] **Acciones de la app:** todas las de `ASSISTANT_TOOLS` salvo las interactivas (`request_secret`, `ask_user`) y `open_terminal`, con el mismo nombre y los mismos parámetros. Se ejecutan en la interfaz con `runAssistantTool`, con las mismas validaciones y sin pedir «Permitir». Sin proyecto abierto, dan el error «Abre un proyecto primero (open_project)».
- **R82.8** [M16a] **Manejar la interfaz** (en `packages/ui`, sobre el DOM):
  - `ui_snapshot`: lo que hay en pantalla. Los títulos y cada elemento con el que se puede interactuar (botón, enlace, campo, casilla, selector, pestaña, opción de menú) con su rol, nombre accesible y estado (desactivado, marcado, seleccionado, valor). Lo que está dentro de un diálogo abierto va marcado con el diálogo.
  - `ui_click {name, role?, index?}`: pulsa el elemento cuyo nombre accesible coincide (sin distinguir mayúsculas; primero exacto, después «contiene»).
  - `ui_type {label, text, submit?}`: escribe en un campo por su nombre accesible (sustituye el valor) y, con `submit`, pulsa Intro.
  - `ui_press {key}`: pulsa una tecla en el elemento con foco.
  - `ui_wait {text, gone?, timeoutMs?}`: espera a que el texto aparezca en pantalla (o desaparezca) durante como mucho `timeoutMs` (5 s por defecto, 60 s como máximo).

  Si no encuentra el elemento, el error lista los nombres más parecidos que hay en pantalla.
- **R82.9** [M16a] `app_state`: pantalla (`start` o la sección), proyecto abierto (nombre), diagrama abierto (id y nombre), si el asistente está abierto y si la ejecución del diagrama sigue en marcha.
- **R82.10** [M16a] `open_project {path, create?}`: abre (o crea) el proyecto de esa carpeta como los botones de la pantalla de inicio, con el diálogo de carpeta respondido por `path`.
- **R82.11** [M16a] `queue_dialog {paths}`: el siguiente diálogo de archivos o carpetas de la app devuelve esas rutas sin enseñarse. Con `paths: []`, el diálogo se da por cancelado. Se gasta en el primer diálogo que se abra.
- **R82.12** [M16a] `screenshot`: captura de la ventana en PNG, como contenido `image`.
- **R82.13** [M16a] `call_api {method, payload?}`: cualquier método de invocación de la API de la interfaz (`InvokeMethod`), por el mismo camino que el IPC (`DesktopHandlers.invoke`) y con las mismas validaciones. Devuelve su `ApiResult`. Lo que cambie así no se refresca solo en la interfaz.
- **R82.14** [M16a] `wait_run {runId?, timeoutMs?}`: espera a que la ejecución (por defecto, la más reciente) termine o quede esperando una respuesta, como mucho `timeoutMs` (60 s por defecto, 10 min como máximo). Devuelve su estado, el motivo y las preguntas pendientes.
- **R82.15** [M16a] `logs {limit?}`: los últimos mensajes de error y aviso de la consola de la interfaz y los cierres inesperados desde que arrancó (50 por defecto, 200 como máximo).
- **R82.16** [M16a] `reload`: recarga la interfaz y espera a que vuelva a estar lista.
- **R82.17** [M16a] Lo que se ejecuta en la interfaz espera su respuesta como mucho 60 s (las acciones de la app, 10 min, como R29.4). Si no responde a tiempo, devuelve un error.

### Desarrollo
- **R82.18** [M16a] `npm run start:test` compila y arranca la app en modo prueba. `docs/07-modo-prueba.md` explica cómo conectar Claude Code (`claude mcp add --transport http …` con la cabecera del token) y un ejemplo de sesión de prueba.

## Escenarios
- **E82.a** *Dado* el modo prueba, *cuando* un cliente llama a `initialize` y `tools/list` con el token, *entonces* recibe las acciones de la app y las de prueba. Sin token recibe 401.
- **E82.b** *Dado* un cliente conectado, *cuando* hace `open_project` en una carpeta vacía con `create: true`, `create_diagram`, `add_step`, `run_diagram` y `wait_run`, *entonces* la ejecución termina con el motor simulado y `app_state` enseña el diagrama.
- **E82.c** *Dado* el paso anterior, *cuando* hace `ui_click {name: "Ejecuciones"}` y `ui_snapshot`, *entonces* ve la ejecución en la lista.

## Fuera de alcance
- Grabar y repetir sesiones de prueba como tests automáticos (Playwright).
- Varias ventanas.
- Que lo use un agente de un diagrama del propio Orquestador.
