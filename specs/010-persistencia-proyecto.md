# SPEC-010 · Persistencia y estructura de proyecto

**Estado:** Implementada (M2); R10.10 pendiente de M5 · **Hito:** M2 · **Paquete:** `store`

## Propósito
Cómo se guardan proyectos, diagramas y ejecuciones en disco. Un **proyecto** es una carpeta real del usuario con una subcarpeta `.orquestador/`.

## Estructura
```
<proyecto>/
  .orquestador/
    project.json                 # nombre, schemaVersion, pins de versiones
    diagrams/<id>.json
    templates/<id>.json
    agents/ skills/ contexts/    # elementos propios del proyecto (M5)
    runs/<runId>/
      meta.json  events.jsonl  output/  iterations/
```
La biblioteca global (AppData en Windows, `~/.config/orquestador` en Linux) llega en M5.

## Decisión de diseño
El historial de ejecuciones **no usa SQLite** por ahora: `meta.json` de cada ejecución actúa de índice (se lista sin leer `events.jsonl`) y siempre se puede reconstruir desde las carpetas. Se revisará si el volumen lo exige.

## Requisitos
- **R10.1** [M2] Los documentos se guardan como JSON con `schemaVersion`. Al abrir uno anterior se migra paso a paso a la versión actual, se escribe migrado y se conserva una copia de respaldo del original (`<archivo>.v<N>.bak`); abrir uno ya actual no crea respaldos.
- **R10.2** [M2] Las escrituras son atómicas (archivo temporal + renombrado): si falla, el archivo original queda intacto y no quedan temporales.
- **R10.3** [M2] Las rutas guardadas son relativas a la raíz del proyecto y con `/` como separador; funcionan igual en Windows y Linux. Una ruta que sale de la raíz se rechaza.
- **R10.4** [M2] Un proyecto copiado o movido a otra carpeta se abre y se lee sin romper referencias (diagramas y ejecuciones).
- **R10.5** [M2] Nunca se escriben secretos (claves o tokens reconocibles) en archivos del proyecto: el guardado se rechaza con el error `secrets` y no crea ni modifica el archivo.
- **R10.6** [M2] Las ejecuciones se listan a partir de sus `meta.json`, sin leer `events.jsonl`, ordenadas de más reciente a más antigua.
- **R10.7** [M2] Abrir un archivo corrupto (`corrupt`), de una versión futura (`future-version`) o inexistente (`not-found`) produce un error claro y nunca modifica el archivo.
- **R10.8** [M2] Los ids que forman nombres de archivo son seguros: solo letras, números, `.`, `_`, `-`, empezando por letra o número, sin `..` ni separadores y de hasta 128 caracteres (`invalid-id`).
- **R10.9** [M2] Crear un proyecto genera `.orquestador/` con su estructura y `project.json`; crear sobre un proyecto existente falla (`exists`) y abrir una carpeta que no es un proyecto falla (`not-a-project`).
- **R10.10** [M5] La biblioteca global y los secretos en el almacén seguro del sistema (ver SPEC-011 y SPEC-016).
