# SPEC-078 · Aprobaciones largas en un modal

**Estado:** Implementada · **Hito:** M15i · **Paquetes:** `editor`, `ui` · **Rama:** `feature/robustez-ejecucion`

## Propósito
Una confirmación (R43) o una revisión humana (R53) trae el resumen entero del paso: decenas de líneas con listas, rutas y decisiones. Hoy se pinta dentro de la pantalla de la ejecución, encima del lienzo (petición del 08/11):
- Tapa la ejecución y obliga a desplazarse para leerla.
- Al desplazarse se pierde quién pregunta: el título queda arriba, fuera de la vista.
- «Aprobar» y «pedir cambios» quedan al final del texto, lejos de lo que se está leyendo.

## Decisiones (08/11/2026)
1. **¿Todo en un modal?**
   - *Primera:* toda pregunta se responde en un modal.
   - *Revisión:* una pregunta corta («¿Pixel art o vectorial?») se responde mejor de un vistazo, y con varias ramas preguntando a la vez se apilarían modales.
   - *Segunda (elegida):* **solo las largas**: confirmaciones, revisiones humanas y preguntas de más de 600 caracteres u 8 líneas. Las cortas siguen como están.
2. **¿Se abre solo?**
   - *Primera:* nunca; un botón lo abre.
   - *Revisión:* es justo lo que la persona tiene que hacer para que la ejecución siga; un botón más es un paso más.
   - *Segunda (elegida):* **en la pantalla de la ejecución se abre solo una vez por pregunta**. Cerrarlo no responde: la pregunta queda como una línea compacta con «Revisar y responder». En la bandeja de preguntas, que puede tener varias, no se abre solo.
3. **Quién pregunta** va siempre a la vista, en la cabecera fija del modal: el paso y su agente.
4. **Decidir con datos.**
   - *Primera:* el resumen del agente y el botón.
   - *Revisión:* el resumen es lo que el agente dice que hizo; aprobar solo con eso es fiarse de su palabra, justo lo que el Supervisor evita (SPEC-075).
   - *Segunda (elegida):* **junto al resumen, lo que hizo de verdad**: los archivos que tocó según los eventos, con su vista previa, lo que ha costado y los avisos del Supervisor.

## Requisitos
- **R78.1** [M15i] `questionNeedsModal(q)` (pura, en `editor`) es verdadera para confirmaciones, revisiones humanas y preguntas de más de 600 caracteres o más de 8 líneas.
- **R78.2** [M15i] Una pregunta así se ve, en la ejecución y en la bandeja, como una línea compacta: qué se pide («Confirmar lo que ha hecho <paso>»), el agente, el principio del texto (160 caracteres, sin Markdown) y «Revisar y responder».
- **R78.3** [M15i] «Revisar y responder» abre un modal con la cabecera fija (qué se pide, el paso y su agente), el texto entero en Markdown con su propio scroll y el pie fijo con las opciones («Aprobar» la primera) y un cuadro de varias líneas para pedir cambios u otra respuesta.
- **R78.4** [M15i] En la pantalla de la ejecución el modal se abre solo la primera vez que aparece cada pregunta así. Cerrarlo (✕, Escape o fuera) no responde nada.
- **R78.5** [M15i] Al responder, el modal se cierra y la respuesta va por el mismo camino que la tarjeta (R43.6, R53.4).
- **R78.6** [M15i] Las preguntas cortas siguen como hasta ahora, en su tarjeta.
- **R78.7** [M15i] En la ejecución, el modal de una confirmación o revisión tiene un lateral con lo que hizo el paso según los eventos, no según lo que cuenta: los archivos que creó o modificó (cada uno abre su vista previa, SPEC-054), lo que lleva gastado (tokens, coste, tiempo) y los avisos del Supervisor de ese paso. `stepFacts(events, nodeId, nodePath)` (pura, en `editor`) lo calcula.
- **R78.8** [M15i] En una confirmación o revisión, el pie tiene «Aprobar» destacado («la ejecución sigue») y «Pedir cambios», que despliega el cuadro con la explicación «El paso se repite con lo que escribas». Ctrl+Intro envía. La cabecera dice qué se revisa, la ronda («ronda 2») y que la ejecución espera.

## Escenarios
- **E78.a** *Dado* un Especificador que pide confirmar un resumen de 40 líneas, *entonces* al entrar en la ejecución se abre el modal con «Confirmar lo que ha hecho Especificador · agente Spec Writer» arriba y «Aprobar» abajo, siempre a la vista.
- **E78.b** *Dado* que la persona cierra el modal, *entonces* la ejecución sigue esperando y queda la línea con «Revisar y responder».
- **E78.c** *Dado* «¿Pixel art o vectorial?», *entonces* se responde en la tarjeta, sin modal.

## Fuera de alcance
- Comparar con la entrega anterior en el modal (diferencias entre rondas de confirmación).
