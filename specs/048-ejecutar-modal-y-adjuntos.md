# SPEC-048 · Diálogo «Ejecutar» en un modal con pestañas y adjuntos en la entrada

**Estado:** Implementada (M8g) · **Hito:** M8g · **Paquetes:** `store`, `runtime`, `editor`, `ui`, `desktop`

## Propósito
Con el entregable (SPEC-046), el diálogo «Ejecutar» ya no cabía. Crecía hacia abajo pegado a la esquina superior derecha y no tenía scroll. El usuario pidió el 05/11 dos cosas:
- Un modal de verdad, más ancho y más grande, con espacio para escribir. De los cuatro prototipos del artefacto «Diálogo Ejecutar» eligió la propuesta C, con pestañas.
- Poder añadir imágenes y archivos a la entrada.

## Decisiones (05/11/2026)
1. **Forma del modal:** centrado, de hasta 960 × 760 px y nunca más grande que la ventana menos 48 px.
   - La cabecera y el pie son fijos, y solo el contenido hace scroll.
   - Hay dos pestañas: «Ejecución» y «Entregable». La del entregable lleva su resumen al lado, para que no quede escondido.
2. **Adjuntos, primera propuesta:** el renderer manda la ruta de cada archivo arrastrado.
   - **Revisión:** rompe la regla de que la interfaz nunca ve ni envía rutas.
   - **Segunda propuesta (elegida):**
     - «Adjuntar» y «Del proyecto…» abren el diálogo del sistema desde el proceso principal, como «Elegir carpeta».
     - Lo que se arrastra o se pega viaja como contenido (bytes) por IPC, nunca como ruta.
3. **Dónde se guardan:**
   - Los adjuntos de fuera se copian en `.orquestador/attachments/<id>/<nombre>` y no se borran con la ejecución, para que «Reanudar» siga encontrándolos.
   - Los del proyecto no se copian: se pasa su ruta relativa.
4. **Cómo llegan a los agentes:** como archivos de la entrada del primer paso (`Payload.files`, rutas relativas a la carpeta de trabajo), el mismo camino que entre pasos.
   - El agente los ve en «Archivos recibidos» y los lee con `Read`, que con Claude también abre imágenes y PDF.
   - No hace falta tocar el motor ni el adaptador.
5. **Revisión de la implementación:** sin miniaturas.
   - El renderer no puede abrir rutas y los adjuntos elegidos con el diálogo del sistema no le llegan como datos.
   - Cada ficha lleva un icono de imagen o de archivo, con nombre y tamaño.

## Requisitos
- **R48.1** [M8g] El diálogo «Ejecutar» es un modal centrado (`role="dialog"`):
  - Mide `min(960px, 100vw − 48px)` × `min(760px, 100vh − 48px)`.
  - La cabecera fija tiene el título y «Cerrar»; las pestañas son «Ejecución» y «Entregable · <resumen>».
  - El cuerpo tiene su propio scroll y el pie fijo lleva «Cancelar» y «Ejecutar».
  - Esc, «Cerrar» o pulsar fuera lo cierran. Ctrl+Enter ejecuta.
- **R48.2** [M8g] La pestaña «Ejecución» tiene:
  - La Entrada, que ocupa el alto que queda, con sus adjuntos debajo.
  - El motor y el presupuesto.
  - La pestaña «Entregable» tiene el panel de SPEC-046 y «Guardar en el diagrama». Sus desplegables tienen el estilo de la app.
- **R48.3** [M8g] Adjuntos en la Entrada:
  - Se añaden con «Adjuntar» (archivos de fuera), «Del proyecto…» (archivos de la carpeta de trabajo), arrastrando sobre la Entrada o pegando en ella.
  - Cada uno sale como ficha con icono (imagen o archivo), nombre y tamaño, y «Quitar».
  - Como mucho hay 20, y un archivo de más de 20 MB se rechaza con un aviso.
  - Se puede ejecutar con texto, con adjuntos o con las dos cosas.
- **R48.4** [M8g] `ProjectStore.stageAttachment(name, bytes)`:
  - Guarda el archivo en `.orquestador/attachments/<id>/<nombre saneado>`, sin rutas ni caracteres que Windows no admite.
  - Devuelve `{ id, name, size, image }`.
  - Rechaza un archivo vacío o de más de 20 MB.
  - `attachmentInputPath(id)` da su ruta relativa a la carpeta de trabajo; `inputFiles(rutas)` comprueba que cada ruta del proyecto existe, es un archivo dentro de la carpeta de trabajo y no está en `.git`, `.orquestador` ni `node_modules`.
- **R48.5** [M8g] `RunService.start` acepta `files` (rutas del proyecto) y `attachments` (ids):
  - La entrada del primer paso es `{ text, files: [...files, ...adjuntos] }`.
  - Un id desconocido, una ruta que no vale o más de 20 dan `bad-request`.
  - El texto puede ir vacío si hay archivos.
  - «Reanudar» reutiliza la misma entrada.
- **R48.6** [M8g] Canales IPC:
  - `stageAttachment({ name, data })` recibe bytes de hasta 20 MB.
  - `pickAttachments()` abre el diálogo del sistema y prepara los elegidos.
  - `pickProjectFiles()` abre el diálogo en la carpeta de trabajo, devuelve rutas relativas y rechaza lo que quede fuera.
  - `startRun` valida `files` y `attachments`.
  - El renderer nunca recibe rutas absolutas.

## Fuera de alcance
- Miniaturas de las imágenes.
- Adjuntos en mitad de una ejecución (al responder una pregunta).
- Borrar los adjuntos que ya no use ninguna ejecución.
