# SPEC-002 · Bus de eventos y catálogo

**Estado:** Implementada (M1) · **Hito:** M1 · **Paquete:** `core`

## Propósito
El bus es el **único contrato** entre el motor y la UI. Todo lo que ocurre en una ejecución es un evento ordenado, persistible y reproducible. El catálogo vigente está en `docs/04-eventos.md`.

## Requisitos
- **R2.1** [M1] `seq` empieza en 1 y aumenta de uno en uno por ejecución, sin huecos ni duplicados.
- **R2.2** [M1] Cada evento lleva `runId`, `ts` (ISO 8601) y, si procede de un contenedor, `nodePath`; en el nivel raíz `nodePath` está ausente.
- **R2.3** [M1] `subscribe(listener, { fromSeq })` entrega el historial desde ese `seq` y después los eventos en vivo, sin duplicados ni huecos.
- **R2.4** [M1] Un listener que lanza una excepción no afecta a los demás ni a la ejecución.
- **R2.5** [M1] La función devuelta por `subscribe` cancela la suscripción.
- **R2.6** [M1] Antes de entrar en el log se ocultan claves sensibles (`apiKey`, `token`, `password`, `secret`, `authorization`…) y secretos reconocibles (`sk-…`, `Bearer …`, tokens de GitHub). El objeto original no se modifica.
- **R2.7** [M1] En toda ejecución —también inválida, cancelada o con presupuesto agotado— `run.started` es el primer evento y `run.finished` el último.
- **R2.8** [M1] Todo `node.started` tiene un `node.finished` posterior del mismo nodo (también si se cancela).
- **R2.9** [M12] Los oyentes reciben los eventos en orden de `seq`, aunque uno de ellos emita otro mientras se entrega: el nuevo espera su turno. Así se graban en orden.
- **R2.10** [M12] Al leer el log de una ejecución los eventos salen ordenados por `seq`, para abrir también las grabadas antes de R2.9.
- **R2.11** [M12] `RunClient` enseña lo que pudo leer aunque el historial tenga un hueco, y dice que faltan eventos: nunca se queda cargando.

## Escenarios
- **E2.a** *Dada* una UI que se conecta a una ejecución en curso con `fromSeq = 5`, *entonces* recibe los eventos 5..N del historial y luego los nuevos, en orden.
- **E2.b** *Dado* un evento `tool.called` con `input: { apiKey: "sk-ant-abc…" }`, *entonces* el log contiene `[REDACTED]` y el objeto del llamador sigue intacto.
