# SPEC-020 · Servicio de ejecución (proceso principal)

**Estado:** En implementación (M4) · **Hito:** M4 · **Paquete:** `runtime`

## Propósito
Poner el orquestador al alcance de la interfaz: arrancar ejecuciones del proyecto abierto, controlarlas, entregar sus eventos sin pérdidas y exponer sus resultados. La UI solo consume eventos (SPEC-002).

## Requisitos
- **R20.1** [M4] `start` carga un diagrama del proyecto, lo valida y, si tiene problemas, lo rechaza con el código `invalid-diagram` sin crear ejecución. Si es válido arranca una ejecución registrada en disco (SPEC-010) y devuelve su `runId`. Admite presupuesto opcional.
- **R20.2** [M4] Pausar, reanudar, cancelar y responder preguntas actúan sobre la ejecución indicada; un `runId` desconocido devuelve `not-found`. Responder devuelve `true`/`false` como `RunHandle.answer`.
- **R20.3** [M4] `subscribe(runId, fromSeq)` devuelve el historial desde `fromSeq` y después entrega los eventos en vivo, sin perder ni duplicar ninguno aunque lleguen mientras se prepara el historial. Para ejecuciones terminadas o de sesiones anteriores el historial sale del disco.
- **R20.4** [M4] El envío en vivo se agrupa por lotes (por defecto 50 ms) conservando el orden; al terminar la ejecución se vacía el lote pendiente y no se pierde ningún evento.
- **R20.5** [M4] Se pueden listar las ejecuciones del proyecto (marcando las que siguen vivas) y consultar las preguntas pendientes de una ejecución viva.
- **R20.6** [M4] La lista y la lectura de archivos de salida (`runs/<runId>/output/`) solo accede a esa carpeta: rechaza rutas que salgan de ella y limita el tamaño leído (1 MB), indicando si se truncó.
- **R20.7** [M4] Mientras no exista el adapter de Claude (M6), la app usa un orquestador de demostración con agentes simulados deterministas, para poder probar la vista en vivo sin coste.
