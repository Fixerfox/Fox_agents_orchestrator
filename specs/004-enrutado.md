# SPEC-004 · Enrutado (router)

**Estado:** Implementada (M1) · **Hito:** M1 · **Paquete:** `core`

## Propósito
Un nodo `router` decide a cuál(es) de sus salidas pasa el flujo, bien por **reglas** en las aristas, bien por **IA**. El modo se elige por nodo.

## Requisitos
- **R4.1** [M1] Modo `rules`: cada arista con `condition` se evalúa con `decider.condition`; una arista sin condición se elige siempre.
- **R4.2** [M1] Modo `ai`: `decider.route` recibe los candidatos (`edgeId`, `to`, `label`) y la entrada; solo se aceptan `edgeIds` que existan.
- **R4.3** [M1] Se pueden elegir varias rutas a la vez; las no elegidas quedan muertas y los nodos que solo dependen de ellas pasan a `skipped`.
- **R4.4** [M1] Se emite `route.decided` (`chosen` = ids de los nodos destino, `mode`, `reason`) y `decision` con la petición y la respuesta completas.
- **R4.5** [M1] Si no se elige ninguna ruta, el router falla con un `error`.
- **R4.6** [M1] Un nodo de unión posterior a ramas elegidas y no elegidas se ejecuta con las ramas elegidas.
- **R4.7** [M1] El router no modifica el contenido: su salida es su entrada.

## Escenarios
- **E4.a** *Dado* un router `ai` con destinos `sprites`, `gameplay` y `sonido`, *cuando* la IA elige `sprites` y `sonido`, *entonces* `gameplay` queda `skipped` y `route.decided.chosen = ['sprites','sonido']`.
