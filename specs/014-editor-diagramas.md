# SPEC-014 · Editor de diagramas

**Estado:** En implementación (M3) · **Hito:** M3 / M3c · **Paquetes:** `editor` (modelo puro), `ui` (React + React Flow)

## Propósito
Crear y editar diagramas de forma visual. Toda la lógica de edición vive en un modelo **puro y testeable** (`editor`); la interfaz solo lo pinta y le envía acciones.

## Decisiones de diseño
- **Un solo origen de verdad:** el `Diagram` del núcleo. React Flow es una vista controlada; nunca guarda estado propio del diagrama.
- **Editar un bucle = entrar en él** (doble clic, migas de pan), igual que se hará con los subdiagramas. Su cuerpo es un diagrama con su propio `entry` y `output`. *(La representación como grupo en el que se sueltan nodos queda para más adelante.)*
- La lista de agentes disponibles llega de fuera (`AgentOption[]`); el registro real llega en M5.

## Requisitos
- **R14.1** [M3] Se pueden crear, mover, renombrar y borrar nodos y aristas. Un diagrama nuevo trae `entry` y `output` ya conectados (es válido y ejecutable). El `entry` y el `output` no se pueden borrar ni duplicar.
- **R14.2** [M3] La paleta añade agente (elegido de la lista disponible), router y bucle, con id único autogenerado y en la posición indicada. El router nace en modo `ai`; el bucle, en modo `count` (3 vueltas, máximo 5) con un cuerpo válido.
- **R14.3** [M3] Tras cada cambio se valida con `validateDiagram`. Los problemas se asocian a su nodo (los de dentro de un bucle señalan al nodo bucle) y se listan con mensaje en español. Con problemas no se puede ejecutar.
- **R14.4** [M3] Deshacer y rehacer sin límite durante la sesión; una acción nueva descarta el rehacer; un arrastre completo de un nodo es un solo paso del historial.
- **R14.5** [M3] Guardar y abrir no pierde nada (incluidas las posiciones). Hay indicador de cambios sin guardar, que se limpia al guardar y al deshacer hasta el punto guardado.
- **R14.6** [M3] No se permite conectar un nodo consigo mismo, duplicar una arista, entrar al `entry`, salir del `output` ni crear un ciclo; el rechazo indica el motivo.
- **R14.7** [M3] Un router permite elegir su modo (`ai` o `rules`); en modo `rules` cada arista saliente admite una condición (texto).
- **R14.8** [M3] Un bucle permite elegir el modo (`count` o `ai-judge`), el número de vueltas o el prompt, y el máximo de iteraciones (obligatorio). Se edita su cuerpo entrando en él; las migas de pan permiten volver. Los bucles se pueden anidar.
- **R14.9** [M3] Hay plantillas de ejemplo (enrutador con 3 agentes y bucle de revisión): son válidas y se pueden cargar como diagrama nuevo.
- **R14.10** [M3] Todos los textos de la interfaz salen de un catálogo en español con interpolación de parámetros; un test detecta claves usadas que no existen.
- **R14.11** [M3] Accesibilidad por teclado: `Supr` borra la selección, `Ctrl+Z` deshace, `Ctrl+Y` y `Ctrl+Mayús+Z` rehacen, `Ctrl+S` guarda; los nodos son enfocables y tienen nombre accesible con su tipo y estado de validación.
- **R14.12** [M3] El inspector edita la etiqueta de un nodo, su agente, la configuración del router y del bucle y la condición de una arista; todo cambio pasa por el historial.
- **R14.13** [M3c] Agrupar nodos seleccionados en una plantilla y sustituirlos por un nodo `subdiagram`; guardar un diagrama como plantilla.
- **R14.14** [M3c] Insertar una plantilla como nodo, elegir versión fijada o última y abrirla con doble clic (migas de pan).
- **R14.15** [M4c] Se puede duplicar un nodo (con su configuración y, si es un bucle, con una copia de su cuerpo) con un id nuevo y una posición desplazada, sin sus conexiones. La entrada y la salida no se pueden duplicar.
