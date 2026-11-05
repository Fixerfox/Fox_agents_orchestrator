# SPEC-003 · Ejecución del grafo

**Estado:** Implementada (M1) · **Hito:** M1 · **Paquete:** `core` (`Orchestrator`)

## Propósito
Cómo se recorre un diagrama: qué recibe cada nodo, cuándo se ejecuta, qué pasa con paralelismo, uniones y fallos.

## Requisitos
- **R3.1** [M1] El `entry` recibe la orden de entrada; cada nodo recibe lo que entregan sus aristas entrantes; el resultado de la ejecución es la salida del nodo `output`.
- **R3.2** [M1] Un nodo se ejecuta cuando todas sus aristas entrantes están resueltas (entregadas o muertas). Los nodos independientes se ejecutan en paralelo.
- **R3.3** [M1] Si llegan varias entradas, se combinan: el texto con una cabecera `## <etiqueta del origen>` por entrada y los archivos como unión sin duplicados. Con una sola entrada pasa sin cambios.
- **R3.4** [M1] La concurrencia máxima de agentes es configurable (4 por defecto) y nunca se supera.
- **R3.5** [M1] Si un nodo falla, sus descendientes sin otra entrada pasan a `skipped`; los nodos independientes continúan; la ejecución termina `failed` y conserva la salida parcial si el `output` se alcanzó.
- **R3.6** [M1] Un nodo con al menos una entrada entregada y otras muertas se ejecuta con las entregadas.
- **R3.7** [M1] Un diagrama inválido no ejecuta ningún nodo: emite `error` (`Diagrama inválido…`) y termina `failed`.
- **R3.8** [M1] La omisión se propaga: un nodo cuyas entradas están todas muertas pasa a `skipped` sin llamar a su adapter, y lo mismo ocurre con sus descendientes que solo dependían de él.
- **R3.9** [M1] Cada nodo emite `node.queued`, `node.started` y `node.finished`; cada arista entregada emite `edge.traversed`; un nodo omitido emite `node.finished` con `skipped`.
- **R3.10** [M1] El resultado incluye `status`, `output`, `events` y el uso acumulado (tokens y coste).
- **R3.11** [M1] La salida de un nodo (su texto y los archivos que ha producido) es exactamente lo que recibe el siguiente. Las entradas no se copian automáticamente a la salida; los archivos siguen disponibles para todos en el espacio de trabajo.

## Escenarios
- **E3.a** *Dado* `entry → A → output` y `entry → B → output`, *cuando* A falla y B no, *entonces* el `output` se ejecuta con la salida de B, A queda `failed` y la ejecución `failed`.
- **E3.b** *Dado* `entry → A → B → output` donde A falla, *entonces* B queda `skipped` y no se llama a su adapter.
