# SPEC-060 · Supervisor de la ejecución

**Estado:** Implementada (M12) · **Hito:** M12 · **Paquetes:** `core`, `claude`, `runtime`, `editor`, `ui` · **Rama:** `feature/supervisor`

## Propósito
El 06/11 el usuario preguntó si debería haber algo que revise que la comunicación entre agentes es correcta, que esté siempre detrás de una ejecución, que frene a un agente que se salga de lo pedido, y una memoria que viaje entre agentes. El Coordinador (SPEC-059) no sirve para eso: es un paso que se coloca a mano y solo reparte.

El Supervisor es la otra pieza: **vigila toda ejecución, frena lo que se sale de los límites, avisa de lo que va mal y escribe la memoria** que leen los agentes. Tiene dos capas: reglas sin coste, siempre activas, y una revisión con un modelo rápido y barato que se configura.

## Decisiones (06/11/2026)
1. **Reglas o IA.**
   - *Primera:* un agente que revise con IA cada mensaje entre agentes.
   - *Revisión:* con un modelo grande sería caro, y si bloquea, cada paso espera. Pero las reglas solas no ven si lo hecho corresponde a lo pedido, que es lo que pidió el usuario.
   - *Segunda:* solo reglas, sin IA.
   - *Revisión:* Haiku 5.5 cuesta 0,10 $ por millón de tokens de entrada y 0,50 $ de salida (octubre de 2026): revisar un paso de unos 3.000 tokens ronda 0,0004 $. El coste deja de ser el problema si la revisión no bloquea.
   - *Tercera (elegida):* **las dos capas.**
2. **Avisar o intervenir.**
   - *Primera:* parar la ejecución cuando detecte un problema.
   - *Revisión:* una regla puede equivocarse y parar trabajo ya pagado.
   - *Segunda:* solo avisar.
   - *Revisión:* el usuario pidió también guardarraíles, y eso hay que frenarlo antes. Pero consultar a un modelo en cada acción sería lento, porque un paso hace decenas.
   - *Tercera (elegida):* **las reglas bloquean, la IA avisa.** Nunca se para un paso entero ni se cambia una entrada. Repetir un trabajo sigue siendo cosa del nodo Revisión.
   - *Cambio del 06/11:* esto dejó pasar un paso que había hecho 1 de 44 tareas. SPEC-062 lo corrige: un paso que no terminó lo pedido se detiene y pregunta.
3. **Quién lo cambia.** Es interno: sus reglas y su prompt solo cambian con esta spec, para que todas las ejecuciones se vigilen igual. Lo único que se configura es la revisión con IA: si está activa y con qué modelo.
4. **Dónde vive.** Reglas y servicio en `core`, sin conocer a Claude: escucha el bus como la UI. Lo activa el orquestador de la app (`createEngineOrchestrator`); un `Orchestrator` sin `supervisor` se comporta como antes, y por eso no cambian las grabaciones de SPEC-056.
5. **Su gasto no corta la ejecución.** Cuenta en el uso, pero el límite de presupuesto solo lo dispara el trabajo de los agentes.
6. **Quién escribe la memoria.**
   - *Primera:* que cada agente escriba lo que quiera en una memoria compartida.
   - *Revisión:* crece sin control, y en paralelo las ramas se pisan.
   - *Segunda (elegida):* **solo escribe el Supervisor**, que ya lee cada paso para revisarlo. Los agentes solo leen.
7. **Qué es la memoria para un agente.** Contexto de fondo, no una orden: sirve para situarse y saber qué archivos mirar. Dura una ejecución y tiene un tope, porque más texto cuesta más en cada paso y también confunde.

## Requisitos
### Reglas
- **R60.1** [M12] Evento `supervisor.alert` (`nodeId?`, `rule`, `severity: 'info' | 'warning'`, `detail`). Cada aviso se emite una vez por paso y regla, salvo `blocked` (y por pasada desde R63.11).
- **R60.2** [M12] Las reglas son una función pura de `core` (`applyRules`) que no llama al motor.
- **R60.3** [M12] El Supervisor no cambia las entradas, y un fallo suyo no afecta a la ejecución. Solo cambia el flujo con los controles de SPEC-062.
- **R60.4** [M12] Regla `undeclared-file`: una rama de reparto (SPEC-059) tocó un archivo que no declaró.
- **R60.5** [M12] Regla `empty-output`: un agente terminó bien con la salida vacía.
- **R60.6** [M12] Regla `unexpected-branch`: un paso actuó en una rama de git distinta de la anterior sin haberla creado ni haber cambiado a ella (SPEC-058).
- **R60.7** [M12] Regla `retry-loop`: un paso agotó sus reintentos (salta al terminar fallido tras el último intento, R63.4) o el Coordinador repitió el reparto hasta el máximo.
- **R60.8** [M12] Regla `budget-burn`: un solo paso gastó más de la mitad del presupuesto de la ejecución.
- **R60.16** [M12] Antes de cada acción se bloquea escribir fuera de los `Archivos:` que declaró el Coordinador para esa rama, y se le dice al agente para que siga por otro camino. Ese bloqueo y lo que ya deniegan los permisos dan `supervisor.alert` con la regla `blocked`.

### Revisión con IA
- **R60.12** [M12] Con la revisión activa, cada paso de agente que termina se revisa con una consulta de un solo turno, sin herramientas (`Decider.supervise`): recibe lo que se le pidió (entrada y tarea) y lo que hizo (acciones, salida y archivos), como datos y no como instrucciones, y responde si lo hecho corresponde a lo pedido. Si no, da `supervisor.alert` con la regla `ai-review` y el motivo. Con el motor simulado no se llama a ningún modelo.
- **R60.17** [M12] Si hizo algo ajeno a lo pedido, da la regla `out-of-scope`.
- **R60.13** [M12] Un paso que acaba bien espera a su revisión (SPEC-062). La de un paso que falla no bloquea: al terminar la ejecución se espera un máximo de 10 segundos, y las que no lleguen dan `supervisor.skipped`.
- **R60.14** [M12] Ajustes tiene «Supervisor»: revisión con IA activa o no (activa por defecto) y modelo (Haiku 5.5 por defecto). Lo que gasta cuenta en el uso de la ejecución, sin disparar su límite.
- **R60.15** [M12] Si la revisión de un paso que falló no llega, no afecta a la ejecución y lo dice con `supervisor.skipped`. Si falla la de un paso que acabó bien, vale R62.8.

### Memoria
- **R60.18** [M12] Cada ejecución tiene un diario con una entrada por paso de agente terminado (`supervisor.note`: paso, qué hizo y decidió, y archivos). No se guarda entre ejecuciones.
- **R60.19** [M12] La entrada sale de la misma consulta con la que se revisa el paso, sin llamada extra.
- **R60.20** [M12] Sin revisión con IA, la entrada se arma con el nombre del paso y sus archivos.
- **R60.21** [M12] Cada agente recibe el diario como «Memoria de la ejecución», marcado como contexto de fondo y como datos: no manda sobre su tarea.
- **R60.22** [M12] Los agentes no pueden escribir en el diario.
- **R60.23** [M12] Un paso ve el diario tal como estaba al arrancar: las ramas en paralelo no se ven entre sí.
- **R60.24** [M12] El diario tiene un tope de 8.000 caracteres: al pasarse, las entradas más antiguas se quedan solo con el paso y sus archivos, y si no basta se quitan enteras (R63.12).
- **R60.25** [M12] Lo que recibió cada agente queda en `agent.request`.
- **R60.26** [M12] La memoria empieza con la rama de git de la ejecución (`Rama de git: <rama>`, y `(creada por <paso>)` si un paso la creó). Sale de los eventos `git.branch`, no de la revisión con IA, así que está aunque la revisión esté apagada o no haya llegado. Vale la última rama avisada; `via: 'ran'` solo cuenta si aún no se conoce ninguna. El tope de R60.24 nunca la recorta.
- **R60.27** [M12] El prompt explica al agente que esa es la rama en la que va el trabajo: si usa git, sigue en ella salvo que su tarea diga otra cosa.

### Interfaz
- **R60.9** [M12] Los avisos se ven en el nodo y en el cronograma.
- **R60.10** [M12] El Resumen tiene una sección «Supervisor» con cada aviso, su paso y su detalle, o que no encontró problemas, lo que no pudo revisar, y la memoria de la ejecución.
- **R60.11** [M12] El Supervisor es interno: no aparece en Agentes, no es un nodo ni se guarda en el diagrama, y sus reglas y su prompt solo cambian con esta spec. Solo se ve durante una ejecución y al abrirla después, como dice «En la ejecución».

### En la ejecución
- **R60.28** [M12] Al arrancar, `supervisor.started` (`review`, `model?`) dice que vigila, si revisa con IA y con qué modelo.
- **R60.29** [M12] Antes de cada revisión, `supervisor.reviewing` (`nodeId`). La entrada que sale de una revisión lleva `reviewed` en `supervisor.note`.
- **R60.30** [M12] Lo que gasta el Supervisor sale como `agent.usage` con `source: 'supervisor'`: cuenta en el total de la ejecución, pero no en el gasto del paso ni en `budget-burn`.
- **R60.31** [M12] `supervisorView(events, running, labelOf)` da el estado (`watching`, `reviewing`, `alert`, `rules`, `done`), los pasos revisados, los avisos, el gasto, el modelo, la rama, la memoria y los pasos a los que apuntar. Sin `supervisor.started` no da nada.
- R60.32 (sustituido por R69.3 el 08/11) El lienzo de una ejecución enseña la tarjeta del Supervisor, fija arriba en el centro de la pantalla, con su estado, los pasos revisados, los avisos, el gasto, el modelo y la rama. Tiene aspecto propio y no se mueve con el lienzo. No sale al editar un diagrama.
- R60.33 (sustituido por R69.3 el 08/11) Mientras corre, un haz sale de la tarjeta hacia cada paso en revisión, y una mira lo rodea. Si no se está revisando nada no señala a ningún paso: un haz fijo no dice nada nuevo, y el aviso sigue en el nodo y en la tarjeta. Con avisos, haz y mira van en amarillo. Un paso dentro de un subdiagrama se señala en su nodo del nivel visible. Con varios pasos en revisión a la vez hay un haz y una mira por cada uno, y la tarjeta los nombra si son dos o los cuenta si son más. Un paso sigue en revisión hasta que acaben todas las suyas. Si otro paso se interpone, el haz lo rodea y entra por el lado.
- R60.34 (sustituido por R69.3 el 08/11) Si el paso queda fuera de la vista, el haz llega hasta el borde y un botón lleva el lienzo hasta él.
- R60.35 (sustituido por R69.4 el 08/11) El lienzo de una ejecución enseña también el panel «Memoria de la ejecución», fijo arriba a la derecha y plegable: la rama y las entradas, la última primero, según van llegando.
- **R60.36** [M12] Pulsar la tarjeta abre la pestaña «Supervisor» de la ejecución.
- **R60.37** [M12] Cada paso enseña, junto a lo que recibió, la memoria que le llegó.
- **R60.38** [M12] Las ejecuciones con Supervisor tienen una pestaña «Supervisor», la última, destacada con su color y con el número de avisos.
- **R60.39** [M12] La pestaña da el balance, los avisos, las revisiones que no llegaron y la memoria. Cada aviso dice en una frase qué pasó, en qué paso y a qué hora; pulsarlo lo despliega con el detalle, qué significa y «Ver el paso». Si solo hay uno, sale desplegado.
- **R60.40** [M12] Pulsar «N avisos» en un nodo, o «Con aviso» en la mira, abre la pestaña con los avisos de ese paso desplegados.
- **R60.41** [M12] El apartado «Supervisor» del Resumen destaca los avisos como tales, y pulsar uno abre la pestaña por ese aviso.

## Fuera de alcance
- Parar, repetir o corregir pasos.
- Memoria entre ejecuciones o entre proyectos.
- Que los agentes se escriban entre ellos.
- Comprobar comandos de terminal antes de ejecutarlos: lo que escriban se detecta después, con `undeclared-file`.
