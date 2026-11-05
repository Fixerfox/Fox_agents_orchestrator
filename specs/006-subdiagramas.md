# SPEC-006 · Subdiagramas (plantillas como nodo)

**Estado:** Motor implementado (M1); UI en M3c · **Hito:** M1 (motor) / M3c (UI) · **Paquete:** `core`

## Propósito
Una plantilla de diagrama completa se usa como **un solo nodo** dentro de otro diagrama.

## Requisitos
- **R6.1** [M1] Un nodo `subdiagram` resuelve su plantilla con `resolveTemplate(templateId, version)` y la ejecuta como una caja negra con una entrada y una salida.
- **R6.2** [M1] Emite `subdiagram.started` y `subdiagram.finished`; los eventos internos llevan `nodePath = [idDelNodo]`.
- **R6.3** [M1] Los subdiagramas se pueden anidar y el `nodePath` se acumula.
- **R6.4** [M1] Una referencia circular, directa o indirecta (también al propio diagrama raíz), hace fallar el nodo con un `error`.
- **R6.5** [M1] Superar la profundidad máxima de anidación hace fallar el nodo.
- **R6.6** [M1] Sin `resolveTemplate`, o con una plantilla inválida, el nodo falla con un `error` y no se ejecuta nada de la plantilla.
- **R6.7** [M1] El subdiagrama comparte con la ejecución padre el presupuesto, la concurrencia, la pausa y la cancelación.
- **R6.8** [M3c] La UI muestra el nodo colapsado con resumen y permite abrirlo para verlo en directo.

## Escenarios
- **E6.a** *Dado* un diagrama con el nodo «Pintar» (plantilla con 2 agentes), *cuando* se ejecuta, *entonces* el padre ve un solo nodo y el log contiene los eventos internos con `nodePath: ['pintar']`.
