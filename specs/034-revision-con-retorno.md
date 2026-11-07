# SPEC-034 · Revisión con retorno (bucle condicional dibujado)

**Estado:** Implementada (M8b) · **Hito:** M8b · **Paquetes:** `core`, `editor`, `ui`

## Propósito
Que un paso de control de calidad pueda **rechazar** el trabajo y **devolverlo** al paso que lo hizo, con las correcciones, sin meter los pasos en una caja de bucle: se dibuja una flecha hacia atrás. Siempre hay un **tope de vueltas** y una salida cuando se agota, así que nunca hay bucles infinitos.

Ejemplo: Entrada → diseñador → qa-diseñador → **Revisión** —✓ Aprobado→ Salida; —✗ Rechazado→ (vuelve a) diseñador; —⏱ Agotado→ Salida.

## Decisiones de diseño
- **Nodo nuevo `review` («Revisión»)** con tres salidas fijas (puertos): `approved` (✓ Aprobado), `rejected` (✗ Rechazado) y `exhausted` (⏱ Agotado). El `router` sigue igual para repartir entre varias rutas; la revisión es el «sí / no».
- **Conexión de retorno:** la que sale de ✗ Rechazado hacia un nodo **anterior** (desde el que se llega a la revisión). Es el único ciclo permitido en un nivel; el resto de ciclos siguen prohibidos (SPEC-001). Si ✗ va hacia delante, es una rama normal.
- **El tramo que se repite** (de destino del retorno a la revisión) debe tener **una sola entrada y una sola salida**: así el motor puede volver a ejecutarlo como un bucle sin mezclar resultados viejos y nuevos. El bucle contenedor (SPEC-005) sigue existiendo.
- **Decisión barata:** el revisor termina con `VEREDICTO: APROBADO` o `VEREDICTO: RECHAZADO`; la revisión lo lee sin llamar a la IA. Solo si no lo encuentra (o si se elige «Lo decide Claude») se usa el evaluador (`decider.judge`).
- **Contexto en la vuelta siguiente:** el destino recibe su entrada original, su entrega anterior, las correcciones de esta vuelta, un resumen corto de las anteriores y «Vuelta n de N». No el historial entero.
- **Colores (excepción a SPEC-021, aprobada por el usuario el 05/11/2026):** las salidas de la revisión usan colores con significado, apagados: verde (`--pos`) Aprobado, rojo (`--neg`) Rechazado, gris (`--muted`) Agotado. El color solo refuerza: cada salida lleva además símbolo y texto, y el retorno se dibuja **discontinuo y por debajo**. El acento ámbar sigue siendo el único color de selección y de ruta recorrida.

## Requisitos

### Modelo y validación (`core`)
- **R34.1** [M8b] Existe el tipo de nodo `review` con `review: { maxRounds, mode, criteria? }`: `maxRounds` entero de 1 a 10, `mode` `'verdict'` (lee el veredicto del texto) o `'ai'` (siempre la IA), `criteria` texto opcional para la IA. Las aristas que salen de una revisión llevan `port`: `'approved' | 'rejected' | 'exhausted'`.
- **R34.2** [M8b] Validación de la revisión: sin configuración → `review-missing-config`; `maxRounds` fuera de 1..10 → `review-invalid-max`; arista de salida sin puerto → `review-edge-no-port`; dos aristas en el mismo puerto → `review-duplicate-port`; sin ✓ Aprobado conectado → aviso `review-no-approved`; una arista con `port` que no sale de una revisión → `edge-port-not-review`.
- **R34.3** [M8b] Una arista `rejected` cuyo destino llega a la revisión por aristas hacia delante es un **retorno** (`returnEdges`). Los retornos no cuentan como ciclo; cualquier otro ciclo sigue dando `cycle`.
- **R34.4** [M8b] El tramo de un retorno son los nodos que están en algún camino del destino a la revisión. Si al tramo entra alguna arista que no va al destino, o sale alguna que no parte de la revisión → `review-return-shape`.
- **R34.5** [M8b] Una revisión con retorno necesita ⏱ Agotado conectado → si no, `review-no-exhausted`. Dos tramos que se solapan sin que uno contenga al otro → `review-return-crossed`.

### Ejecución (`core`)
- **R34.6** [M8b] Modo `verdict`: se usa el **último** `VEREDICTO: APROBADO|RECHAZADO` (también `VERDICT: APPROVED|REJECTED`, sin distinguir mayúsculas) de la entrada. Si no aparece, y siempre en modo `ai`, decide el Juez (R34.26) y se emite `decision` (`kind: 'judge'`); `done` = aprobado.
- **R34.26** [M12] El Juez es una pieza interna, fija y no editable: no es un nodo ni aparece en Agentes, y su prompt solo cambia con esta spec. Es una consulta de un solo turno, sin herramientas, siempre con Haiku 5.5 (`Decider.judgeReview`). Lo que juzga va como datos, no como instrucciones. Con un motor que no lo tenga, se usa `decider.judge` con el criterio por defecto.
- **R34.27** [M12] El Juez es práctico: rechaza solo por fallos importantes que se pueden corregir en esta vuelta o por algo pedido que no se hizo. No rechaza por mejoras menores, por lo que el revisor no pudo comprobar, por lo que depende de una decisión del usuario ni por preguntas finales. Si aprueba con algo pendiente, lo dice en su motivo. El `criteria` del nodo se le añade como criterio del diagrama.
- **R34.28** [M12] Lo que gasta el Juez sale como `agent.usage` con `source: 'judge'`: cuenta en el total de la ejecución sin disparar su límite.
- **R34.7** [M8b] Aprobado: el flujo sigue solo por ✓; la salida de la revisión es su entrada (como el router).
- **R34.8** [M8b] Rechazado con retorno y vuelta < `maxRounds`: se recorre el retorno, todo el tramo vuelve a estar pendiente y el destino se ejecuta otra vez; ✓ y ⏱ no se resuelven todavía.
- **R34.9** [M8b] Rechazado en la vuelta `maxRounds`: el flujo sale por ⏱ Agotado con la última entrega.
- **R34.10** [M8b] Rechazado con ✗ hacia delante: sigue por ✗ como una rama normal. Rechazado sin ✗ conectado: la revisión falla con un `error`.
- **R34.11** [M8b] En la vuelta *n* ≥ 2 el destino recibe un texto con: su entrada original de la vuelta 1, «Revisión · vuelta n de N», «Tu entrega anterior» (su última salida), «Correcciones pedidas» (lo que recibió la revisión) y, si hay más de una vuelta previa, «Correcciones de vueltas anteriores» recortadas a 600 caracteres cada una. Los archivos son la unión de los tres.
- **R34.12** [M8b] Cada decisión emite `review.decided` (`nodeId`, `round`, `max`, `verdict: 'approved' | 'rejected' | 'exhausted'`, `source: 'verdict' | 'ai'`, `reason?`, `returnTo?`).
- **R34.13** [M8b] Revisiones anidadas: cuando un retorno exterior repite su tramo, las revisiones de dentro empiezan de nuevo su cuenta y su entrada original.
- **R34.14** [M8b] Cancelar durante una vuelta detiene la ejecución sin más vueltas; el presupuesto se sigue aplicando en cada vuelta.

### Editor (`editor`)
- **R34.15** [M8b] `addNode({ kind: 'review' })` crea «Revisión» con `maxRounds: 3` y `mode: 'verdict'`; `updateNode` admite `review` (solo en revisiones; `maxRounds` se limita a 1..10).
- **R34.16** [M8b] `connect(from, to, port?)`: desde una revisión el puerto es obligatorio y no se puede repetir (`port-required`, `port-taken`); desde otro nodo no se admite puerto. Cerrar un ciclo solo se permite desde ✗ Rechazado (retorno); los retornos existentes no cuentan al buscar ciclos.
- **R34.17** [M8b] Insertar un paso en una conexión que sale de una revisión conserva el puerto en el tramo que sale de ella. Los retornos no tienen «+».
- **R34.18** [M8b] `deriveLive` guarda por revisión la última decisión (`reviews`: vuelta, máximo y veredicto) y la lista de revisiones que acabaron por ⏱ Agotado (`exhausted`).
- **R34.19** [M8b] Los códigos de R34.2–R34.5 tienen mensaje en español; `review-no-approved` es un aviso (diagrama a medio montar).

### Lienzo e inspector (`ui`)
- **R34.20** [M8b] La tarjeta de la revisión tiene tres salidas a la derecha, cada una con símbolo y texto (de arriba abajo ✓ Aprobado, ⏱ Agotado y ✗ Rechazado, para que el retorno salga por abajo sin cruzar las otras) y nombre accesible; arrastrar desde una salida crea la conexión con ese puerto. El subtítulo dice el modo y «máx. N vueltas».
- **R34.21** [M8b] Las conexiones que salen de una revisión llevan la clase de su puerto (`orq-edge--approved|rejected|exhausted`); el retorno se dibuja discontinuo, por debajo de los nodos, con la etiqueta «↺ máx. N» y sin «+». Un nodo destino de un retorno no cuenta el retorno en «Espera a N».
- **R34.22** [M8b] Paleta, buscador del «+» y menú del lienzo ofrecen «Revisión».
- **R34.23** [M8b] El inspector de una revisión permite cambiar «Vueltas como máximo», el modo («Veredicto del revisor» / «Lo decide Claude») y el criterio, y explica qué tiene que escribir el revisor y qué verá Claude.
- **R34.25** [M8b] Hay una plantilla «Crear y revisar con QA» (creador → qa → Revisión, ✗ vuelve al creador, máx. 3) con tareas que piden el veredicto, válida y lista para ejecutar.
- **R34.24** [M8b] En directo, la tarjeta muestra «Vuelta n/N · Aprobado|Rechazado|Agotado»; en Resultados, si alguna revisión salió por ⏱ Agotado se avisa «Salió por el límite de vueltas en <nodo>».

## Escenarios
- **E33.a** *Dado* diseñador → qa → Revisión (máx. 3) con ✗ volviendo a diseñador, *cuando* el QA dice `VEREDICTO: RECHAZADO` y luego `VEREDICTO: APROBADO`, *entonces* el diseñador se ejecuta 2 veces, la segunda con «Tu entrega anterior» y las correcciones, y el flujo sale por ✓.
- **E33.b** *Dado* lo mismo y un QA que siempre rechaza, *entonces* hay 3 vueltas y el flujo sale por ⏱ Agotado con la última entrega.
- **E33.c** *Dado* un retorno que salta a una rama paralela (el diseñador también va directo a Salida), *entonces* la validación da `review-return-shape`.

## Revisión crítica (dos pasadas)
1. *Primera pasada:* un ciclo libre rompería la ejecución por niveles (un nodo espera a todas sus entradas, y la del retorno nunca llegaría). → El retorno se excluye de las entradas pendientes y el motor reinicia el tramo; por eso se exige una sola entrada y una sola salida. El editor dejaba de detectar ciclos falsos si se recorrían retornos existentes → se excluyen.
2. *Segunda pasada:* en anidados, la «entrada original» debe ser la de la vuelta exterior actual, no la primera de todas → se guarda por revisión y se borra al reiniciar el tramo exterior. «Espera a 2» en el destino sería falso → el retorno no cuenta. Un revisor que no escribe veredicto no debe bloquear → se usa la IA como respaldo.
