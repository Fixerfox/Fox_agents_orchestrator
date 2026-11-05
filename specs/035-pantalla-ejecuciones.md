# SPEC-035 · Pantalla Ejecuciones: submenú, historial y vista de una ejecución

**Estado:** Implementada (M8b) · **Hito:** M8b · **Paquetes:** `store`, `runtime`, `editor`, `ui`, `desktop`

## Propósito
La pantalla Ejecuciones de M7b (pestañas En directo, Resultados y Registro técnico) solo enseña la última ejecución del diagrama abierto. El usuario eligió el prototipo «B2» del artefacto «Orquestador — Ejecuciones» (05/11): un submenú con lo que se está ejecutando, lo que espera respuesta y el historial completo del proyecto, y una vista enfocada de cualquier ejecución con su diagrama, los mensajes de cada paso, un cronograma, el registro, el resultado y los archivos. Sustituye la organización por pestañas de R32.20.

## Requisitos

### Lógica (sin React, `packages/editor`)
- **R35.1** [M8b] `historyRows(runs, diagramNames, now)` devuelve una fila por ejecución, de la más reciente a la más antigua, con el nombre que tenía su diagrama al ejecutarse (o el actual si no se guardó; «Diagrama eliminado» si no hay ninguno), su estado (una ejecución `interrupted` se muestra como «Interrumpida»), la duración en segundos (hasta `now` si sigue en curso), los tokens (entrada + salida), el coste y la entrada.
- **R35.2** [M8b] `filterHistory(rows, filtro)` filtra por grupo de estado (`all`, `active` = en curso, `succeeded`, `failed` = fallidas e interrumpidas, `cancelled`), por diagrama y por texto; el texto busca en la entrada y en el nombre del diagrama sin distinguir mayúsculas ni acentos. `historyCounts(rows)` da el número de cada grupo.
- **R35.3** [M8b] `runTimeline(events, now)` devuelve los pasos de una ejecución en el orden en que empezaron (sin la entrada y la salida internas de los bucles), cada uno con su estado, su inicio y fin relativos al arranque de la ejecución (un paso abierto termina en `now`) y sus marcas: pregunta, reintento, vuelta de bucle o de revisión (SPEC-034) y error. Inicio, ancho y marcas se dan también en porcentaje de la duración total, que es como mínimo 1 s. Un paso que se ejecuta más de una vez (retorno de una revisión) tiene un tramo por pasada (`passes`, R35.17); el inicio y el fin del paso son los de su primer y último tramo.

### Submenú
- **R35.4** [M8b] Ejecuciones tiene un submenú con «En directo», «Necesitan tu respuesta» e «Historial», cada uno con su número; el apartado activo se marca con `aria-current="page"` y al entrar se ve «Historial», o «En directo» si hay algo ejecutándose. Las ejecuciones en curso aparecen bajo «En directo» como accesos directos. Pulsar Ejecuciones en el rail estando ya en ella oculta o muestra el submenú; en ventanas estrechas (≤ 1100 px) empieza oculto.

### Apartados
- **R35.5** [M8b] «En directo» muestra una tarjeta por ejecución en curso con su diagrama, entrada, duración y coste, y, de la ejecución que se sigue en vivo, su paso actual y lo último que dijo (las demás lo enseñan al abrirlas), y los botones Pausar/Reanudar, Cancelar y Abrir. Sin ninguna, explica que no hay nada ejecutándose y que se lanza con «Ejecutar».
- **R35.6** [M8b] «Necesitan tu respuesta» reúne las preguntas pendientes de todas las ejecuciones en curso, cada una con el paso y la ejecución de los que viene, sus opciones y una respuesta libre; responder la envía a esa ejecución y la pregunta desaparece. Sin preguntas, lo dice. El contador del rail es la suma de esas preguntas.
- **R35.7** [M8b] «Historial» es una tabla de todas las ejecuciones del proyecto con estado, diagrama, entrada, inicio, duración, tokens y coste; tiene filtros por estado con su número, un selector de diagrama y una búsqueda. Pulsar una fila abre la ejecución; sin filas, un aviso.

### Vista de una ejecución
- **R35.8** [M8b] La vista de una ejecución tiene una cabecera con el diagrama, el estado, la entrada, la duración, los tokens y el coste; Pausar/Reanudar y Cancelar mientras sigue; un aviso con la pregunta pendiente (que se puede responder allí) o con el motivo del fallo; y «Volver», que lleva al apartado desde el que se abrió. Encima, la ruta «Ejecuciones / apartado / diagrama» permite volver a cada nivel.
- **R35.9** [M8b] El lienzo muestra el diagrama de esa ejecución tal como estaba al ejecutarse (R35.16), aunque no sea el abierto en el editor, en solo lectura y con el estado de cada paso. Al pulsar un paso, el panel derecho muestra sus mensajes (lo que recibió, herramientas, lo que dijo, preguntas y salida); por defecto se ve el paso activo o, si terminó, el último que se ejecutó.
- **R35.10** [M8b] Debajo del lienzo hay cuatro pestañas: «Cronograma» (una fila por paso con su barra y sus marcas; pulsar una fila selecciona el paso), «Historial» (el registro con filtros y exportación de R8.11), «Resultado» (respuesta final con Copiar, cifras y archivos de salida) y «Archivos» (cambios en la carpeta del proyecto con «Restaurar», R32.32).
- **R35.11** [M8b] Al pulsar «Ejecutar» se abre la vista de la nueva ejecución, con «Volver» a «En directo».
- **R35.12** [M8b] Abrir otra ejecución no deja de seguir la que está en curso: sus eventos, sus preguntas y el bloqueo del editor (R32.37) se mantienen.

### Estado verdadero y diagrama del momento
- **R35.13** [M8b] Si una ejecución sigue en marcha lo decide el proceso que la ejecuta (la que se sigue en vivo o la lista de ejecuciones), nunca solo sus eventos. Una ejecución con eventos pero sin `run.finished` y que ya no está en marcha es «Interrumpida».
- **R35.14** [M8b] En una ejecución que ya no está en marcha (terminada, fallida, cancelada o interrumpida) ningún paso aparece «ejecutando», «en cola» ni «esperando tu respuesta»: los que quedaron abiertos se muestran «interrumpido» en el lienzo, en el panel del paso y en el cronograma (con la barra cerrada en su último evento), y sus preguntas sin responder dicen que ya no se pueden contestar. No hay Pausar, Cancelar ni avisos de preguntas pendientes.
- **R35.15** [M8b] El aviso explica qué pasó: «Falló» con su motivo (o «sin motivo registrado») en una fallida, e «Interrumpida» con la explicación de que la aplicación se cerró o se detuvo antes de terminar en una interrumpida. Si la ejecución no registró uso, tokens y coste se muestran «sin datos», no 0.
- **R35.16** [M8b] Al arrancar una ejecución se guarda una copia del diagrama tal como estaba (`diagram.json` en su carpeta) y su nombre en `meta.json`. La vista de la ejecución y el historial usan esa copia y ese nombre aunque luego el diagrama cambie, se renombre o se borre. Para ejecuciones anteriores sin copia se usa el diagrama actual, avisando de que puede no ser el de entonces.
- **R35.17** [M8f] Cada pasada de un paso es un tramo propio de la fila del cronograma, con su inicio, su fin y su estado, y entre dos pasadas queda el hueco en el que trabajaron los demás pasos: el cronograma nunca dibuja un paso como «ejecutando» mientras no lo estaba. Solo la última pasada puede seguir abierta. Al empezar la segunda pasada y las siguientes hay una marca de vuelta «Pasada N · devuelto por <revisión>» si la devolvió una revisión, o «Pasada N» si no se sabe quién.

## Escenarios
- Lanzo «Informe semanal»: se abre su vista. El Redactor pregunta si incluye costes: aparece el aviso arriba, el rail muestra 1 y «Necesitan tu respuesta» la lista. Respondo «Sí» desde allí y la ejecución sigue.
- En «Historial» filtro «Con error» y busco «pr»: veo «Revisión de PR #17». La abro: el lienzo marca «Seguridad» en rojo, el cronograma enseña dos reintentos y el aviso dice por qué falló. «Volver» me deja en el historial con el filtro puesto.
- Mientras «Traducir documentación» se ejecuta abro una ejecución de ayer; al volver a «En directo» la traducción sigue avanzando.
