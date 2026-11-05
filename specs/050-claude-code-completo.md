# SPEC-050 · Claude Code completo en los agentes y en el asistente

**Estado:** Implementada (M8g) · **Hito:** M8g · **Paquetes:** `core`, `claude`, `editor`, `ui`, `apps/desktop`

## Propósito
El 05/11 el usuario preguntó si el orquestador tenía «la potencia de Claude Code». El motor era el Agent SDK, que es el bucle de Claude Code, pero recortado:
- el prompt de sistema era solo el nuestro y sustituía al de Claude Code;
- no se cargaba `CLAUDE.md` ni `.claude` (`settingSources: []`);
- los agentes no tenían subagentes (`Agent`) ni lista de tareas (`TodoWrite`);
- «Sin preguntar nunca» seguía denegando escribir fuera de la carpeta;
- el asistente solo podía leer.

El usuario pidió acercarlo a Claude Code, sin permisos más estrictos que los de Claude Code, y quitarle al asistente esas limitaciones.

## Cómo lo hacen otros
- Claude Code: prompt de sistema propio, herramientas completas (también `Agent` para subagentes y `TodoWrite`), `CLAUDE.md` y `.claude/settings.json` del proyecto y del usuario, y modos de permisos (`default`, `acceptEdits`, `bypassPermissions`).
- El Agent SDK lo expone con `systemPrompt: { type: 'preset', preset: 'claude_code', append }`, `tools: { type: 'preset', preset: 'claude_code' }` y `settingSources: ['user', 'project', 'local']`.

## Requisitos

### Agentes del diagrama
- **R50.1** [M8g] Cada paso de agente usa el prompt de sistema de Claude Code (`{ type: 'preset', preset: 'claude_code', append }`). Lo que componía `buildSystemPrompt` (quién es el agente, instrucciones, contextos, skills, carpeta, reglas de preguntas, confirmación y entregable) va en `append`. Las consultas de un solo turno sin herramientas (decidir rutas, transformar, componer el entregable, borradores ✦ y la prueba de conexión) siguen con su prompt propio.
- **R50.2** [M8g] Además de las herramientas de R31.11, los agentes tienen `Agent` (subagentes) y `TodoWrite` (lista de tareas), y `Skill` cuando se carga la configuración de Claude Code (R50.3). Esas tres se aprueban sin preguntar. Lo que hace un subagente pasa por la misma política que su agente: permisos, copia antes de modificar y registro de lo tocado.
- **R50.3** [M8g] Ajustes tiene «Cargar la configuración de Claude Code» (`AppSettings.claudeConfig`, activado si no hay valor). Activado, los agentes y el asistente usan `settingSources: ['user', 'project', 'local']`: `CLAUDE.md`, `.claude/settings.json`, sus skills y subagentes, y `~/.claude`. Desactivado, `[]`. Los servidores MCP de los agentes siguen siendo solo los suyos (`strictMcpConfig`), porque en el orquestador el MCP es por agente y por paso. Se valida como booleano.
- **R50.4** [M8g] Una regla `allow` de `.claude/settings.json` aprobaría una herramienta sin llamar a `canUseTool`, y se saltaría la copia y el registro. Lo mismo pasaría con el permiso por herramienta de los MCP (R30.4). Por eso la política completa de los agentes (MCP y escritura) corre también en un gancho `PreToolUse` para toda herramienta que no sea de lectura, `AskUserQuestion`, `Agent`, `TodoWrite` ni `Skill`. El SDK espera al gancho hasta un día, porque puede estar esperando a que el usuario responda. La decisión se guarda por llamada (`tool_use_id`), así que una herramienta nunca pregunta, copia ni se registra dos veces aunque pase por el gancho y por `canUseTool`. Un «deny» del gancho llega al agente con su motivo.
- **R50.5** [M8g] «Sin preguntar nunca» se comporta como `bypassPermissions` de Claude Code: las herramientas de archivos también pueden escribir fuera de la carpeta de trabajo, en `.git` y en `node_modules`. Solo se deniega escribir en `.orquestador`, tanto el de la carpeta de trabajo como el de la carpeta del proyecto si son distintas, porque ahí están los diagramas y ejecuciones que la app tiene abiertos. Lo que se escribe dentro de la carpeta se copia antes de modificar y se registra como siempre. Lo de fuera, `.git` y `node_modules` no tiene copia ni pasa a la salida del paso (la transcripción sí lo muestra). Los otros niveles no cambian.
- **R50.6** [M8g] El texto sobre la carpeta que recibe el agente dice lo que permite su nivel: en «Solo lectura», que no escribe; en «Preguntar», que se pregunta antes de modificar; en «Automático» y «Sin preguntar nunca», que modifica sin preguntar con copia previa; y solo en «Sin preguntar nunca», que también puede escribir fuera.

### Asistente
- **R50.7** [M8g] El asistente usa el prompt de Claude Code, con el de la app (`ASSISTANT_SYSTEM_PROMPT`) en `append`, y todas las herramientas de Claude Code (`tools: { type: 'preset', preset: 'claude_code' }`) además de las `mcp__orquestador__*`. No tiene `AskUserQuestion`, porque pregunta con `ask_user`. Puede hacer hasta 100 turnos y carga la configuración de Claude Code según R50.3.
- **R50.8** [M8g] El asistente no pide permiso para ninguna herramienta del sistema: lee, escribe, edita, ejecuta comandos y lanza subagentes. Las acciones de la app que ya piden «Permitir» (borrar, ejecutar, probar un MCP, abrir la terminal) lo siguen pidiendo. Solo hay dos límites, que no son permisos sino protección de la app:
  - nunca lee ni escribe con herramientas de archivos la carpeta de datos de la app, donde están la clave y los secretos cifrados;
  - nunca escribe con herramientas de archivos en `.orquestador` del proyecto: para eso usa las acciones de la app, que mantienen la interfaz al día y respetan el cerrojo de ejecución.
  Ambos se aplican en un gancho `PreToolUse` y otra vez en `canUseTool`, con un motivo que dice qué hacer en su lugar. Los demás archivos de secretos (`.env`, claves, credenciales) ya no se bloquean, como en Claude Code. Esto sustituye a R29.7 y R29.8.
- **R50.9** [M8g] Cada herramienta del sistema que usa el asistente aparece en el chat como una línea discreta (R29.9), con solo el nombre del archivo, cada programa del comando con su subcomando si lo tiene (`cd C:\mcp && npm install --no-audit` se ve como «npm install»; nunca argumentos ni rutas) o la descripción del subagente: «Ha escrito notas.md», «Ha editado package.json», «Ha ejecutado «npm install»», «Ha lanzado un subagente: revisar el MCP». Si se bloqueó, lo dice. `TodoWrite` no se muestra.

### Interfaz
- **R50.10** [M8g] En Ajustes, el interruptor de R50.3 está en la sección «Claude», con una línea que explica qué carga. En «Reglas de los agentes», la regla de fuera de la carpeta dice, con «Sin preguntar nunca», que pueden escribir donde quieran salvo en `.orquestador`. Sigue habiendo 8 reglas (R47.7).

## Escenarios
- Un Implementador en «Automático» recibe una tarea grande: usa `TodoWrite` para planificar y lanza un subagente con `Agent` para revisar los tests. El subagente modifica `src/a.ts`: se copia antes y `src/a.ts` aparece en los ficheros del paso.
- El proyecto tiene `CLAUDE.md` y `.claude/settings.json` con `"allow": ["Write"]`: el agente sigue las normas de `CLAUDE.md`, y modificar `README.md` en «Preguntar» sigue preguntando, porque el gancho decide antes que la regla.
- Con «Sin preguntar nunca», un agente escribe `../compartido/notas.md`: se permite, sin copia, y no aparece en la salida del paso. Si intenta escribir `.orquestador/diagrams/x.json`, se le deniega.
- Pido al asistente «instala las dependencias del MCP de C:\mcp\pix y créalo»: ejecuta `npm install` en esa carpeta sin preguntar (el chat dice «Ha ejecutado «npm install»») y crea el MCP con `create_mcp`.

## Fuera de alcance
- Usar `bypassPermissions` del SDK: se aprueba con nuestra política para no perder la copia y el registro.
- Registrar lo que cambian `Bash` y los archivos de fuera de la carpeta (sigue el límite de R31.12).
- Sesiones que continúan entre pasos (`persistSession` sigue apagado: cada paso empieza con lo que recibe).
- Elegir por agente si carga `.claude` (hoy es un ajuste del proyecto).
