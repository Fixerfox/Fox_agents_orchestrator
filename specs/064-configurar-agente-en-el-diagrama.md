# SPEC-064 · Configurar un agente desde el diagrama

**Estado:** Implementada (M13) · **Hito:** M13 · **Paquetes:** `editor`, `ui` · **Rama:** `feature/configurar-agente`

## Propósito
El 07/11 el usuario pidió mejorar cómo se edita un agente desde el diagrama. Hoy todo pasa por el lateral derecho, que se queda corto: la tarea se escribe en una caja estrecha, y para cambiar el agente en sí (instrucciones, skills, permisos) hay que salir a Agentes y perder de vista el diagrama. Pidió que, **con doble clic sobre un agente o con el botón derecho → «Configurar»**, se abra una ventana amplia.

## Decisiones (07/11/2026)
1. **Qué se configura.**
   - *Primera:* solo el paso (tarea, modelo, conocimiento), igual que el lateral pero más ancho.
   - *Revisión:* entonces lo que falta, editar el agente sin salir del diagrama, seguiría obligando a ir a Agentes. Y mezclar sin más los dos niveles confunde, porque un cambio en el agente vale para todos los diagramas.
   - *Segunda (elegida):* **dos pestañas.** «Este paso» tiene lo que solo vale aquí. «El agente» tiene la ficha por secciones de SPEC-057, con un aviso de que sus cambios valen en todos los diagramas que lo usan.
2. **De dónde salen los campos del paso.**
   - *Primera:* un formulario nuevo para la ventana.
   - *Revisión:* dos copias de los mismos campos acabarían diciendo cosas distintas.
   - *Segunda (elegida):* **las mismas piezas que el lateral**, colocadas en dos columnas: la tarea, más alta, a la izquierda; quién lo hace, el modelo, el conocimiento y los archivos a la derecha.
3. **Qué pasa con el doble clic.** En el Diseñador, hoy el doble clic solo entra en los bucles y en el resto de nodos no hace nada. Ahora, en un agente (también el Coordinador) abre la ventana; los bucles siguen igual.
4. **Borrar el agente desde la ventana.** *Primera:* dejar «Eliminar» como en la ficha. *Revisión:* el paso que tienes delante se quedaría sin agente. *Segunda (elegida):* **sin «Eliminar»**: borrar se hace en Agentes.
5. **Lo que no se ha guardado.** Lo escrito en un campo del paso se aplica al cerrar, como al salir de él en el lateral. Lo que no se ha guardado en la ficha del agente se queda como borrador, igual que en Agentes (R32.34): al volver a abrirla sigue ahí.
6. **Cambia R32.34:** el menú del botón derecho de un agente empieza ahora por «Configurar…», y después van «Editar el agente» y «Cambiar el agente…».

> **Cambiada por SPEC-066 (07/11):** la ventana ya no tiene pestañas. Los ajustes del paso van en un índice con una sección cada vez, y «El agente» se abre con «Editar el agente» al pie del índice (con «Volver al paso»).

## Requisitos
- **R64.1** [M13] En el Diseñador, el doble clic sobre un nodo agente (incluido el Coordinador) abre la ventana «Configurar «<paso>»». Sobre un bucle sigue entrando en él, y en los demás tipos de nodo no cambia nada.
- **R64.2** [M13] El menú del botón derecho de un nodo agente empieza por «Configurar…», que abre la misma ventana, también con el diagrama en solo lectura. La cabecera del lateral, con un paso agente seleccionado, tiene «Abrir en grande», que abre la misma ventana.
- **R64.3** [M13] La pestaña «Este paso» tiene el nombre del paso y los ajustes del lateral (tarea con ✦, quién lo hace con «Cambiar», modelo de este paso, «Confirmar antes de terminar», conocimiento del agente y «solo en este paso», y archivos), en dos columnas. Los cambios llegan al diagrama igual que desde el lateral y se pueden deshacer.
- **R64.4** [M13] La pestaña «El agente» enseña la ficha por secciones del agente (R57.5), con «Guardar» y Ctrl+S, y avisa «Los cambios valen para todos los diagramas que usan a «<agente>»». No tiene «Eliminar», pero sí «Abrir en Agentes», que cierra la ventana y abre ese agente en Agentes. Al guardar, la paleta y los nodos se actualizan sin cerrar la ventana. Solo aparece si el agente es del proyecto y se puede editar; el Coordinador no la tiene. En el lateral, «Editar» del agente abre la ventana en esta pestaña.
- **R64.5** [M13] La ventana se cierra con ✕, con Esc o pulsando fuera. Lo escrito en un campo del paso se aplica al cerrar; lo que no se ha guardado en la ficha del agente se queda como borrador y vuelve a aparecer al abrirla de nuevo.
- **R64.6** [M13] Con el diagrama en solo lectura (R32.37), la ventana solo sirve para consultar: los campos del paso están desactivados, y la ficha del agente avisa de que está bloqueada y no guarda.

## Fuera de alcance
- Ventana de configuración para el resto de nodos (router, bucle, revisión, transformar).
- Crear un agente nuevo desde la ventana; sigue haciéndose desde la galería o Agentes.
