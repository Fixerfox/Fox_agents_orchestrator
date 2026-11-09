# 04 · Catálogo de eventos

Todos los eventos comparten cabecera:
```ts
interface EventBase { runId: Id; seq: number; ts: string; type: string; nodePath?: Id[] }  // nodePath: ruta de subdiagramas anidados
```

| Evento | Payload | Cuándo |
|---|---|---|
| `run.started` | `diagramId, resumedFrom?, deliverable?` | Inicio de la ejecución; `deliverable` es el entregable efectivo (SPEC-046) |
| `run.finished` | `status` | Fin (éxito, fallo o cancelación) |
| `run.accepted` | `by, reason, previousReason?` | La persona (o el asistente, con su permiso) dio por buena una ejecución fallida; se añade después de `run.finished` (SPEC-065) |
| `run.paused` / `run.resumed` | `nodeId?` | Pausa/reanudación global o de un nodo |
| `run.budget_reached` | `limit, used` | Se alcanza el límite de presupuesto y se detiene la ejecución |
| `run.cancelled` | `reason?` | Cancelación solicitada |
| `node.queued` | `nodeId, others?` | Nodo listo y en cola; con `others`, un paso ya empezado espera hueco en toda la app (agentes trabajando, SPEC-077) |
| `node.started` | `nodeId` | El agente empieza |
| `node.finished` | `nodeId, status, output?` | El agente termina |
| `token.stream` | `nodeId, text` | Salida en streaming (por lotes) (la app junta los seguidos de un paso cada 250 ms o 2.000 caracteres, SPEC-077) |
| `tool.called` | `nodeId, tool, input` | El agente invoca una herramienta |
| `tool.result` | `nodeId, tool, ok, output?` | Resultado de la herramienta |
| `agent.usage` | `nodeId, inputTokens, outputTokens, costUsd?` | Consumo |
| `route.decided` | `fromNodeId, chosen: nodeId[], mode: 'ai'\|'rules', reason` | Un nodo de enrutado elige destinos |
| `edge.traversed` | `edgeId, fromNodeId, toNodeId, input?` | Se recorre una conexión (para resaltar la ruta); `input` es la parte enviada si el origen reparte (SPEC-059) |
| `split.rejected` | `nodeId, attempt, problems` | El paso no repartió bien su trabajo y se repite (SPEC-059) |
| `loop.iteration` | `loopId, n, max, verdict?, reason?` | Cada vuelta de un bucle y veredicto del evaluador |
| `permission.requested` | `nodeId, action, detail` | Una acción pide confirmación en la UI |
| `permission.resolved` | `nodeId, allowed` | El usuario responde |
| `file.produced` | `nodeId, path, change?: 'created' \| 'modified'` | Un agente crea o modifica un archivo; se emite al terminar la herramienta que lo escribió, también si luego el paso falla (SPEC-045) |
| `git.branch` | `nodeId, branch, via: 'head' \| 'command' \| 'mcp' \| 'ran', created?` | El paso creó una rama o actuó en ella (SPEC-058) |
| `git.action` | `nodeId, branch, action: 'commit' \| 'push' \| 'pr' \| 'merge' \| 'delete' \| 'switch', url?` | El paso hizo eso en esa rama; `url` es la de la PR (SPEC-058) |
| `supervisor.alert` | `nodeId?, rule, severity, detail, gravity?, evidence?` | El Supervisor detecta algo o bloquea una acción (SPEC-060); `instructions-changed` si un paso toca `CLAUDE.md`, `AGENTS.md` o `.claude/` (SPEC-076); `burn-rate` si gasta más de N $ por minuto durante 3 minutos (SPEC-077); `gravity` y `evidence`, la gravedad y la evidencia de la revisión con IA (SPEC-075) |
| `agent.usage` (`source?`) | `source: 'supervisor' \| 'judge' \| 'decision'` | Gasto de una pieza interna: suma al total, no al paso (SPEC-060, SPEC-034). `decision` (router, condiciones, evaluador de bucles) también cuenta en el presupuesto (SPEC-063) |
| `supervisor.started` | `review, model?` | El Supervisor empieza a vigilar la ejecución (SPEC-060) |
| `supervisor.reviewing` | `nodeId` | Empieza a revisar un paso con IA (SPEC-060) |
| `supervisor.note` | `nodeId, text, files, reviewed?, decided?` | Entrada de la memoria de la ejecución (SPEC-060); `decided`, hasta 3 decisiones que el paso tomó por su cuenta (SPEC-072) |
| `workspace.opened` | `regionId, branchNodeIds, strategy: 'git' \| 'copy', warning?` | Una rama en paralelo empieza a trabajar en su propio espacio; sin la ruta (SPEC-073) |
| `workspace.merged` | `nodeId, files, regionId?, branchNodeIds?, mergedByLines?` | Lo de una rama llegó al destino; `nodeId`, lo que junta las ramas (SPEC-013, SPEC-073) |
| `workspace.conflict` | `nodeIds, files, regionId?, branchNodeIds?, savedTo?` | Dos ramas cambiaron las mismas líneas; se pregunta a la persona (SPEC-073) |
| `workspace.resolved` | `regionId, nodeIds, files, choice: 'target' \| 'branch' \| 'agent'` | El conflicto quedó resuelto (SPEC-073) |
| `workspace.discarded` | `regionId, branchNodeIds, files` | Una rama que falló no se fusiona; lo cambiado queda en `discarded/` (SPEC-073) |
| `check.result` | `nodeId, checkId, label, kind, ok, detail, durationMs` | Resultado de una comprobación determinista del paso o de la ejecución (SPEC-075) |
| `verify.result` | `nodeId, met, findings[{severity, where, what}]` | Lo que encontró el agente verificador (SPEC-075) |
| `memory.note` | `nodeId, text` | La nota «Notas para los siguientes pasos» que dejó un agente, ya separada de su salida (SPEC-072) |
| `supervisor.feedback` | `alertSeq, verdict: 'false-alarm' \| 'confirmed', note?, nodeId?` | La persona dice si un aviso era cierto; un falso aviso sale de «Avisos abiertos» de la memoria (SPEC-072, SPEC-075) |
| `run.budget_warning` | `limit, used, max` | Se pasó del 80 % del presupuesto; una vez por límite (SPEC-077) |
| `run.budget_raised` | `limit, max` | La persona subió el límite al llegar al 90 % (SPEC-077) |
| `provider.cooldown` | `provider, untilTs, reason: 'rate_limit' \| 'overloaded', nodeId?` | El proveedor pidió esperar: ninguna ejecución arranca nada nuevo con él hasta `untilTs` (SPEC-077) |
| `node.paused` | `nodeId, tool?` | Con la ejecución en pausa, el paso quedó retenido antes de `tool` o al acabar su turno; una vez por pausa (SPEC-077) |
| `memory.proposed` | `proposals[{id, action: add\|update\|archive, entryId?, kind, scope, title, text, reason?, origin}], usage?` | Lo que la ejecución propone recordar; va después de `run.finished` y nada se guarda solo (SPEC-076) |
| `memory.decided` | `proposalId, decision: 'save' \| 'discard', entryId?, edited?, by?` | La persona guardó (o editó y guardó) o descartó una propuesta (SPEC-076) |
| `supervisor.skipped` | `count, reason: 'timeout' \| 'failed'` | Revisiones que no se pudieron hacer (SPEC-060) |
| `supervisor.verified` | `met, detail, forPerson?` | Comprobó si el resultado final cumple lo pedido (SPEC-062); `forPerson`: lo que queda para una persona (SPEC-065) |
| `node.retrying` | `nodeId, attempt, max, delayMs, message, kind?, cause?` | Reintento automático tras error temporal; `kind`, el tipo del error si no es uno temporal normal, y `cause`, `timeout` o `loop` si lo cortó el motor (SPEC-071) |
| `node.timeout` | `nodeId, attempt, kind: idle\|tool\|total\|loop, minutes, tool?` | El motor cortó el intento por inactividad, por su duración o por repetir la misma acción (SPEC-070) |
| `files.restored` | `nodeId, attempt, restored, removed, failed` | Lo que tocó un intento fallido, devuelto al punto de partida antes de reintentar (SPEC-071) |
| `question.reminder` | `nodeId, questionId, text, minutes` | Recordatorio de una pregunta que sigue sin respuesta (SPEC-070) |
| `iteration.snapshot` | `loopId, n, path` | Instantánea de resultados de una vuelta de bucle |
| `subdiagram.started` | `nodeId, templateId, version` | Se entra en un nodo compuesto |
| `subdiagram.finished` | `nodeId, status` | Se sale del nodo compuesto con su resultado |
| `knowledge.used` | `nodeId, attempt, kind, id, via, required` | Una skill, contexto o MCP se incluyó en el prompt (`inline`), se leyó (`read`) o se usó con una herramienta (`tool`); solo ids, nunca contenido (SPEC-036) |
| `knowledge.unmet` | `nodeId, attempt, kind, id` | Un obligatorio no se usó en ese intento; el intento falla y se reintenta con aviso (SPEC-036) |
| `agent.request` | `nodeId, agentId, attempt, input, task?, model?, confirm?, deliverable?, extra?, snapshot?, previousAnswers?, previousAttempt?, memory?, memoryStats?, projectMemory?` | Lo que recibe exactamente el agente en cada intento y la configuración usada; `previousAttempt`, lo que se le contó del intento anterior (SPEC-071); `memory` y `memoryStats`, la memoria que recibió y sus tokens por bloque y lo recortado (SPEC-072); `projectMemory`, los ids de las entradas de la memoria del proyecto que recibió (SPEC-076) |
| `node.reused` | `nodeId, fromRunId, costUsd?` | El paso no se ejecuta: se reutiliza su salida de la ejecución anterior; `costUsd`, lo que costó allí (SPEC-041, SPEC-074) |
| `decision` | `nodeId, kind: route\|condition\|judge, request, response, reused?` | Decisión de IA fuera de los agentes de trabajo; `reused`, tomada de la ejecución que se reanuda (SPEC-074) |
| `transform.done` | `nodeId, mode: rules\|ai, format: json\|markdown\|text, attempts, ok, errors?, warnings?` | Resultado del nodo «Transformar» (SPEC-037), antes de su `node.finished` |
| `agent.question` | `nodeId, questionId, text, options?, confirm?: { round }, kind?: 'question' \| 'permission' \| 'gate' \| 'unfinished'` | El agente pregunta al usuario; el nodo pasa a `waiting_input`. Con `confirm` es la confirmación del paso (SPEC-043); `kind` dice si es una pregunta del agente, un permiso de la app la supervisión de R39.4 (SPEC-045) o un paso sin terminar (SPEC-062) |
| `agent.answer` | `nodeId, questionId, text, auto?, reused?` | El usuario responde desde el chat del nodo; `auto`: nadie respondió y se tomó la respuesta segura (SPEC-070); `reused`: la misma pregunta ya se respondió en la ejecución que se reanuda (SPEC-074) |
| `confirm.decided` | `nodeId, round, verdict: approved\|changes, text?` | Respuesta a «Confirmar antes de terminar» (SPEC-043); con `changes` el agente vuelve a trabajar |
| `deliverable.done` | `nodeId, ok, fileName, markdown, json?, links?, items[]` | Entregable compuesto por la Salida del nivel principal (SPEC-046), antes de su `node.finished`; `store` lo guarda en `output/<fileName>.md` |
| `error` | `nodeId?, message, retriable` | Error |

## Garantías
- `seq` es estrictamente creciente por `runId`.
- `run.started` es siempre el primero y `run.finished` el último. La única excepción es `run.accepted`, que se añade al registro de una ejecución ya cerrada (SPEC-065).
- Todo `node.started` termina con un `node.finished`.

## Ruta tomada
La **ruta de una ejecución** se reconstruye a partir de `node.started`, `route.decided`, `edge.traversed` y `loop.iteration`. La UI la pinta en vivo y el replay la reproduce con los mismos eventos.

## Trazabilidad (logs)
El log de una ejecución **es** esta secuencia de eventos. Antes de entrar se ocultan claves y secretos (`[REDACTED]`). `transcriptOf` devuelve la conversación completa de un agente y `reduceRunState` reconstruye estado y ruta. Ver SPEC-008.

> **Claves de paso (SPEC-074).** Cada evento de un paso pertenece a una pasada: `ruta/nodo#pasada`, contando los `node.started` de la misma ruta (`stepKeysOf`). No se guarda en los eventos.
