# 04 · Catálogo de eventos

Todos los eventos comparten cabecera:
```ts
interface EventBase { runId: Id; seq: number; ts: string; type: string; nodePath?: Id[] }  // nodePath: ruta de subdiagramas anidados
```

| Evento | Payload | Cuándo |
|---|---|---|
| `run.started` | `diagramId, resumedFrom?, deliverable?` | Inicio de la ejecución; `deliverable` es el entregable efectivo (SPEC-046) |
| `run.finished` | `status` | Fin (éxito, fallo o cancelación) |
| `run.paused` / `run.resumed` | `nodeId?` | Pausa/reanudación global o de un nodo |
| `run.budget_reached` | `limit, used` | Se alcanza el límite de presupuesto y se detiene la ejecución |
| `run.cancelled` | `reason?` | Cancelación solicitada |
| `node.queued` | `nodeId` | Nodo listo y en cola |
| `node.started` | `nodeId` | El agente empieza |
| `node.finished` | `nodeId, status, output?` | El agente termina |
| `token.stream` | `nodeId, text` | Salida en streaming (por lotes) |
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
| `supervisor.alert` | `nodeId?, rule, severity, detail` | El Supervisor detecta algo o bloquea una acción (SPEC-060) |
| `supervisor.started` | `review, model?` | El Supervisor empieza a vigilar la ejecución (SPEC-060) |
| `supervisor.reviewing` | `nodeId` | Empieza a revisar un paso con IA (SPEC-060) |
| `supervisor.note` | `nodeId, text, files, reviewed?` | Entrada de la memoria de la ejecución (SPEC-060) |
| `supervisor.skipped` | `count, reason: 'timeout' \| 'failed'` | Revisiones que no se pudieron hacer (SPEC-060) |
| `node.retrying` | `nodeId, attempt, max, delayMs, message` | Reintento automático tras error temporal |
| `workspace.merged` | `nodeId, files` | Cambios de un agente fusionados en el proyecto |
| `workspace.conflict` | `nodeIds, files` | Conflicto entre agentes paralelos; requiere atención |
| `iteration.snapshot` | `loopId, n, path` | Instantánea de resultados de una vuelta de bucle |
| `subdiagram.started` | `nodeId, templateId, version` | Se entra en un nodo compuesto |
| `subdiagram.finished` | `nodeId, status` | Se sale del nodo compuesto con su resultado |
| `knowledge.used` | `nodeId, attempt, kind, id, via, required` | Una skill, contexto o MCP se incluyó en el prompt (`inline`), se leyó (`read`) o se usó con una herramienta (`tool`); solo ids, nunca contenido (SPEC-036) |
| `knowledge.unmet` | `nodeId, attempt, kind, id` | Un obligatorio no se usó en ese intento; el intento falla y se reintenta con aviso (SPEC-036) |
| `agent.request` | `nodeId, agentId, attempt, input, task?, model?, confirm?, deliverable?, extra?, snapshot?, previousAnswers?` | Lo que recibe exactamente el agente en cada intento y la configuración usada |
| `decision` | `nodeId, kind: route\|condition\|judge, request, response` | Decisión de IA fuera de los agentes de trabajo |
| `transform.done` | `nodeId, mode: rules\|ai, format: json\|markdown\|text, attempts, ok, errors?, warnings?` | Resultado del nodo «Transformar» (SPEC-037), antes de su `node.finished` |
| `agent.question` | `nodeId, questionId, text, options?, confirm?: { round }, kind?: 'question' \| 'permission' \| 'gate'` | El agente pregunta al usuario; el nodo pasa a `waiting_input`. Con `confirm` es la confirmación del paso (SPEC-043); `kind` dice si es una pregunta del agente, un permiso de la app o la supervisión de R39.4 (SPEC-045) |
| `agent.answer` | `nodeId, questionId, text` | El usuario responde desde el chat del nodo |
| `confirm.decided` | `nodeId, round, verdict: approved\|changes, text?` | Respuesta a «Confirmar antes de terminar» (SPEC-043); con `changes` el agente vuelve a trabajar |
| `deliverable.done` | `nodeId, ok, fileName, markdown, json?, links?, items[]` | Entregable compuesto por la Salida del nivel principal (SPEC-046), antes de su `node.finished`; `store` lo guarda en `output/<fileName>.md` |
| `error` | `nodeId?, message, retriable` | Error |

## Garantías
- `seq` es estrictamente creciente por `runId`.
- `run.started` es siempre el primero y `run.finished` el último.
- Todo `node.started` termina con un `node.finished`.

## Ruta tomada
La **ruta de una ejecución** se reconstruye a partir de `node.started`, `route.decided`, `edge.traversed` y `loop.iteration`. La UI la pinta en vivo y el replay la reproduce con los mismos eventos.

## Trazabilidad (logs)
El log de una ejecución **es** esta secuencia de eventos. Antes de entrar se ocultan claves y secretos (`[REDACTED]`). `transcriptOf` devuelve la conversación completa de un agente y `reduceRunState` reconstruye estado y ruta. Ver SPEC-008.
