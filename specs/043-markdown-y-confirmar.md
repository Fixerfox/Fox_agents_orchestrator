# SPEC-043 · Resultados en Markdown y «Confirmar antes de terminar»

**Estado:** Implementada (M8f) · **Hito:** M8f · **Paquetes:** `core`, `claude`, `editor`, `ui`

## Propósito
El usuario pidió (05/11) dos cosas:
1. Ver en Markdown los resultados «y todo»: la salida de cada paso, lo que dicen los agentes, lo que reciben, las preguntas y el resultado final.
2. Que un agente pueda **confirmar antes de terminar**. Al acabar, el agente da un resumen detallado en Markdown de lo que ha hecho y el paso espera. Si el usuario lo aprueba, el flujo sigue; si no, se le piden cambios por el chat del nodo y el agente rectifica.

## Decisiones (05/11/2026)
- Markdown con el componente seguro de R38.2: sin HTML y los enlaces no navegan. Las salidas de herramientas, los registros y los archivos que no son `.md` siguen en monoespaciado, porque ahí importa el texto exacto.
- La confirmación es una opción **por paso de agente** (`DiagramNode.confirm`), apagada por defecto. No va en la ficha del agente: un mismo agente puede confirmar en un diagrama y no en otro, igual que el modelo por paso (SPEC-040).
- Se reutiliza el mecanismo de preguntas (SPEC-018): la confirmación es una `agent.question` marcada con `confirm`. Así el paso queda «Esperando tu respuesta», aparece en «Necesitan tu respuesta», libera su hueco de concurrencia mientras espera y se responde desde el chat del nodo o la bandeja, sin canales nuevos.
- «Aprobar» es el botón. Cualquier otro texto es una petición de cambios y el agente vuelve a trabajar con todo su contexto: la entrada original, su entrega anterior y lo que se pide. No hay límite de vueltas: el usuario aprueba cuando quiere o cancela la ejecución.
- El resumen que se confirma es la salida del agente, y esa misma salida es la que pasa al siguiente paso. Con la opción activa, el prompt exige terminar con «## Resumen para confirmar».

## Requisitos
- **R43.1** [M8f] La salida de cada paso, el texto que va diciendo el agente, lo que recibió, las preguntas y el resultado final se dibujan en Markdown en el panel del nodo, en su ventana grande, en Resultados y en la bandeja «Necesitan tu respuesta». La vista previa de un archivo `.md` en Resultados también se ve en Markdown. Las salidas de herramientas siguen en monoespaciado.
- **R43.2** [M8f] Un nodo `agent` puede tener `confirm: true`. En otro tipo de nodo es el problema de validación `node-confirm-not-agent`. `updateNode(…, { confirm })` lo pone con `true` y lo quita con `false`, y solo vale en nodos `agent` (si no, falla con `invalid`).
- **R43.3** [M8f] El panel de un paso de agente tiene la casilla «Confirmar antes de terminar», con su explicación. En el lienzo, la tarjeta del paso lo indica («· confirma»).
- **R43.4** [M8f] Con `confirm`, el orquestador pasa `confirm: true` al motor (`AgentRequest.confirm`) y lo registra en `agent.request`. El motor de Claude añade al prompt de sistema la regla de terminar con una sección «## Resumen para confirmar» detallada en Markdown: qué ha hecho y por qué, archivos creados, modificados o borrados, comandos, decisiones tomadas y lo que queda pendiente o conviene revisar.
- **R43.5** [M8f] Cuando un paso con `confirm` termina bien, no se cierra: emite `agent.question` con `confirm: { round }`, el texto de su salida y la opción «Aprobar», y queda esperando la respuesta (`waiting_input`). Mientras espera, libera su hueco de concurrencia.
- **R43.6** [M8f] Si la respuesta es «Aprobar» (sin distinguir mayúsculas y sin espacios alrededor), se emite `confirm.decided` con `verdict: 'approved'` y el paso termina con esa salida.
- **R43.7** [M8f] Cualquier otra respuesta emite `confirm.decided` con `verdict: 'changes'` y el texto, y el agente vuelve a ejecutarse con una entrada compuesta. Esa entrada lleva la original, la sección «## Cambios pedidos antes de confirmar (vuelta N)» con «### Tu entrega anterior» y «### Lo que pide el usuario», y los archivos de la entrada original y de la entrega anterior. La petición se suma a las respuestas previas. Al terminar, vuelve a pedir confirmación con `round` + 1. Si la ejecución se cancela mientras espera, el paso queda cancelado.
- **R43.8** [M8f] En el chat del nodo y en su ventana grande, una confirmación se ve como la tarjeta «Revisa lo que ha hecho antes de seguir», con el resumen en Markdown, el botón «Aprobar» y el campo «Pedir cambios» con «Enviar cambios». Ya respondida, dice «Aprobado» o «Pediste cambios: …». En la bandeja «Necesitan tu respuesta» la tarjeta dice «Confirmar lo que ha hecho <paso>».
- **R43.9** [M8f] `transcriptItems` marca la pregunta de confirmación (`confirm: { round }`) y `deriveLive` la deja en `pending` con esa marca, para que la interfaz la distinga de una pregunta normal.

## Fuera de alcance
- Confirmar con un diff de los archivos (depende de R31.7, M6f).
- Limitar el número de vueltas de rectificación o aprobar automáticamente pasado un tiempo.
- Activar la confirmación desde la ficha del agente para todos sus pasos.
