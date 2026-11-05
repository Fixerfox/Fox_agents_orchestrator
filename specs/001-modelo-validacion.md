# SPEC-001 · Modelo y validación de diagramas

**Estado:** Implementada (M1) · **Hito:** M1 · **Paquete:** `core`

## Propósito
Definir qué es un diagrama válido. Cada nivel (raíz y cuerpo de cada bucle) es un grafo **sin ciclos**; los ciclos solo existen a través de nodos `loop`, que repiten un diagrama interno.

## Requisitos
- **R1.1** [M1] Un diagrama tiene `id`, `name`, `schemaVersion`, `nodes` y `edges`. La versión actual es 1; otra distinta produce el problema `schema-version`. Los nodos pueden llevar una `position` opcional (`x`, `y`) que la validación ignora.
- **R1.2** [M1] Los ids de nodo son únicos (`duplicate-node-id`) y los de arista también (`duplicate-edge-id`).
- **R1.3** [M1] Toda arista apunta a nodos existentes (`unknown-node`) y no conecta un nodo consigo mismo (`self-edge`).
- **R1.4** [M1] Hay exactamente un nodo `entry` (`entry-count`) y exactamente un nodo `output` (`output-count`) por nivel.
- **R1.5** [M1] El `entry` no tiene aristas entrantes (`entry-has-incoming`) y el `output` no tiene salientes (`output-has-outgoing`).
- **R1.6** [M1] Cada nivel está libre de ciclos (`cycle`).
- **R1.7** [M1] Todo nodo es alcanzable desde el `entry` (`unreachable`).
- **R1.8** [M1] Un nodo `agent` requiere `agentId` (`agent-missing-id`).
- **R1.9** [M1] Un nodo `router` requiere configuración (`router-missing-config`) y al menos una salida (`router-no-outgoing`).
- **R1.10** [M1] Un nodo `loop` requiere configuración (`loop-missing-config`); `maxIterations` es obligatorio, entero ≥ 1 (`loop-invalid-max`); en modo `count`, `count` es entero ≥ 1 y ≤ `maxIterations` (`loop-invalid-count`); en modo `ai-judge`, `prompt` no vacío (`loop-missing-prompt`).
- **R1.11** [M1] El cuerpo de un `loop` se valida recursivamente; los problemas indican la cadena de bucles en `path`.
- **R1.12** [M1] Un nodo `subdiagram` requiere `templateId` (`subdiagram-missing-template`).
- **R1.13** [M1] Un diagrama válido devuelve una lista de problemas vacía.

## Escenarios
- **E1.a** *Dado* un diagrama `entry → agent → output`, *cuando* se valida, *entonces* no hay problemas.
- **E1.b** *Dado* `A → B → A` entre dos agentes, *cuando* se valida, *entonces* aparece `cycle` y se indica usar un nodo `loop`.
- **E1.c** *Dado* un bucle cuyo cuerpo no tiene `output`, *cuando* se valida, *entonces* aparece `output-count` con `path = [idDelBucle]`.
