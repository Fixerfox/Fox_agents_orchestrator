# SPEC-069 · Mejoras visuales (4): conversación, memoria y Supervisor en el diagrama

**Estado:** Implementada (M14) · **Hito:** M14 · **Paquetes:** `editor`, `ui` · **Rama:** `feature/mejoras-visuales`

## Propósito
El 08/11 el usuario pidió tres cosas sobre la ejecución:
- Que la «Conversación» de un paso se entienda mejor.
- Rediseñar la «Memoria de la ejecución».
- Que el Supervisor esté dentro del diagrama, encima del flujo, en lugar de ser una tarjeta fija que te sigue al moverte.

Del lienzo «Orquestador · Conversación, memoria y Supervisor (rediseño)» eligió **C1** (conversación como chat, con lo técnico agrupado), **M1** (memoria en tarjetas) y **S1** (Supervisor como nodo con su memoria). Pidió además que la memoria tenga una pestaña en el Resumen de la ejecución.

## Decisiones (08/11/2026)
1. **Herramientas agrupadas.**
   - *Primera:* una fila por herramienta, más compacta que ahora.
   - *Revisión:* un agente puede leer veinte ficheros seguidos, y veinte filas siguen ahogando lo que dice.
   - *Segunda (elegida):* las herramientas **seguidas** se juntan en una fila plegable, «Usó 6 herramientas», con el desglose por nombre («Read ×4 · Bash ×2») y los fallos. Al abrirla, cada una lleva ✓ o ✗, su nombre, su objetivo principal (fichero, comando, patrón o dirección) y su resultado plegado.
   - La agrupación y el objetivo salen del editor (`conversationBlocks`, `toolTarget`), para probarlos sin React.
2. **Quién habla.**
   - El encargo es un mensaje con su rótulo de siempre («Recibió (intento 1)»).
   - El agente habla con su inicial y su nombre.
   - Las preguntas van a la derecha.
   - La entrega es una tarjeta del color de su estado.
   - Los textos de siempre no cambian, para no romper lo que ya los busca.
3. **Dónde va el Supervisor.**
   - *Primera:* un nodo más de React Flow, con aristas.
   - *Revisión:* entraría en la selección, en «encajar», en el menú del botón derecho y en las conexiones del diagrama, y no es un paso.
   - *Segunda (elegida):* se dibuja **en las coordenadas del lienzo** (`ViewportPortal`), centrado encima de los pasos. Se mueve y hace zoom con el diagrama, pero no es un nodo: no se selecciona, no se arrastra y no se guarda en el diagrama.
   - Las líneas van de la tarjeta a cada paso en revisión, en ámbar si ese paso tiene aviso.
   - Desaparecen el haz con su mira y el botón que llevaba a un paso fuera de la vista, porque ahora la tarjeta está junto a los pasos.
4. **La memoria**, en tres sitios con la misma pieza:
   - Plegable dentro de la tarjeta del Supervisor, con la rama y las dos últimas entradas, y «Ver las N entradas».
   - En la nueva pestaña «Memoria» del modal de la ejecución.
   - En la pestaña «Supervisor», donde ya estaba.

   Cada entrada es una tarjeta con el paso, el texto y los ficheros (dos y «+N»), la última primero. Lleva una marca ámbar si su paso tiene avisos, y hay un filtro «Todas / Con avisos». El filtro «Pendiente de ti» del prototipo queda fuera: la memoria no separa esa parte.

## Requisitos
- **R69.1** [M14] En la «Conversación» de un paso:
  - El encargo y lo que dice el agente se ven como mensajes. Los del agente llevan su inicial y su nombre.
  - Las herramientas seguidas se agrupan en una fila plegable «Usó N herramientas», con el desglose por nombre y los fallos. Dentro, cada una lleva ✓ o ✗, su nombre, su objetivo y su resultado plegado.
  - Las preguntas van a la derecha.
  - La salida es una tarjeta del color de su estado.
- **R69.2** [M14] `conversationBlocks(items)` junta las herramientas seguidas en un bloque `tools` y deja lo demás igual. `toolTarget(input)` da el objetivo principal de una herramienta (`file_path`, `path`, `command`, `pattern` o `url`), corto, o nada.
- **R69.3** [M14] En el lienzo de una ejecución, la tarjeta del Supervisor va en las coordenadas del diagrama, centrada encima del paso más alto. Se mueve y hace zoom con él, y no se selecciona ni se arrastra. Salen líneas de la tarjeta a cada paso en revisión, en ámbar si tiene aviso. Pulsar la tarjeta abre la pestaña «Supervisor» (R60.36).
- **R69.4** [M14] Bajo la tarjeta del Supervisor, pegado a ella, con su forma, va el botón «Memoria» con cuántas entradas tiene cada bloque («2 decisiones · 1 nota · 3 pasos»). Al pulsarlo se abre la memoria completa en un modal (la pestaña «Memoria» del modal de la ejecución). Sin entradas ni rama no se muestra (cambio del 08/11: el recuadro suelto ocupaba el lienzo sin decir nada).
- **R69.5** [M14] La memoria se ve como tarjetas, la última primero. Cada una lleva su paso, su texto y sus ficheros (dos y «+N»), y una marca ámbar si su paso tiene avisos. Con avisos, un filtro «Todas · n / Con avisos · n».
- **R69.6** [M14] El modal de la ejecución tiene la pestaña «Memoria», junto a «Supervisor», cuando el Supervisor dejó memoria o rama.

## Cambia
- **R60.32–R60.35:** la tarjeta ya no es fija ni tiene haz, mira ni panel aparte. Ahora va en el diagrama (R69.3) y con su memoria (R69.4).
