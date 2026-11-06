# SPEC-060 · Guardián de la ejecución

**Estado:** Borrador · **Hito:** M12 · **Paquetes:** `core`, `runtime`, `editor`, `ui`

## Propósito
El 06/11 el usuario preguntó si debería haber algo que revise que la comunicación entre agentes es correcta y que esté siempre detrás de una ejecución, sin depender de cómo sea el diagrama. El Coordinador de SPEC-059 no sirve para eso: es un paso que se coloca a mano y solo reparte.

El Guardián es la otra pieza: **vigila toda ejecución**: frena lo que se sale de los límites y avisa de lo que va mal. Tiene dos capas: reglas sin coste, siempre activas, y una revisión con un modelo barato que se configura. Además escribe la memoria de la ejecución (SPEC-061).

## Decisiones (06/11/2026)
1. **Reglas o IA.**
   - *Primera:* un agente que revise con IA cada mensaje entre agentes.
   - *Revisión:* con un modelo grande sería caro, y si bloquea, cada paso espera. Pero las reglas solas no ven si lo enviado tiene sentido, que es lo que pidió el usuario.
   - *Segunda:* solo reglas, sin IA.
   - *Revisión:* Haiku 5.5 cuesta 0,10 $ por millón de tokens de entrada y 0,50 $ de salida (octubre de 2026): revisar un mensaje de unos 3.000 tokens ronda 0,0004 $. El coste deja de ser el problema si la revisión no bloquea.
   - *Tercera (elegida):* **las dos capas.** Las reglas comprueban hechos y la IA, en segundo plano, si lo que hizo cada paso corresponde a lo que se le pidió. El Guardián solo avisa: quien decide si se repite un trabajo sigue siendo el nodo Revisión.
2. **Avisar o intervenir.**
   - *Primera:* parar la ejecución cuando detecte un problema.
   - *Revisión:* una regla puede equivocarse y parar trabajo ya pagado; además, algo que decide por detrás no se ve en el diagrama.
   - *Segunda:* solo avisar.
   - *Revisión:* el usuario pidió también guardarraíles: que un agente no haga nada fuera de lo pedido, y eso hay que frenarlo antes. Pero consultar a un modelo en cada acción sería lento, porque un paso hace decenas.
   - *Tercera (elegida):* **las reglas bloquean, la IA avisa.** Antes de cada acción, las reglas frenan lo que se sale de los límites. Al terminar el paso, la IA avisa si en conjunto hizo algo ajeno a lo pedido. Nunca se para un paso entero ni se cambia una entrada.
3. **Quién lo cambia.** Es interno: sus reglas y su prompt solo cambian con esta spec, para que todas las ejecuciones se vigilen igual. Lo único que se configura es la revisión con IA: si está activa y con qué modelo.
4. **Dónde vive.** Es un consumidor más del bus, como la UI: un servicio de `runtime` que no conoce a Claude. Las reglas son funciones puras de `core`, así que da igual el motor. Sus avisos son eventos, y quedan en el registro.

## Requisitos (propuesta; se concretan al abordar el hito)
- **R60.1** [M12] Evento `watch.alert` (`nodeId?`, `rule`, `severity: 'info' | 'warning'`, `detail`). Cada aviso se emite una vez por paso y regla.
- **R60.2** [M12] Cada regla es una función pura `(state, event) => Alert[]`, y un test comprueba que ninguna llama al motor.
- **R60.3** [M12] Una ejecución sin avisos da los mismos eventos que antes, salvo que se añada alguno (`watch.alert` nunca sustituye a otro evento), y una regla que lanza una excepción no afecta a la ejecución.
- **R60.4** [M12] Regla `undeclared-file`: una rama de reparto (SPEC-059) tocó un archivo que no declaró, o uno declarado por otra.
- **R60.5** [M12] Regla `empty-output`: un agente terminó bien con la salida vacía.
- **R60.6** [M12] Regla `unexpected-branch`: un paso actuó en una rama de git distinta de la de los pasos anteriores sin haber creado ni cambiado de rama (SPEC-058).
- **R60.7** [M12] Regla `retry-loop`: un paso agotó sus reintentos o repitió el reparto hasta el máximo.
- **R60.8** [M12] Regla `budget-burn`: un solo paso gastó más de la mitad del presupuesto de la ejecución.
- **R60.9** [M12] Los avisos se ven en el nodo y en el cronograma.
- **R60.10** [M12] El Resumen tiene una sección «Guardián» con lo que detectó en esa ejecución: cada aviso con su paso, su regla y su detalle. Si no hubo ninguno, dice que no encontró problemas.
- **R60.11** [M12] El Guardián es interno: no aparece en Agentes ni en el diagrama, y sus reglas y su prompt solo cambian con esta spec. Las reglas están siempre activas.
- **R60.16** [M12] Antes de cada acción, las reglas del Guardián bloquean lo que se sale de los límites del paso y se lo dicen al agente, para que pueda seguir por otro camino: escribir fuera de los `Archivos:` que declaró el Coordinador para esa rama (SPEC-059), y lo que ya prohíben la política de escritura y los permisos. Cada bloqueo da `watch.alert` con la regla `blocked` y la acción. Se apoya en el filtro que ya existe antes de cada herramienta.
- **R60.17** [M12] La revisión con IA recibe también las acciones del paso, y avisa con la regla `out-of-scope` si hizo algo ajeno a lo pedido.
- **R60.12** [M12] Con la revisión con IA activa, cada paso de agente que termina se revisa con una consulta de un solo turno, sin herramientas: recibe lo que se le pidió (entrada y tarea) y lo que hizo (salida y archivos), y responde si lo hecho corresponde a lo pedido. Si no, da `watch.alert` con la regla `ai-review` y el motivo. Con el motor simulado no se llama a ningún modelo.
- **R60.13** [M12] La revisión no bloquea: los pasos siguen sin esperarla. Al terminar la ejecución se esperan las pendientes un máximo de 10 segundos, y las que no lleguen se dan por no revisadas y el Resumen lo dice.
- **R60.14** [M12] Ajustes tiene «Guardián»: revisión con IA activa o no (activa por defecto) y modelo (Haiku 5.5 por defecto). Lo que gasta cuenta en el uso y en el presupuesto de la ejecución.
- **R60.15** [M12] Si la revisión falla o se acaba el presupuesto, no afecta a la ejecución: el Guardián deja de revisar y lo dice en el Resumen.

## Fuera de alcance
- Parar, repetir o corregir pasos.
