# SPEC-005 · Bucles

**Estado:** Implementada (M1) · **Hito:** M1 · **Paquete:** `core`

## Propósito
Repetir un tramo del flujo hasta cumplir una condición (prompt evaluado por IA) o un número de veces, siempre con un tope de seguridad.

## Decisión de diseño
El bucle es un **contenedor**: el nodo `loop` guarda un diagrama interno (`body`, con su `entry` y `output`) y lo ejecuta repetidamente. Así cada nivel sigue siendo un grafo sin ciclos y la UI lo muestra como un grupo donde se sueltan nodos. *(A confirmar con el responsable del producto.)*

## Requisitos
- **R5.1** [M1] El nodo `loop` ejecuta su `body` como un diagrama completo en cada vuelta.
- **R5.2** [M1] La entrada de la vuelta 1 es la entrada del nodo; la de la vuelta *n+1* es la salida de la vuelta *n*. La salida del nodo es la de la última vuelta.
- **R5.3** [M1] Modo `count`: se ejecutan exactamente `count` vueltas.
- **R5.4** [M1] Modo `ai-judge`: tras cada vuelta se llama a `decider.judge({ prompt, output, iteration })`; el bucle termina cuando `done` es verdadero y nunca supera `maxIterations`.
- **R5.5** [M1] Si se alcanza `maxIterations` sin veredicto `done`, el bucle termina con éxito, `verdict: 'done'` y una razón que indica que se alcanzó el máximo.
- **R5.6** [M1] Cada vuelta emite `loop.iteration` (`n`, `max`, `verdict`, `reason?`); el modo `ai-judge` emite además `decision` (`kind: 'judge'`) con petición y respuesta.
- **R5.7** [M1] Los eventos de nodos del cuerpo llevan `nodePath = [idDelBucle]`; `loop.iteration` lleva el `nodePath` del propio bucle.
- **R5.8** [M1] Si el cuerpo falla, el nodo `loop` falla y no se ejecutan más vueltas.
- **R5.9** [M1] Cancelar la ejecución durante un bucle lo detiene sin más vueltas.
- **R5.10** [M1] Superar la profundidad máxima de anidación (8 por defecto) hace fallar el nodo con un `error`.

## Escenarios
- **E5.a** *Dado* un bucle `count: 3` cuyo cuerpo añade «+» al texto, *cuando* recibe «x», *entonces* sale «x+++» y hay 3 eventos `loop.iteration`.
- **E5.b** *Dado* un bucle `ai-judge` con `maxIterations: 3` y un evaluador que nunca da `done`, *entonces* hay 3 vueltas y la última indica «máximo de iteraciones alcanzado».
