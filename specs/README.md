# Specs

Desarrollo guiado por especificaciones: **ninguna funcionalidad se implementa sin una spec aprobada y ningún requisito se da por hecho sin un test que lo referencie.**

## Flujo
1. **Spec** (`Borrador` → `Aprobada`): propósito, requisitos numerados, escenarios.
2. **Tests** que citan el requisito en su nombre, p. ej. `it('[R3.2] ejecuta en paralelo…')`.
3. **Implementación** hasta que pasan.
4. **Estado** de la spec → `Implementada`.
5. Si cambia el comportamiento, se cambia **primero la spec** (y el test), luego el código.

## Formato de un requisito
`- **R<spec>.<n>** [M<hito>] Texto verificable.`
El hito indica cuándo debe estar cubierto por tests. `npm run spec:check` exige test para todos los requisitos del hito en curso (por defecto `M1,M2,M3,M3b,M4,M4c,M5a,M5b,…,M7b, M8a, M8b`, los hitos ya abordados; se cambia con `SPEC_MILESTONES=…`).

## Índice
| Spec | Título | Hito | Estado |
|---|---|---|---|
| [079](079-no-matar-el-orquestador.md) | Un agente no puede cerrar el orquestador: matar por nombre electron, node, claude u orquestador se deniega con cualquier permiso | M15j | Implementada |
| [078](078-aprobaciones-en-modal.md) | Aprobaciones largas en un modal: confirmaciones y revisiones con quién pregunta siempre a la vista y «Aprobar» fijo abajo | M15i | Implementada |
| [077](077-gobierno-de-recursos.md) | Gobierno de recursos: límite global de agentes, enfriamiento compartido ante límites de uso, presupuesto con aviso y freno, pausa en la siguiente herramienta, tokens agrupados y métricas | M15h | Implementada |
| [076](076-memoria-del-proyecto.md) | Memoria del proyecto: convenciones, preferencias, lecciones y avisos falsos que propone la app y aprueba la persona, con índice en el prompt y herramienta de lectura; memoria propia de Claude Code apagada | M15g | Implementada |
| [075](075-supervisor-con-evidencia.md) | Supervisor con evidencia: comprobaciones deterministas, diff para la revisión, veredicto con gravedad, verificador con skill y calibración de avisos | M15f | Implementada |
| [074](074-ejecucion-duradera.md) | Ejecución duradera: reanudar reproduciendo los eventos por clave de paso (también bucles, decisiones y respuestas) y validar todo el árbol antes de empezar | M15e | Implementada |
| [073](073-ramas-aisladas-y-fusion.md) | Ramas en paralelo aisladas (worktree o copia desde el estado real de la carpeta), git de solo lectura dentro y fusión por líneas con conflictos que decide la persona | M15d | Implementada |
| [072](072-memoria-de-ejecucion-estructurada.md) | Memoria de la ejecución estructurada: bloques con procedencia y tope, relevancia por grafo, decisiones de la persona para todos y notas de los agentes | M15c | Implementada |
| [071](071-reintentos-con-contexto.md) | Reintentos con contexto: errores por tipo, jitter y `retry-after`, lo que el siguiente intento sabe del anterior, volver al punto de partida y decisiones reintentables | M15b | Implementada |
| [070](070-tiempos-limite-y-pasos-parados.md) | Tiempos límite y pasos parados: latido por inactividad, tiempo máximo por intento, bucle de herramientas y política para preguntas sin respuesta | M15a | Implementada |
| [069](069-conversacion-memoria-supervisor.md) | Mejoras visuales (4): conversación como chat con las herramientas agrupadas, memoria en tarjetas (también en la pestaña «Memoria») y Supervisor dentro del diagrama | M14 | Implementada |
| [068](068-panel-del-paso-y-scroll.md) | Mejoras visuales (3): panel del paso en ejecución con estado, pestañas Resumen · Conversación · Ficheros y plegado a una franja; barras de scroll finas en toda la app | M14 | Implementada |
| [067](067-ajustes-por-secciones.md) | Mejoras visuales (2): Ajustes con índice «General / Este proyecto», una sección cada vez, estado de Claude arriba, opciones en tarjetas y reglas junto a los permisos | M14 | Implementada |
| [066](066-mejoras-visuales.md) | Mejoras visuales (1): la ventana «Configurar» pasa a un índice con una sección cada vez, marcas de lo cambiado en el paso, «Editar el agente» dentro y pie con «Restablecer paso»; el lateral de cada nodo estrena cabecera con su tipo y secciones plegables | M14 | Implementada |
| [065](065-dar-por-bueno.md) | Lo que solo puede comprobar una persona termina como aviso, «Dar por bueno» una ejecución fallida (también el asistente, siempre con permiso) y «Hablar con el asistente» desde el aviso del final | M13 | Implementada |
| [064](064-configurar-agente-en-el-diagrama.md) | Configurar un agente desde el diagrama: doble clic o «Configurar…» abre una ventana con «Este paso» (los ajustes del lateral, en ancho) y «El agente» (su ficha, que vale en todos los diagramas) | M13 | Implementada |
| [063](063-correcciones-de-la-auditoria.md) | Correcciones de la auditoría del 07/11: el Supervisor ve principio y final de cada paso, memoria sin duplicados, motor fijo por ejecución, coste de las decisiones y textos que dicen lo que hace el motor | M13 | Implementada |
| [062](062-control-de-lo-pedido.md) | Control de lo pedido: un paso que no terminó lo suyo se detiene antes de cerrarse y pregunta, y el resultado final se compara con lo que pidió la persona | M12 | Implementada |
| [061](061-bandeja-y-avisos.md) | Bandeja del sistema y avisos de escritorio: cerrar deja la app en la bandeja, una sola instancia, y avisos cuando un agente necesita respuesta o acaba una ejecución | M12 | Implementada |
| [060](060-supervisor-de-ejecucion.md) | Supervisor de la ejecución: pieza interna que frena con reglas lo que se sale de los límites, revisa con un modelo barato y configurable si cada paso hizo lo pedido, y escribe la memoria que leen los agentes | M12 | Implementada |
| [059](059-repartir-entre-ramas.md) | Repartir el trabajo entre ramas en paralelo: el paso de origen divide su trabajo con `## Común` y `## Para <id>`, y cada rama recibe solo lo suyo | M8h | Implementada |
| [058](058-ramas-en-el-diagrama.md) | Ramas en el diagrama: los pasos de cada rama van rodeados con rayas amarillas, el nodo marca commit, push, PR y demás, y el resumen las destaca | M8g | Implementada |
| [057](057-crear-agente-por-pasos.md) | Crear un agente por pasos: bienvenida «¿Qué agente necesitas?» con ideas, el asistente redacta el primer borrador, cuatro pasos (qué hace, qué sabe, qué puede hacer, revisar) y una ficha por secciones para editar | M8g | Implementada |
| [056](056-arquitectura-hexagonal.md) | Arquitectura hexagonal con contextos (DDD ligero): matriz de dependencias comprobada, puertos en `core`, composición en `apps/desktop`, un handler por tipo de nodo, `RunCtx` y `RunService` repartidos, contrato y UI por contexto | M11a–M11d | Borrador |
| [055](055-cambios-por-comandos.md) | Archivos que cambian los comandos: un script o un build ejecutado con Bash también aparece en «Archivos» (con un comando, sin copia) | M8g | Implementada |
| [054](054-vista-previa-de-pasos.md) | Vista previa de lo que hace cada paso: fichas de archivos bajo cada nodo, tarjeta con la web, imagen o documento ya mostrados, ventana grande (escritorio/móvil, comparar, abrir fuera), copia por ejecución y miniaturas en la revisión humana | M8g | Implementada |
| [053](053-correcciones-guiadas.md) | Correcciones guiadas: revisión humana («Lo reviso yo») y «Pedir corrección» de una ejecución terminada; el asistente propone desde qué paso repetir | M8g | Implementada |
| [052](052-trabajos.md) | Trabajos: catálogo de diagramas para lanzar con una banda de estado (en marcha, te necesitan, en cola, terminadas), lanzar el mismo diagrama varias veces (a la vez o en cola), copia de lo que usa cada ejecución y un Diseñador que solo diseña | M8g | Implementada |
| [051](051-sin-preguntas.md) | Sin preguntas por defecto: «Sin preguntar nunca» por defecto (con migración), MCP y asistente sin «Permitir», rutas de Git Bash | M8g | Implementada |
| [050](050-claude-code-completo.md) | Claude Code completo: prompt de Claude Code, subagentes, `.claude`, «Sin preguntar nunca» como bypass y asistente sin límites | M8g | Implementada |
| [001](001-modelo-validacion.md) | Modelo y validación de diagramas | M1 | Implementada (M1) |
| [002](002-bus-eventos.md) | Bus de eventos y catálogo | M1 | Implementada (M1) |
| [003](003-ejecucion-grafo.md) | Ejecución del grafo | M1 | Implementada (M1) |
| [004](004-enrutado.md) | Enrutado (router) | M1 | Implementada (M1) |
| [005](005-bucles.md) | Bucles | M1 | Implementada (M1) |
| [006](006-subdiagramas.md) | Subdiagramas (plantillas como nodo) | M1 | Motor implementado (M1) |
| [007](007-control-ejecucion.md) | Control de ejecución: pausa, cancelación, presupuesto, reintentos | M1 | Implementada (M1) |
| [008](008-logs-trazabilidad.md) | Logs y trazabilidad | M1 / M2 / M4 | M1 y M2 implementados; M4 pendiente |
| [009](009-adapter-mock.md) | Contrato de AgentAdapter y MockAgent | M1 / M6 | M1 implementado; resto pendiente |
| [010](010-persistencia-proyecto.md) | Persistencia y estructura de proyecto | M2 | Implementada (M2) |
| [011](011-registro-biblioteca.md) | Registro de agentes, skills, contextos, MCP y biblioteca | M5 | Borrador |
| [012](012-importador.md) | Importador de paquetes | M5 | Borrador |
| [013](013-espacios-trabajo.md) | Espacios de trabajo aislados | M3b | Borrador |
| [014](014-editor-diagramas.md) | Editor de diagramas | M3 / M3c | Implementada (M3) |
| [015](015-vista-en-vivo.md) | Vista de ejecución en vivo | M4 / M4b | Implementada (M4) |
| [016](016-seguridad-auth.md) | Permisos, seguridad y autenticación | M4 / M6 | Borrador |
| [017](017-panel-resultados.md) | Panel de resultados | M4 / M4b | Implementada (M4) |
| [021](021-interfaz-visual.md) | Interfaz visual: temas, iconos y diseño | M4c | Implementada |
| [022](022-agentes-contextos.md) | Agentes y contextos del proyecto | M5a | Implementada (M6 en SPEC-027) |
| [023](023-ajustes.md) | Ajustes de la aplicación | M5a | Implementada (M6 en SPEC-027) |
| [024](024-skills.md) | Skills del proyecto | M5b | Implementada (M6 en SPEC-027) |
| [025](025-instalar-agentes.md) | Instalar agentes y skills desde carpeta o Zip | M5b | Implementada |
| [028](028-pantalla-inicio.md) | Pantalla de inicio y proyectos recientes | M6b | Implementada |
| [029](029-asistente.md) | Asistente en el panel derecho conectado a la app por MCP | M8c | Implementado |
| [030](030-mcp-por-agente.md) | Servidores MCP por agente: secretos cifrados, permiso por herramienta, prueba sin tokens; alta asistida por Claude, ámbito proyecto o app y terminal integrada | M8a, M8d | Implementado |
| [031](031-carpeta-de-trabajo.md) | Carpeta de trabajo, escritura de agentes y preguntas por chat | M6e/M6f | Parcial |
| [032](032-rediseno-ux.md) | Rediseño de uso: tarea por nodo, Claude en los campos, insertar en conexiones, rail global, biblioteca, carpeta del proyecto, Ejecuciones | M7a / M7b / M7c | M7a y M7b implementados |
| [033](033-conocimiento-y-subdiagramas.md) | Conocimiento por paso o por diagrama y diagramas dentro de diagramas | M8a | Implementado |
| [034](034-revision-con-retorno.md) | Revisión con retorno (bucle condicional dibujado) | M8b | Implementada |
| [035](035-pantalla-ejecuciones.md) | Pantalla Ejecuciones: submenú, historial y vista de una ejecución | M8b | Implementada |
| [037](037-nodo-transformar.md) | Nodo «Transformar»: datos a JSON con esquema, Markdown o texto, por reglas o con Claude | M8e | Implementada |
| [045](045-ficheros-cronograma-auditoria.md) | Ficheros de cada paso (también si se para), visor con cambios, cronograma con esperas y relato, y auditoría de la ejecución | M8f | Implementada |
| [048](048-ejecutar-modal-y-adjuntos.md) | Diálogo «Ejecutar» en un modal con pestañas (Ejecución / Entregable) y adjuntos en la entrada | M8g | Implementada |
| [046](046-entregable.md) | Entregable de la ejecución: qué se recibe al final (enlaces, resumen .md, JSON, secciones propias), aviso a los pasos finales y composición en la Salida | M8g | Implementada |
| [047](047-permisos-de-los-agentes.md) | Permisos de los agentes: Preguntar, Automático (solo pregunta borrar, salir de la carpeta o publicar fuera) y Sin preguntar nunca, en el proyecto y por agente (con Solo lectura); comandos sencillos sin preguntar | M8f | Implementada |
| [043](043-markdown-y-confirmar.md) | Resultados en Markdown y «Confirmar antes de terminar» por paso | M8f | Implementada |
| [042](042-inspector-de-conexiones.md) | Inspector de conexiones: qué se envió por un hilo y con qué contexto arrancó el agente | M8f | Implementada |
| [039](039-agentes-supervisados-e-iconos.md) | Agentes que preguntan antes de actuar (semáforo), mano levantada al preguntar e iconos de agente | M8f | Implementada |
| [038](038-asistente-y-mcp-ux.md) | Rediseño del asistente, alta de MCP guiada, biblioteca con carpetas, Spec Kit preinstalado y vistas de ejecución | M8f | Implementada |
| [036](036-conocimiento-obligatorio.md) | Conocimiento obligatorio (skills, contextos, MCP) y registro de uso | M9a | Implementada |
| [027](027-adaptador-claude.md) | Adaptador de Claude (motor real) | M6a | Implementada |
| [026](026-redactar-con-claude.md) | Redactar agentes, skills y contextos con Claude | M6c | Implementada |
| [020](020-servicio-ejecucion.md) | Servicio de ejecución | M4 | Implementada |
| [019](019-shell-escritorio.md) | Cáscara de escritorio (Electron), IPC y seguridad | M3 / M4 | Implementada (M3) |
| [018](018-preguntas-chat.md) | Preguntas de los agentes y chat en el nodo | M1 / M4 / M6 | M1 implementado; resto pendiente |
