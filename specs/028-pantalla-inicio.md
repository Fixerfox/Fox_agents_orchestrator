# SPEC-028 · Pantalla de inicio y proyectos recientes

**Estado:** Implementada · **Hito:** M6b · **Paquetes:** `core`, `store`, `editor`, `ui`, `desktop`

## Propósito
Sin un proyecto abierto no tiene sentido enseñar el editor: la app empieza en una pantalla de inicio donde se crea un proyecto, se abre uno o se retoma uno reciente. La interfaz nunca ve ni envía rutas del sistema: los recientes se identifican con un id opaco.

## Requisitos
- **R28.1** [M6b] Sin proyecto abierto la app muestra la pantalla de inicio (no el editor): título, «Crear proyecto», «Abrir proyecto» y la lista de recientes; desde ahí también se abren Ajustes. Al abrir o crear un proyecto aparece el editor.
- **R28.2** [M6b] Los recientes se guardan en la carpeta de datos de la app (`recent.json`, versionado y con escritura atómica): máximo 10, el más reciente primero, sin duplicados por carpeta, y se actualizan al crear o abrir un proyecto. Un archivo dañado equivale a una lista vacía.
- **R28.3** [M6b] Cada reciente muestra nombre, carpeta contenedora (sin ruta absoluta) y cuándo se abrió. Abrirlo usa su id; si la carpeta ya no existe o no es un proyecto, el elemento lo indica, no se abre y ofrece quitarlo de la lista.
- **R28.4** [M6b] «Quitar de la lista» olvida el reciente sin borrar ningún archivo del disco.
- **R28.5** [M6b] Sin recientes la pantalla lo explica y ofrece crear o abrir. Si crear o abrir falla, el motivo se muestra en la pantalla; cancelar el diálogo del sistema no hace nada.
- **R28.6** [M6b] El IPC ofrece listar recientes, abrir uno por id, olvidarlo y cerrar el proyecto; valida cada petición y rechaza campos extra o ids no válidos.
- **R28.7** [M6b] «Cerrar proyecto» (botón de la barra) vuelve a la pantalla de inicio; si hay cambios sin guardar pide confirmación. Cierra las ejecuciones en curso del proyecto.
