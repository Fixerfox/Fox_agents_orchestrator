# SPEC-086 · El asistente con pestañas

**Estado:** Implementada · **Hito:** M16e · **Paquetes:** `editor`, `ui`, `desktop` · **Rama:** `feature/asistente-pestanas`

## Propósito
El asistente (SPEC-029) tiene una sola conversación. Cada «Pídeselo a Claude» de la app (dar de alta un MCP, crear una skill, el menú de un paso…) añade su petición a esa misma conversación. Si se da de alta un MCP y después se pide una skill, la skill llega con todo lo hablado del MCP: Claude mezcla los temas, el historial que se envía se llena y la persona no puede volver a la conversación anterior. Además, al cerrar la app se pierde todo.

## Decisiones (09/11/2026)
1. **Una petición desde un botón abre una pestaña nueva** (decisión del usuario). Lo que la persona escribe a mano sigue en la pestaña activa. Si la pestaña activa está vacía, se reutiliza para no acumular pestañas en blanco.
2. **Las pestañas se guardan por proyecto** (decisión del usuario).
   - *Primera:* en `.orquestador/` del proyecto.
   - *Revisión:* en el chat se pegan tokens, rutas y datos personales, y `.orquestador/` está dentro del repositorio: acabaría en git.
   - *Segunda (elegida):* **en la carpeta de datos de la app**, un archivo por proyecto con una clave derivada de su carpeta. Se recuperan al reabrir el mismo proyecto en el mismo equipo.
3. **Los turnos siguen en segundo plano.** El proceso principal ya admite varios turnos a la vez (uno por `turnId`). Los eventos de un turno van a la pestaña que lo lanzó aunque se esté mirando otra, y sus acciones se ejecutan igual. Si una pestaña en segundo plano necesita una respuesta («Permitir», un secreto o una pregunta), su pestaña lo marca.
4. **Límite.** Como mucho `ASSISTANT_MAX_TABS` (8) pestañas. Al abrir una más se cierra la más antigua que no esté activa ni trabajando.

## Requisitos

### Pestañas (lógica pura, `ui/src/assistant/tabs.ts`)
- **R86.1** [M16e] `AssistantTabs = { tabs: ChatTab[]; activeId }`; cada `ChatTab` tiene `id`, `title`, `items`, `updatedAt` y, mientras trabaja o espera enviar, `turnId` y `pending`. `emptyTabs()` da una pestaña vacía activa.
- **R86.2** [M16e] `openTab(state, { pending?, title? })` abre una pestaña y la activa. Si la activa está vacía (sin mensajes, sin turno y sin envío pendiente), la reutiliza.
- **R86.3** [M16e] Con `ASSISTANT_MAX_TABS` pestañas, `openTab` cierra antes la de `updatedAt` más antiguo que no esté activa ni tenga turno. Si todas trabajan, no cierra ninguna.
- **R86.4** [M16e] `closeTab(state, id)` quita la pestaña y activa la de al lado; si era la última, deja una vacía.
- **R86.5** [M16e] `tabTitle(text)` es la primera línea del texto, sin espacios sobrantes, recortada a 32 caracteres con «…». Una pestaña sin título toma el de su primer mensaje; sin mensajes se llama «Nueva conversación».
- **R86.6** [M16e] `tabOfTurn(state, turnId)` encuentra la pestaña que lanzó un turno, y `needsAnswer(tab)` dice si tiene una acción esperando a la persona (`ask`, `secret` o `choice`).

### Interfaz
- **R86.7** [M16e] Bajo la cabecera del asistente hay una lista de pestañas (`tablist`): cada una es un `tab` con su título, un indicador si trabaja o si necesita respuesta, y un botón «Cerrar «<título>»». El botón «Nueva conversación» abre una pestaña (ya no borra la conversación).
- **R86.8** [M16e] Cerrar una pestaña que trabaja detiene su turno.
- **R86.9** [M16e] Cada petición de un botón de la app (`askAssistant`) abre una pestaña con R86.2, con la petición como envío pendiente, y abre el panel. Lo que se escribe en el campo va a la pestaña activa.
- **R86.15** [M16e] Los botones dan el título de su pestaña, porque todas sus peticiones empiezan igual: «MCP «<nombre>»» en la ficha de un servidor (configurar, nuevo o la caja de preguntas), «MCP para «<paso>»» en el menú de un paso y «Ejecución «<diagrama>»» al hablar de una ejecución. Sin título, se usa R86.5.
- **R86.10** [M16e] Los eventos de un turno (texto, lecturas, acciones, fin y error) se aplican a la pestaña de R86.6 aunque no sea la activa, y las acciones que no piden permiso se ejecutan. Las respuestas de las tarjetas (permitir, secreto, elegir, deshacer) actualizan la tarjeta en su pestaña.

### Guardado
- **R86.11** [M16e] `assistantTabsLoad()` y `assistantTabsSave(doc)` leen y guardan las pestañas del proyecto abierto en `<datos de la app>/assistant/<clave>.json`, con la clave = 16 primeros caracteres del SHA-256 de la carpeta del proyecto. Sin proyecto abierto, `load` devuelve `null` y `save` falla. La interfaz nunca ve la ruta.
- **R86.12** [M16e] `assistantTabsSave` valida: como mucho `ASSISTANT_MAX_TABS` pestañas y `ASSISTANT_MAX_SAVED_ITEMS` (200) elementos por pestaña, ids seguros, títulos de hasta 80 caracteres, cada elemento con un `kind` conocido y textos dentro de `ASSISTANT_MAX_TEXT`.
- **R86.13** [M16e] `toSaved(state)` (pura) prepara lo que se guarda: quita `turnId`, `pending` y las funciones de deshacer, y se queda con los últimos 200 elementos de cada pestaña. `fromSaved(doc)` lo recupera: las tarjetas que estaban trabajando o esperando pasan a `denied` con «Interrumpida al cerrar la app».
- **R86.14** [M16e] La app carga las pestañas al abrir un proyecto (y vacía las del anterior), y las guarda medio segundo después de cada cambio.

## Casos
- **E86.a** *Dado* un alta de MCP en curso en el asistente, *cuando* la persona pulsa «Pídeselo a Claude» en una skill, *entonces* se abre una pestaña nueva con esa petición y el historial que recibe Claude solo tiene la petición de la skill. La pestaña del MCP sigue y recibe su respuesta.
