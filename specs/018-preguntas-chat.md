# SPEC-018 · Preguntas de los agentes y chat en el nodo

**Estado:** M1 implementado; M4 y M6 pendientes · **Hito:** M1 (motor) / M4 (UI) / M6 (adapter Claude) · **Paquete:** `core`, `ui`, `adapters`

## Propósito
Cuando un agente tiene dudas puede **hacer una petición al usuario**. El nodo queda en espera y el usuario responde haciendo clic en él y **chateando con ese agente**. El resto de nodos independientes sigue ejecutándose.

## Requisitos
- **R18.1** [M1] Un agente puede preguntar al usuario con `request.ask({ text, options? })`, que devuelve la respuesta como texto.
- **R18.2** [M1] Al preguntar se emite `agent.question` (`nodeId`, `questionId`, `text`, `options?`) y el nodo pasa a `waiting_input` en el estado reconstruido; los nodos independientes siguen ejecutándose.
- **R18.3** [M1] `answer(questionId, text)` entrega la respuesta, emite `agent.answer` y el agente continúa; devuelve `true`. Responder una pregunta inexistente o ya respondida devuelve `false` y no tiene efecto.
- **R18.4** [M1] Mientras espera, el agente libera su hueco de concurrencia, no consume presupuesto y no tiene límite de tiempo, salvo que se configure `questionTimeoutMs`; si vence, el nodo falla con un `error`.
- **R18.5** [M1] Un agente puede hacer varias preguntas seguidas (conversación); cada una tiene un `questionId` único dentro de la ejecución.
- **R18.6** [M1] Cancelar mientras se espera una respuesta libera la espera: el nodo termina `cancelled` y la ejecución `cancelled`.
- **R18.7** [M1] Una respuesta recibida durante una pausa se registra de inmediato; el agente continúa al reanudar.
- **R18.8** [M1] `pendingQuestions()` lista las preguntas sin responder (`questionId`, `nodeId`, `nodePath`, `text`, `options?`) para que la UI pueda reconectarse.
- **R18.9** [M1] Preguntas y respuestas quedan en el log (con redacción de secretos), en la transcripción del agente y en `reduceRunState`.
- **R18.10** [M1] Las preguntas funcionan igual dentro de bucles y subdiagramas, con el `nodePath` correcto.
- **R18.11** [M1] Si un intento falla y se reintenta, el nuevo intento recibe `previousAnswers` con las preguntas ya respondidas para no repetirlas.
- **R18.12** [M4] Al hacer clic en un nodo, su panel muestra el chat: las preguntas del agente, las respuestas del usuario y una caja para responder; las `options` se ofrecen como botones.
- **R18.13** [M4] Un nodo con pregunta pendiente se resalta en el diagrama; hay un contador global de preguntas pendientes.
- **R18.17** [M4b] Notificación de escritorio cuando un agente hace una pregunta (hecha en SPEC-061).
- **R18.14** [M4] Al reabrir la app o recargar la vista, las preguntas pendientes reaparecen (`pendingQuestions()`).
- **R18.15** [M6] El adapter de Claude traduce la herramienta de preguntas del SDK a `ask`.
- **R18.16** [M7] *(Futuro)* Mensajes iniciados por el usuario a un agente en curso, no solo respuestas.

## Escenarios
- **E18.a** *Dado* un agente «Diseñador» que pregunta «¿Estilo pixel art o vectorial?» con opciones, *cuando* el usuario hace clic en el nodo y elige «pixel art», *entonces* el agente continúa con esa respuesta y el log contiene pregunta y respuesta.
- **E18.b** *Dados* dos agentes en paralelo y uno de ellos esperando respuesta, *entonces* el otro termina sin esperar.
