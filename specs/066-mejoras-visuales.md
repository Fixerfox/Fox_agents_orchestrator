# SPEC-066 · Mejoras visuales (1): ventana «Configurar» con índice y lateral del paso

**Estado:** Implementada (M14) · **Hito:** M14 · **Paquetes:** `editor`, `ui` · **Rama:** `feature/mejoras-visuales`

## Propósito
El 07/11 el usuario pidió rediseñar del todo la ventana «Configurar «<paso>»» (SPEC-064). Entre cuatro propuestas del lienzo «Orquestador · Configurar paso (rediseño)» eligió la **A, ficha con índice**. Después pidió rediseñar también el lateral que aparece al pulsar un agente o cualquier elemento del diagrama. La rama se llama «mejoras visuales» porque vendrán más.

Problemas de la ventana actual:
- Repite tal cual el lateral.
- Hay tres sitios para el agente: la pestaña «El agente», «Editar» y «Cambiar».
- No se distingue qué viene del agente y qué cambia solo en este paso.
- La tarea deja media pantalla vacía y la columna derecha obliga a un scroll largo.
- Falta un pie: no se sabe si se guarda solo ni cómo deshacer.

## Decisiones (07/11/2026)
1. **Cómo se organiza la ventana.**
   - *Primera:* un índice a la izquierda que salta (scroll) a cada sección, con todas a la vista.
   - *Revisión:* así sigue el scroll largo, y la ficha del agente (R57.5) ya enseña una sección cada vez.
   - *Segunda (elegida):* **índice con una sección cada vez**, como la ficha del agente. Cada entrada del índice enseña un resumen debajo, así que se ve cómo está el paso sin abrir nada.
2. **Qué pasa con la pestaña «El agente».**
   - *Primera:* quitarla y llevar «Editar el agente» a Agentes.
   - *Revisión:* se perdería lo que pidió SPEC-064, editar el agente sin salir del diagrama.
   - *Segunda (elegida):* **«Editar el agente» al pie del índice**. Abre la ficha dentro de la misma ventana, con «Volver al paso» y el aviso de que vale para todos los diagramas. Lo demás de R64.4 no cambia.
3. **Qué cuenta como «cambiado en este paso».**
   - Solo lo que sobrescribe al agente: el modelo, «Confirmar antes de terminar» y el conocimiento «solo en este paso».
   - El nombre y la tarea son siempre del paso, así que no cuentan.
   - Los permisos son del proyecto (SPEC-047; por paso queda fuera de alcance). Por eso la sección lo dice claro y no lleva marca.
4. **«Restablecer paso».** Quita de una vez el modelo, «Confirmar» y el conocimiento añadido, en un solo paso de historial (se puede deshacer). No toca ni el nombre ni la tarea.
5. **El lateral.**
   - *Primera:* dejarlo como resumen de solo lectura con un botón a la ventana.
   - *Revisión:* el lateral es donde más se edita la tarea, y obligar a abrir una ventana para cambiar el modelo empeora lo que funciona.
   - *Segunda:* mismos campos en secciones plegables, todas abiertas.
   - *Tercera (elegida por el usuario, prototipo D del lienzo):*
     - **Pestañas arriba**, «Tarea · Agente · Conocimiento · Permisos», con una sección cada vez y el lienzo siempre visible.
     - «Permisos» junta «Confirmar antes de terminar» y los archivos, porque es todo lo que el paso puede hacer sin preguntarte.
     - Cada pestaña lleva la marca ámbar de R66.2 y su resumen como ayuda emergente.
     - La pestaña elegida se recuerda al pasar a otro paso, para comparar el mismo ajuste en varios.
     - Las piezas son las mismas que las de la ventana, para que nunca digan cosas distintas (decisión 2 de SPEC-064).
6. **«Confirmar antes de terminar»** pasa de «Quién lo hace» a una sección propia, «Supervisión», en la ventana y en el lateral.

## Requisitos
- **R66.1** [M14] La ventana «Configurar «<paso>»» tiene una cabecera con el icono del agente, el nombre del paso editable y, si hay cambios solo en este paso, la etiqueta «<n> cambio(s) solo en este paso». A la izquierda, un índice «Secciones del paso» con «Tarea», «Quién lo hace», «Conocimiento», «Archivos y permisos» (si hay carpeta de trabajo) y «Supervisión». Cada entrada lleva su resumen debajo. Se ve una sección cada vez, y la activa lleva `aria-current="page"`.
- **R66.2** [M14] Las entradas «Quién lo hace» (modelo propio), «Conocimiento» (algo solo en este paso) y «Supervisión» (confirmar) llevan una marca ámbar cuando el paso sobrescribe al agente, con el texto accesible «cambiado en este paso». La sección «Archivos y permisos» avisa de que los permisos valen para todo el proyecto.
- **R66.3** [M14] Si el agente es del proyecto y se puede editar, al pie del índice aparece «Editar el agente». Abre la ficha (R64.4) dentro de la ventana, con «Volver al paso». El Coordinador no lo tiene.
- **R66.4** [M14] La ventana tiene un pie fijo con «Se guarda solo · solo afecta a este paso», «Restablecer paso» y «Listo», que cierra. «Restablecer paso» quita el modelo, «Confirmar» y el conocimiento solo de este paso en un único paso de historial. Está desactivado si no hay nada que restablecer o el diagrama está en solo lectura.
- **R66.5** [M14] El lateral de un nodo empieza por una cabecera con su tipo («Agente», «Router», «Bucle», «Revisión», «Transformar», «Subdiagrama», «Entrada» o «Salida») y su nombre editable. En un paso agente, el tipo lleva además el nombre del agente.
- **R66.6** [M14] En el lateral, un paso agente tiene arriba las pestañas «Tarea», «Agente», «Conocimiento» y «Permisos» (`role="tablist"`), con una sección cada vez. «Permisos» reúne «Confirmar antes de terminar» y, si hay carpeta de trabajo, «Archivos y permisos». Cada pestaña lleva la marca de R66.2 cuando lo suyo sobrescribe al agente, y la elegida se recuerda al cambiar de paso mientras dure la sesión. El pie tiene «Restablecer paso» (R66.4), junto a «Duplicar» y «Eliminar».
- **R66.7** [M14] Las cuentas y la vuelta al agente salen del editor (`stepOverrides`, `resetStepPatch`), no de la interfaz. Así el lateral y la ventana cuentan igual.

## Cambia
- **R64.1 y R64.4:** la ventana ya no tiene pestañas. «El agente» se abre con «Editar el agente» (R66.3) y se vuelve con «Volver al paso».
- **R64.3:** los ajustes del paso van por secciones del índice, no en dos columnas.

## Fuera de alcance
- Permisos por paso (siguen siendo del proyecto o del agente).
- Una ventana «Configurar» para router, bucle, revisión y transformar. Su lateral sí estrena cabecera y tarjeta.
