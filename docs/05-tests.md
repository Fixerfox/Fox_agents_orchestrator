# 05 · Estrategia de tests

> Regla del proyecto: ninguna funcionalidad está terminada sin tests que pasen. Los tests nacen de las specs (`specs/`): cada test cita el requisito que verifica y `npm run spec:check` comprueba la cobertura del hito en curso.

**Estado M1+M2:** 108 tests, 99 requisitos cubiertos, estables en 5 ejecuciones consecutivas. Las pruebas de `store` usan carpetas temporales reales y se han verificado con mutaciones (romper la limpieza atómica o la protección de ejecuciones en curso hace fallar el test correspondiente).

| Nivel | Herramienta | Qué cubre |
|---|---|---|
| Unitario | Vitest | Validación de grafo (DAG), orquestación, bus de eventos, scheduler, migraciones de esquema |
| Integración | Vitest + SQLite en memoria | Store, replay de ejecuciones |
| Contrato | Vitest | Todo `AgentAdapter` debe pasar la misma batería (`adapterContract`) |
| E2E | Playwright (Electron) | Crear diagrama, ejecutar con `MockAgent`, ver estado en vivo, guardar/reabrir |

## MockAgent
Adapter determinista que emite una secuencia de eventos configurable (latencia, fallos, streaming). Permite probar UI y orquestador sin red ni coste.

## Casos mínimos del MVP
- Rechaza ciclos en el grafo.
- Ejecuta nodos en orden topológico y en paralelo cuando son independientes.
- Fallo de un nodo → descendientes `skipped`, independientes continúan.
- Cancelar un run emite `run.cancelled` y detiene los adapters.
- `seq` sin huecos ni duplicados; replay reproduce el mismo estado final.
- Guardar → cerrar → reabrir conserva el diagrama.

## Casos añadidos
- Bucle `count` ejecuta N vueltas; bucle `ai-judge` termina por veredicto y siempre por `maxIterations`.
- Router `ai` y `rules` emiten `route.decided` y `edge.traversed` correctos (uno o varios destinos).
- Pausa/reanudación no pierde ni duplica eventos; cancelar durante la pausa funciona.
- Límite de presupuesto detiene la ejecución con `run.budget_reached`.
- Resolución global/proyecto: el proyecto sobrescribe y no modifica el global.
- Importador: no ejecuta nada antes de aprobar; los MCP quedan desactivados.
- Ruta reconstruida desde eventos == ruta pintada en vivo (replay).
- Rutas y permisos funcionan en Windows y Linux.
- Reintentos: un error temporal reintenta 3 veces con espera creciente y emite un evento por intento; el límite de concurrencia nunca se supera.
- Versionado: fijar versión en un proyecto no se ve afectado por cambios globales posteriores.
- La clave API nunca aparece en diagramas, logs ni eventos.
- Agentes paralelos editan archivos distintos → fusión limpia; mismo archivo → `workspace.conflict` sin perder ninguna versión.
- Cada iteración de un bucle genera su instantánea y se puede recuperar una anterior.
- Subdiagrama: se ejecuta como un solo nodo (una entrada, una salida) y sus eventos llevan `nodePath` correcto.
- Se rechaza una plantilla que se contiene a sí misma (directa o indirecta) y la profundidad mayor al máximo.
- Se rechaza una plantilla sin exactamente un `entry` y un `output` al usarla como nodo.
- El presupuesto y la concurrencia del padre se aplican a los agentes del subdiagrama.
- Una plantilla global no puede referenciar elementos de proyecto.
- Fijar versión de una plantilla en un proyecto no se ve afectado por ediciones posteriores.
- La ruta anidada se reconstruye igual en vivo y en replay.
