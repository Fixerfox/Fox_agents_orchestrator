# 00 · Documento base del proyecto

> Se completa por rondas de preguntas con el responsable del producto. Estado: **ronda 10 cerrada; M1 implementado**.

## 1. Qué es
Aplicación de escritorio para orquestar agentes de IA de forma visual. Por detrás usa **Claude Code**. Permite dar de alta y configurar agentes, conectarlos en un diagrama y ver en tiempo real qué hace cada uno. El resultado final puede ser código u otro tipo de artefacto.

## 2. Agentes
- Se **dan de alta y configuran** desde la app (registro de agentes). El nodo del diagrama solo referencia al agente.
- **Instrucciones:** se pueden escribir a mano o **optimizar con IA**.
- **Instalación de agentes ya hechos** desde un **Zip o carpeta**, en **formato nativo de Claude Code** (subagentes `.md` con frontmatter, skills en carpetas con `SKILL.md`, MCP en `.mcp.json`).
- **Skills:** se instalan por agente para sus tareas.
- **Contextos:** carpetas, referencias, etc., asignables al agente.
- **Modelo por agente:** Sonnet 5.5, Opus, Haiku… según la tarea.
- **MCP:** cada agente puede conectarse a servidores MCP, configurables en el alta.

## 3. Diagrama y flujo
- Los agentes se conectan **visualmente**.
- **Enrutado:** un agente (p. ej. Agente 1) recibe la orden y decide a cuál(es) llamar (sprites, gameplay, sonido… uno o varios). **Cada nodo elige el modo:** decisión del propio agente (salida estructurada) o reglas explícitas en las aristas.
- **Bucles:** nodos de bucle visuales, condicionados por un **prompt** o por un **número de veces**.
- Al terminar, un agente llama al siguiente según cómo estén conectados.

## 4. Alcance: proyecto vs global
- **Biblioteca global** de agentes, skills y contextos.
- Cada **proyecto** los usa tal cual o los **sobrescribe/añade** los suyos. Los contextos de proyecto viven solo en el proyecto.

## 5. Ejecución en vivo y observabilidad (requisito clave)
Se debe ver **en tiempo real**:
- **Qué hace cada agente:** estado, texto en streaming, herramientas que llama y sus resultados, errores, tokens/coste.
- **Por dónde va:** el nodo (o nodos, si hay paralelismo) activo en cada momento, marcado en el diagrama.
- **Qué ruta se tomó:** aristas recorridas resaltadas, decisiones de enrutado (qué agentes se eligieron y por qué) e iteraciones de cada bucle.
- La ruta queda **guardada** con la ejecución para poder reproducirla después (replay).

### Vista en vivo, control e inicio
- **Vista principal:** diagrama animado (nodo activo y ruta resaltada) + **panel lateral por agente** con su transcripción en directo (texto, herramientas, tokens). La línea de tiempo queda para más adelante.
- **Intervención durante la ejecución (v1):** **pausar, reanudar y cancelar** (global y por nodo). Fuera de v1: mensajes a un agente en curso, reintentar/saltar nodos y editar el diagrama mientras corre.
- **Inicio:** **orden manual en el nodo de entrada**. Cada ejecución admite un **límite de presupuesto** (tokens/coste) que la detiene al alcanzarlo. Sin ejecuciones programadas en v1.

## 6. Datos, bucles, permisos y resultados
| Tema | Decisión |
|---|---|
| Bucle condicionado por prompt | **Evaluador IA dedicado** (modelo barato, responde sí/no con motivo) + **máximo de iteraciones obligatorio** |
| Qué viaja por una conexión | **Texto de salida + archivos del espacio de trabajo** del proyecto |
| Permisos | **Por agente** (solo lectura / editar / ejecutar); lo peligroso **pide confirmación en la UI**; se puede marcar como automático |
| Resultados | **Carpeta de salida por ejecución** en el proyecto + **panel de resultados** que lista y previsualiza (código, texto, imágenes, audio) |

## 7. Decisiones técnicas confirmadas
| Tema | Decisión |
|---|---|
| Motor | **Claude Agent SDK** (TypeScript) tras la interfaz `AgentAdapter` |
| Formato de agente | Nativo de Claude Code |
| Enrutado | IA o reglas, a elegir por nodo |
| Alcance | Global + sobrescritura por proyecto |
| Grafo | **Con ciclos** mediante nodos de bucle explícitos (ya no es solo DAG) |

## 8. Instalación, proyectos y plataforma
- **Importar agentes (Zip/carpeta):** siempre con **pantalla de revisión previa**. Muestra instrucciones, skills, scripts, servidores MCP y permisos solicitados; los **MCP quedan desactivados hasta que el usuario los confirme**.
- **Proyecto = carpeta real** del usuario (p. ej. `D:\MiJuego`) con una subcarpeta `.orquestador/` que contiene diagramas, agentes/skills propios y ejecuciones. Los agentes trabajan sobre esa misma carpeta. La **biblioteca global** vive en el directorio de datos de la app (AppData en Windows, `~/.config` en Linux).
- **Plataformas v1:** **Windows y Linux**. **Idioma:** interfaz en **español**, con textos preparados para traducir (i18n) más adelante.

## 9. Autenticación, concurrencia, optimización y versionado
- **Autenticación:** dos modos, **sesión de Claude Code ya iniciada** o **clave API**. La clave se guarda en el almacén seguro del sistema (nunca en el JSON del diagrama ni del proyecto).
- **Concurrencia:** máximo de agentes en paralelo **configurable, 4 por defecto**. Ante errores temporales de la API (límites, red) **reintento automático con espera creciente (3 intentos)**, emitiendo evento en cada intento; si persiste, el nodo falla.
- **Optimizar instrucciones con IA:** la IA propone una versión y se muestra una **vista de diferencias** para aceptar, editar o descartar. Se conserva la versión anterior.
- **Versionado:** la biblioteca global guarda un **historial de versiones por agente y skill**. Cada proyecto puede **fijar una versión** o **seguir la última**, para que un cambio global no rompa proyectos existentes.

## 10. Alta de agente, MCP, plantillas y contextos
**Campos del alta de agente:** nombre, descripción, instrucciones, modelo, skills, contextos, servidores MCP, permisos y además:
- **Herramientas permitidas** (lista de herramientas de Claude Code: leer, editar, shell, web…).
- **Límite de turnos y presupuesto propio** (adicional al de la ejecución).
- **Icono y color** para reconocerlo en el diagrama.
- No hay campo de "formato de salida" en el agente: los nodos `router` en modo IA fuerzan internamente una salida estructurada definida por la app; entre agentes viaja texto + archivos.

**MCP:** **catálogo de MCP reutilizables**. Se dan de alta una vez (comando/args/env o URL), tienen **prueba de conexión**, se asignan a varios agentes y se pueden importar desde `.mcp.json`.

**Plantillas de diagrama** (que también sirven como subdiagramas, ver sección 13): unas **pocas de ejemplo** (p. ej. enrutador con 3 agentes, bucle de revisión) y **guardar diagramas propios como plantilla**. Un diagrama nuevo empieza con un nodo de entrada.

**Contextos:** el agente los recibe **como referencia que lee bajo demanda** (se le indica qué contextos tiene y dónde están), no inyectados en el prompt.

## 11. Revisión del documento (dos pasadas)
**Revisión 1: coherencia entre decisiones**
- *Permisos vs herramientas permitidas:* el nivel (lectura/edición/ejecución) es un **preajuste** que rellena la lista de herramientas; la lista editable es el modo avanzado y prevalece.
- *Límites por agente:* se traducen a los límites de turnos y de coste del SDK; el presupuesto de la ejecución es el techo global.
- *Contextos de texto:* se guardan como archivo en `.orquestador/` y se referencian igual que carpetas o archivos.
- *Contextos tipo URL:* solo funcionan si el agente tiene permitida la herramienta web; la UI avisa si falta.
- *Pausa:* es **cooperativa** (se detiene entre pasos/herramientas, no a mitad de un mensaje); el estado "pausando" es visible.

**Revisión 2: huecos y riesgos detectados**
- *Escrituras concurrentes:* dos agentes en paralelo pueden modificar los mismos archivos de la carpeta del proyecto (resuelto en la sección 12).
- *Bucles y archivos:* cada vuelta puede sobrescribir resultados; se resuelve con una instantánea por iteración (sección 12).
- *Coste de bucles anidados:* el máximo de iteraciones y el presupuesto de ejecución son obligatorios para evitar gasto descontrolado.
- *Rutas multiplataforma:* contextos y salidas se guardan con rutas relativas al proyecto.
- *MCP del importador:* un MCP importado nunca se activa ni se prueba sin confirmación explícita.

## 12. Concurrencia sobre archivos e iteraciones
- **Espacio de trabajo aislado por agente:** cada agente trabaja en su propia copia del proyecto y, al terminar, sus cambios se **fusionan**; los conflictos se muestran al usuario (eventos `workspace.merged` / `workspace.conflict`).
  - Implementación prevista: **git worktree** si el proyecto es un repositorio git; si no, **copia temporal con diff**. Para carpetas muy grandes se valorará copiar solo lo necesario (a confirmar en el hito correspondiente).
  - El orden de fusión es el de finalización; un conflicto no resuelto marca la ejecución como "requiere atención" sin perder ninguna de las dos versiones.
- **Bucles:** se guarda una **instantánea por iteración** en la carpeta de la ejecución (evento `iteration.snapshot`) para comparar o recuperar una vuelta anterior. El panel de resultados permite navegar por iteraciones.

## 13. Nodos compuestos (subdiagramas = plantillas)
**Idea:** una plantilla de diagrama completa puede usarse como **un solo nodo** dentro de otro diagrama. Ejemplo: la plantilla "Pintar" (varios agentes, enrutadores y bucles) se inserta como el nodo "Pintar" y cualquier otro diagrama la llama como una caja negra.

- **Plantilla y subdiagrama son lo mismo:** un diagrama guardado como plantilla (global o de proyecto) se puede insertar como nodo `subdiagram`. También se puede **agrupar nodos existentes** para convertirlos en plantilla y sustituirlos por ese nodo.
- **Por referencia, no por copia:** el nodo apunta a la plantilla; si se edita, se actualiza donde se use. Como los agentes y skills, el proyecto puede **fijar una versión** o seguir la última.
- **Interfaz:** **una entrada y una salida**. Lo que recibe entra por el nodo `entry` interno (texto + archivos) y lo que devuelve es el resultado de un nodo `output` interno. Por tanto toda plantilla utilizable como nodo necesita un nodo `output`.
- **Vista en vivo:** el nodo se ve **colapsado con resumen** (estado y agente activo interno). Con doble clic se **abre y se ve dentro en directo**, con su ruta animada y las transcripciones de sus agentes. La ruta completa incluye la ruta de anidación (p. ej. `Principal > Pintar > Revisor`).
- **Anidación:** se permiten subdiagramas dentro de subdiagramas, con **profundidad máxima** (8 por defecto, configurable) y **sin referencias circulares** (una plantilla no puede contenerse a sí misma, directa o indirectamente); se valida al guardar.
- **Herencia en ejecución:** el subdiagrama comparte el **presupuesto, la concurrencia y los permisos** de la ejecución padre; sus agentes siguen usando espacio de trabajo aislado. Sus eventos se emiten en el mismo flujo, con la ruta de nodos anidados.
- **Alcance:** una plantilla de proyecto puede usar agentes y plantillas globales; una global **no** puede depender de elementos de un proyecto.

## 14. Preguntas de los agentes y chat
- Un agente con dudas puede **hacer una petición al usuario**. El nodo queda **en espera** (`waiting_input`) y se resalta; el resto de nodos independientes sigue ejecutándose.
- El usuario **hace clic en el nodo y chatea con ese agente** para responder. Si el agente ofrece opciones, se muestran como botones. Puede hacer varias preguntas seguidas.
- Mientras espera, el agente libera su hueco de concurrencia, no consume presupuesto y no tiene límite de tiempo (configurable). Cancelar libera la espera.
- Las preguntas pendientes sobreviven a recargar la vista y quedan en el log. Fuera de v1: mensajes iniciados por el usuario a un agente en curso.
- Spec: `specs/018-preguntas-chat.md`.

## 15. Logs y trazabilidad
- Es fundamental poder analizar **qué llega a cada agente, qué ha hecho y qué responde**. El log de una ejecución es la secuencia completa de eventos: entrada exacta de cada intento, configuración usada (modelo, instrucciones, skills, contextos, herramientas, MCP, versión), texto en streaming, herramientas con sus resultados, uso de tokens y coste, archivos, decisiones de enrutado y de bucles, preguntas y respuestas.
- Los secretos (claves API, tokens) se **ocultan** antes de entrar en el log; los datos reales entre agentes no se alteran.
- Persistencia (M2, hecho): `.orquestador/runs/<runId>/events.jsonl` (incremental) + `meta.json`, con retención configurable y detección de ejecuciones interrumpidas. Visor de logs (M4): filtrar por agente/tipo, buscar, exportar y comparar ejecuciones.
- Spec: `specs/008-logs-trazabilidad.md`.

## 16. Método de trabajo: specs
Desarrollo guiado por especificaciones (`specs/`): requisitos numerados, tests que los citan y `npm run spec:check` para verificar la cobertura. Hoy hay 18 specs y 170 requisitos; los 99 de los hitos M1 y M2 están cubiertos por 108 tests.

## 17. Estado y siguientes pasos
- Decisión de M2: sin SQLite por ahora; `meta.json` por ejecución hace de índice (reconstruible desde las carpetas).
- Pendiente de confirmar por el responsable: el bucle como **contenedor con diagrama interno** (SPEC-005) y que la salida de un nodo contenga solo los archivos que él produjo (R3.11).
- **M0, M1 y M2 implementados** (motor y persistencia con 108 tests). Siguiente hito: **M3 (editor de diagramas con Electron y React Flow)**.
- Detalles técnicos aún por decidir durante el desarrollo: estrategia de aislamiento en carpetas grandes sin git; formato exacto del empaquetado de plantillas.
