# SPEC-037 · Nodo «Transformar»

**Estado:** Implementada (M8e) · **Hito:** M8e · **Paquetes:** `core`, `claude`, `runtime`, `editor`, `ui`

## Propósito
Convertir lo que sale de un paso en un formato fijo (JSON con esquema, Markdown o texto) para que el paso siguiente reciba datos fiables, y no prosa que tiene que interpretar. Resuelve el punto débil del texto libre como único contrato entre nodos.

## Decisiones (05/11/2026)
- Es un nodo propio, `transform`, no un campo del agente: se puede poner detrás de cualquier paso sin tocar el agente y se reutiliza.
- **No ejecuta el paso anterior para «ver» su salida** (costaría tokens, no es determinista y podría escribir archivos). En ejecución usa la salida real que le llega; en el editor, la vista previa usa lo que recibió en la última ejecución o un ejemplo pegado a mano.
- Dos modos, como el router: **reglas** (determinista, sin IA ni tokens) y **con Claude** (un turno sin herramientas).
- Si el resultado no cumple el formato, el modo con Claude reintenta con el error como corrección; el de reglas falla en el acto. Al agotar los intentos, el nodo falla. La salida por conexión de error se deja para cuando exista ese concepto en todos los nodos (M10).
- Los archivos que llegan pasan tal cual; guardar el resultado como archivo de la carpeta se deja para M10.

## Requisitos
### Modelo y validación
- **R37.1** [M8e] Existe el tipo de nodo `transform` con `TransformConfig`: `mode` (`rules` | `ai`), `format` (`json` | `markdown` | `text`), `template?` (reglas), `instructions?` (Claude), `schema?` (texto de un JSON Schema, solo con `json`), `maxAttempts?` (Claude, 1–5, por defecto 2) y `sample?` (ejemplo de entrada para la vista previa; no influye en la ejecución).
- **R37.2** [M8e] La validación da error si falta la configuración (`transform-missing-config`), si el esquema no es JSON o no es un objeto (`transform-bad-schema`), si hay esquema sin formato `json` (`transform-schema-needs-json`), si el modo Claude no tiene instrucciones (`transform-missing-instructions`), si en reglas con formato `markdown` o `text` falta la plantilla (`transform-missing-template`), si `maxAttempts` no es un entero entre 1 y 5 (`transform-bad-attempts`) o si un texto supera 20 000 caracteres (`transform-too-long`).

### Modo reglas
- **R37.3** [M8e] La plantilla admite `{{entrada}}` (texto recibido), `{{archivos}}` (archivos recibidos, uno por línea), `{{json}}` (todo el JSON de la entrada) y `{{json.ruta}}` (campo del JSON que venga en la entrada, con puntos e índices: `{{json.items.0.nombre}}`). Un hueco desconocido o un campo que no existe se queda vacío y se avisa en el evento.
- **R37.4** [M8e] El JSON de la entrada se busca primero en un bloque ```` ```json ````, después en el primer objeto o lista bien formado del texto. Con formato `json` y sin plantilla, el resultado es ese JSON (formateado). Si no hay JSON en la entrada, falla.
- **R37.5** [M8e] Con formato `json`, cada hueco se rellena con el valor codificado en JSON (para que la plantilla siga siendo JSON válido) y el resultado tiene que poder leerse como JSON; con `markdown` o `text` se pone el valor tal cual (objetos y listas, como JSON).

### Modo con Claude
- **R37.6** [M8e] El `Decider` tiene un método opcional `transform({ format, instructions, schema?, input, attempt, previousError? })` que devuelve el texto convertido. El de Claude es un turno sin herramientas que pide solo el resultado; si el formato es `json`, el motor extrae el JSON de la respuesta. Si el motor activo no lo implementa, el nodo falla con un mensaje claro.
- **R37.7** [M8e] Si la respuesta no cumple el formato o el esquema, el motor la vuelve a pedir pasando el error (`previousError`) hasta `maxAttempts` intentos; un error temporal del motor también gasta un intento, con la misma espera creciente que los agentes, y uno definitivo corta en el acto. Al agotarlos, el nodo falla con el último error.
- **R37.8** [M8e] El motor simulado convierte sin tokens: con esquema, genera un ejemplo válido del esquema; sin esquema, el JSON de la entrada o `{"texto": …}`; en Markdown, `# Resultado` y la entrada.

### Esquema
- **R37.9** [M8e] El esquema se comprueba con un subconjunto de JSON Schema: `type` (también lista), `properties`, `required`, `additionalProperties: false`, `items`, `enum`, `const`, `minLength`/`maxLength`, `minimum`/`maximum`, `minItems`/`maxItems`. Las demás palabras se ignoran. Los errores dicen la ruta (`$.items[0].nombre: falta`). Si hay esquema, el resultado se comprueba en los dos modos; en reglas, no cumplirlo hace fallar el nodo.

### Ejecución y eventos
- **R37.10** [M8e] El nodo emite `node.started` con la entrada y el evento nuevo `transform.done` (`nodeId, mode, format, attempts, ok, errors?, warnings?`) antes de `node.finished`. Su salida es `{ text: resultado, files: archivos recibidos }`. Funciona igual dentro de bucles y subdiagramas, y la cancelación lo detiene.

### Editor
- **R37.11** [M8e] La paleta ofrece «Transformar datos» (pulsar o arrastrar), el menú del botón derecho del lienzo «Transformar aquí», el de una conexión «Insertar transformación» y el «+» de una conexión «Transformar · cambia el formato». El nodo nuevo empieza en reglas, formato `json`, sin plantilla.
- **R37.12** [M8e] El panel del nodo tiene Modo, Formato, la plantilla (reglas) o las instrucciones (Claude), el esquema (solo `json`, con aviso en el acto si no es JSON), los intentos (Claude), «Recibe: @…» y una línea de qué hará.
- **R37.13** [M8e] La vista previa del panel aplica las reglas a la entrada que el nodo recibió en la última ejecución o, si no la hay, a la salida del paso anterior en esa ejecución o al ejemplo pegado; muestra el resultado o el error de formato o de esquema sin gastar tokens. En modo Claude explica que la vista previa solo comprueba el esquema con el ejemplo.
- **R37.14** [M8e] La tarjeta del lienzo muestra el icono de transformar y el subtítulo «JSON · por reglas», «Markdown · con Claude», etc.

## Fuera de alcance (retagueado)
- Conexión de salida de error (M10), guardar como archivo (M10), CSV (M10), elegir modelo por nodo (M10).
