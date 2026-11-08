# SPEC-068 · Mejoras visuales (3): panel del paso en ejecución y barras de scroll

**Estado:** Implementada (M14) · **Hito:** M14 · **Paquetes:** `editor`, `ui` · **Rama:** `feature/mejoras-visuales`

## Propósito
El 08/11 el usuario enseñó el lateral de una ejecución («Ejecución de «Revisión»», con «correcto» en gris diminuto y una tira de texto) y pidió rediseñarlo, con la opción de plegarlo. Entre tres propuestas del lienzo «Orquestador · Panel del paso en ejecución (rediseño)» eligió la **A: cabecera con estado y pestañas**. También pidió mejorar el diseño de las barras de scroll de toda la aplicación.

## Decisiones (08/11/2026)
1. **Qué se ve primero.**
   - *Primera:* siempre la pestaña «Resumen».
   - *Revisión:* mientras el paso trabaja, o si te ha hecho una pregunta, lo que importa es la conversación. Esconderla detrás de una pestaña haría perder la pregunta.
   - *Segunda (elegida):* se abre en **«Resumen»** si el paso ya tiene salida y no espera tu respuesta. Si no, se abre en **«Conversación»**. Al cambiar de paso se vuelve a decidir.
2. **Qué datos lleva la tarjeta de estado.** Solo los que ya existen en los eventos: estado, duración (de que empieza a que termina), tokens y coste. Las fichas «Tests / Build / Fallos» del prototipo exigirían que el agente devuelva datos estructurados, así que quedan fuera.
3. **Las cuentas salen del editor** (`stepOverview`), no de la interfaz. Así se prueban sin React y no se repite la lógica de `transcriptItems`.
4. **Plegar.**
   - *Primera:* ocultar el panel del todo.
   - *Revisión:* mientras corre, perderías el estado del paso.
   - *Segunda (elegida):* plegado queda **una franja estrecha** con el estado (icono y color), el nombre en vertical y el coste. Al pulsarla se despliega, y también al elegir otro paso en el lienzo. Se recuerda mientras sigas en esa ejecución.
5. **Barras de scroll.**
   - *Primera:* `scrollbar-width: thin` y `scrollbar-color`.
   - *Revisión:* en Chromium esas propiedades anulan `::-webkit-scrollbar` y dejan una barra plana sin margen.
   - *Segunda (elegida):* `::-webkit-scrollbar` en toda la app, porque Electron es Chromium:
     - Barra de 10 px con la pista transparente.
     - Pulgar redondeado con margen, que se aclara al pasar por encima.
     - Sin flechas y con la esquina transparente.
     - Los colores salen del tema.

## Requisitos
- **R68.1** [M14] El panel de un paso en la ejecución tiene:
  - Una cabecera con el nombre del paso y su estado.
  - «Abrir en grande», si lo hay, y «Plegar el panel».
  - Una tarjeta de estado coloreada según el estado (correcto, fallido, trabajando o esperando tu respuesta), con la duración, los tokens y el coste cuando los hay.
- **R68.2** [M14] Debajo hay pestañas:
  - «Resumen»: la última salida del paso, o un aviso si aún no la hay.
  - «Conversación», con el número de elementos: la transcripción de siempre.
  - «Ficheros», con su número, si el paso tocó alguno.

  Se abre en «Resumen» si hay salida y ninguna pregunta pendiente, y si no, en «Conversación».
- **R68.3** [M14] «Plegar el panel» lo deja como una franja «Desplegar el panel» con el estado, el nombre del paso y el coste. Pulsarla, o elegir otro paso en el lienzo, lo despliega.
- **R68.4** [M14] `stepOverview(events, nodeId, nodePath)` devuelve el estado, la duración en ms (si empezó y terminó), los tokens (entrada más salida), el coste y la última salida del paso, contando todas sus pasadas.
- **R68.5** [M14] Las barras de scroll de la aplicación son finas, redondeadas, con la pista transparente y los colores del tema.

## Corrección encontrada durante el trabajo (08/11)
El usuario vio que al cerrar el lateral de un agente se abrían los ajustes del diagrama, y que a veces ese panel salía sin aspa para cerrarlo.

La causa: «Cerrar el panel» pedía seleccionar el nodo `''`, y el lienzo lo convertía en una selección de un nodo inexistente. El lateral se quedaba visible porque «había selección», pero sin cabecera porque no había paso, y mostraba los ajustes del diagrama sin la ✕.

- **R68.6** [M14] En el Diseñador, cerrar el lateral de un paso quita la selección y oculta el lateral. No abre los ajustes del diagrama. Los ajustes del diagrama, cuando se abren, siempre tienen su cabecera con «Cerrar».

## Fuera de alcance
- Datos estructurados del agente (tests, build) en la tarjeta.
- Reloj en directo de la duración mientras el paso trabaja.
