# SPEC-054 · Vista previa de lo que hace cada paso

**Estado:** Implementada (M8g) · **Hito:** M8g · **Paquetes:** `store`, `runtime`, `editor`, `ui`, `desktop`

## Propósito
En la ejecución hay que ver **qué ha hecho cada paso sin salir del lienzo**: los archivos que creó o cambió, y la web, la imagen o el documento ya mostrados. Cada ejecución tiene que enseñar lo suyo aunque una posterior haya cambiado esos archivos.

Diseños: lienzo «Orquestador · Correcciones y vista previa» (pantallas 1 y 4).

## Decisiones (05/11/2026)
1. *Primera:* una tarjeta grande con la vista previa siempre abierta junto a cada nodo. *Revisión:* en diagramas de 7 u 8 pasos tapa el lienzo, y cargar una página viva por nodo es lento. *Segunda (elegida):* **fichas pequeñas debajo del nodo** con los archivos (como pidió el usuario: `plan.md` bajo el Planificador técnico). Pulsar una abre la vista previa.
2. Las fichas salen de los eventos `file.produced` que ya registra la ejecución (SPEC-045). No hace falta tocar el motor.
3. *Primera:* mostrar la web leyendo el archivo de la carpeta en el momento. *Revisión:* si otra ejecución lo cambia, el Historial enseña lo que no era. *Segunda (elegida):* al terminar cada paso se **copia lo que hizo** a `.orquestador/runs/<id>/previews/<paso>/`, con los recursos relativos de una web, y la vista previa lee esa copia.
4. La web se muestra en un marco aislado (`sandbox`, sin Node ni acceso a la app), servida por un protocolo propio de solo lectura limitado a la copia de esa ejecución.

## Requisitos
- **R54.1** [M8g] En el lienzo de una ejecución, cada paso que creó o cambió archivos lleva debajo, unidas con una línea, unas fichas con el nombre de cada archivo y un icono según su tipo (web, imagen o documento), en el orden en que los tocó. Se ven las dos primeras; «+N» despliega el resto y, desplegado, «Ocultar» lo vuelve a plegar. Si dos archivos se llaman igual, la ficha lleva su carpeta (`es/index.html`). `filesByStep(events)` las agrupa por clave `ruta/id`, una vez por archivo y con su cambio acumulado (creado manda sobre cambiado).
- **R54.2** [M8g] Pulsar una ficha abre, encima del nodo y unida con una línea discontinua, una tarjeta con la vista previa pequeña de ese archivo (la web, la imagen o el documento); pulsarla otra vez la cierra. La tarjeta queda siempre por encima de todo lo del lienzo (fichas de conocimiento, otros pasos y conexiones). «Ampliar» abre la vista previa en grande. Un archivo borrado se ve tachado y no se abre.
- **R54.3** [M8g] Al terminar bien un paso del nivel principal, se copian los archivos que creó o cambió (y, si alguno es HTML, los recursos relativos que enlaza: CSS, JS e imágenes) a `.orquestador/runs/<id>/previews/<paso>/`, como mucho 20 MB por paso. Nunca se copian secretos (`.env`, claves…) ni nada de `.orquestador` o `.git`. `settled` espera a que terminen las copias.
- **R54.4** [M8g] `previewFile(runId, nodeKey, path)` devuelve la copia de esa ejecución: imagen como datos, Markdown y texto como texto, y para HTML una dirección del protocolo propio `orq-preview:` que solo sirve archivos de esa copia. Si el paso se reutilizó, se usa la copia de la ejecución de la que viene (corregida o reanudada, hasta 5 atrás); si no hay copia (ejecución anterior a esta spec), el archivo tal como está en la carpeta, si la ejecución lo tocó, y se dice. La web va en un marco `sandbox="allow-scripts"` con su propia política de contenido (sin red ni formularios) y no puede navegar fuera de su copia. `openPreview` abre la copia con el programa del sistema.
- **R54.5** [M8g] La vista previa en grande tiene una pestaña por archivo, «Escritorio / Móvil» para la web, «Comparar con la anterior» cuando la ejecución corrige o reanuda otra, «Ver cambios» (el visor de SPEC-045), «Abrir fuera» y «Pedir corrección» (SPEC-053) con ese paso sugerido.
- **R54.6** [M8g] La tarjeta de una revisión humana (SPEC-053) enseña miniaturas (hasta 4, y «y N más») de los archivos que hicieron los pasos de su nivel desde su decisión anterior (`filesSinceReview`); pulsar una la abre en grande.

## Fuera de alcance
- Webs que necesitan un servidor (`npm run dev`, APIs propias).
- Recursos de una web que se cargan de internet (fuentes o CDN): la vista previa no tiene red.

## Estado (05/11/2026, 23:30)
- Implementada en `D:\FixerfoxGames\Orquestador`. Tests: `runtime/test/previews.test.ts` (4), `ui/test/step-files.test.tsx` (5) y uno nuevo en `desktop/test/window.test.ts`.
- Sin probar dentro de Electron: el protocolo `orq-preview:` y el marco aislado solo se han probado con dobles.
