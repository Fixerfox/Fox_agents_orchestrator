# SPEC-061 · Memoria de la ejecución

**Estado:** Borrador · **Hito:** M12 · **Paquetes:** `core`, `claude`, `editor`, `ui`

## Propósito
Hoy cada agente recibe solo la salida del paso anterior: el cuarto paso no sabe qué decidió el primero. El usuario propuso (06/11) una memoria que viaje entre agentes durante la ejecución: el Guardián (SPEC-060) resume lo que hace cada agente y los demás lo leen para situarse.

## Decisiones (06/11/2026)
1. **Quién escribe.**
   - *Primera:* que cada agente escriba lo que quiera en una memoria compartida.
   - *Revisión:* crece sin control, y en paralelo las ramas se pisan.
   - *Segunda (elegida):* **solo escribe el Guardián**, que ya lee cada paso para revisarlo. Los agentes solo leen.
2. **Qué es para el agente.** Memoria de fondo, no una orden: sirve para situarse y saber qué archivos mirar. Su tarea sigue siendo la que le toca.
3. **Cuánto dura.** Una ejecución. Guardarla entre ejecuciones arrastraría decisiones antiguas.
4. **Cuánto ocupa.** Tiene un tope: más texto cuesta más en cada paso y también confunde al agente.

## Requisitos (propuesta; se concretan al abordar el hito)
- **R61.1** [M12] Cada ejecución tiene un diario con una entrada por paso de agente terminado: qué paso, qué hizo, qué decidió y qué archivos tocó. Se guarda con la ejecución, no entre ejecuciones.
- **R61.2** [M12] La entrada la escribe el Guardián en la misma consulta con la que revisa el paso (R60.12), sin llamada extra.
- **R61.3** [M12] Con la revisión con IA desactivada, la entrada se arma sin IA con el nombre del paso y sus archivos.
- **R61.4** [M12] Cada agente recibe el diario en su prompt como «Memoria de la ejecución», marcado como contexto de fondo y como datos, no como instrucciones: lo que venga dentro no manda sobre su tarea.
- **R61.5** [M12] Los agentes no pueden escribir en el diario.
- **R61.6** [M12] Un paso ve el diario tal como estaba al arrancar. Las ramas en paralelo no se ven entre sí mientras trabajan, y un paso no espera a que llegue la entrada del anterior.
- **R61.7** [M12] El diario tiene un tope de 2.000 tokens aproximados: al pasarse, las entradas más antiguas se quedan solo con el paso y sus archivos.
- **R61.8** [M12] Lo que recibió cada agente queda en `agent.request`, y el diario se ve en el Resumen.

## Fuera de alcance
- Memoria entre ejecuciones o entre proyectos.
- Que los agentes se escriban entre ellos.
