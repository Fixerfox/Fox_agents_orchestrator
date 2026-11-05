# SPEC-017 · Panel de resultados

**Estado:** Borrador · **Hito:** M4 · **Paquete:** `ui`

## Requisitos
- **R17.1** [M4] El panel lista los archivos de `runs/<runId>/output/` y los producidos por cada agente (`file.produced`), agrupados por nodo.
- **R17.2** [M4] Previsualización de texto y código de un archivo de salida (con límite de tamaño).
- **R17.6** [M4b] Resaltado de código, imágenes y audio; el resto se abre con la aplicación del sistema.
- **R17.3** [M4b] Para bucles, se puede navegar por las instantáneas de cada iteración y comparar dos de ellas.
- **R17.4** [M4b] Acciones: abrir la carpeta, copiar la ruta y exportar los resultados de una ejecución.
- **R17.5** [M4] Se muestra la salida de texto final de la ejecución y qué agente produjo cada archivo.
