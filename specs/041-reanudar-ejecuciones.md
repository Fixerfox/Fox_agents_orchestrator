# SPEC-041 · Reanudar o cancelar una ejecución parada

**Estado:** Implementada (M8f) · **Hito:** M8f · **Paquetes:** `core`, `store`, `runtime`, `editor`, `ui`, `desktop`

## Propósito
Una ejecución se puede quedar parada sin haber terminado bien: la app se cerró a mitad (interrumpida), un paso falló o se canceló. Hasta ahora solo se podía mirar. Hay que poder seguir desde donde se quedó sin volver a pagar lo ya hecho, o darla por cerrada.

## Decisiones (05/11/2026)
1. *Primera:* continuar la misma ejecución (mismo id). *Revisión:* el estado del motor (promesas, espacios de trabajo, colas) ya no existe y mezclar dos tandas de eventos con la misma secuencia rompe el registro, el cronograma y la deduplicación por `seq`. *Segunda (elegida):* «Reanudar» crea **una ejecución nueva enlazada** con la anterior (`resumedFrom` / `resumedBy`) que **reutiliza** lo que ya terminó bien.
2. Qué se reutiliza: la salida de los pasos de **agente, transformación y subdiagrama del nivel principal** que terminaron bien en la anterior (la última de cada uno, una sola vez). Lo de dentro de bucles no se reutiliza (cada vuelta es distinta) y routers y revisiones se vuelven a decidir con lo reutilizado. Los archivos que escribieron siguen en la carpeta.
3. Se usa el diagrama guardado al arrancar la anterior (R35.16); si no lo hay, el actual. La entrada es la misma.
4. «Cancelar» solo tiene sentido en una interrumpida (las fallidas y canceladas ya están cerradas): la cierra como cancelada en su registro.

## Requisitos
- **R41.1** [M8f] `resumePlan(diagram, events)` devuelve, por id de paso del nivel principal de tipo agente, transformación o subdiagrama, la última salida con la que terminó bien en esos eventos. Con `RunOptions.reuse`, el orquestador no ejecuta esos pasos la primera vez que llega a ellos: emite `node.started`, `node.reused` (`fromRunId`) y `node.finished` correcto con la salida guardada, sin llamar al agente ni gastar tokens; las siguientes veces (vueltas de revisión) se ejecutan con normalidad. `run.started` lleva `resumedFrom`.
- **R41.2** [M8f] «Reanudar» (`resumeRun`) vale para una ejecución interrumpida, fallida o cancelada (no para una en curso ni para una que ya terminó bien): arranca una nueva con el diagrama de la anterior y la misma entrada, guarda `resumedFrom` en la nueva y `resumedBy` en la anterior, y devuelve el id nuevo. Una ejecución ya reanudada no se reanuda otra vez (se reanuda la nueva).
- **R41.3** [M8f] «Cancelar» (`dismissRun`) en una ejecución interrumpida añade `run.finished` cancelada con el motivo «Se interrumpió y la cancelaste» a su registro y su `meta.json`; deja de figurar como interrumpida.
- **R41.4** [M8f] En la vista de una ejecución interrumpida, fallida o cancelada aparecen «Reanudar» (y «Cancelar» si está interrumpida) junto a las cifras; «Reanudar» abre la nueva ejecución. La vista enlaza con la otra: «Reanuda una ejecución anterior» / «Se reanudó en otra ejecución», con botón para abrirla.
- **R41.5** [M8f] El «Resumen» marca los pasos reutilizados («reutilizado de la anterior») y no los cuenta como trabajo nuevo en la frase de cabecera.
- **R41.6** [M8f] El asistente puede reanudar con `resume_run` (pide «Permitir» porque gasta tokens); `list_runs` y `get_run` dicen si una ejecución se puede reanudar.
- **R41.7** [M12] Un paso reutilizado trae su rastro de la ejecución anterior (`reusedTrail`): `git.branch`, `git.action`, `file.produced`, `supervisor.note` y `supervisor.alert`, también los de lo que lleva dentro. Así la nueva enseña sus ramas, sus archivos, sus avisos y su resumen, y lo mismo al reanudar una reanudada. Vale igual para corregir.
- **R41.8** [M12] La memoria de la ejecución sigue: los pasos siguientes la reciben con la rama y lo anotado, y la comprobación final (R62.9) cuenta lo que entregaron los pasos reutilizados.
- **R41.9** [M12] Traer el rastro no repite nada: no revisa el paso, no gasta, no pregunta, un aviso no sale dos veces, y `file.produced` lleva `reused` para no copiar otra vez sus archivos.
