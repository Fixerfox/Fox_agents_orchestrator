# SPEC-077 · Gobierno de recursos: concurrencia global, presupuesto, pausa y métricas

**Estado:** Implementada · **Hito:** M15h · **Paquetes:** `core`, `claude`, `runtime`, `store`, `apps/desktop`, `editor`, `ui` · **Rama:** `feature/robustez-ejecucion`

## Propósito
Los controles de recursos de hoy son de cada ejecución y reaccionan tarde (auditoría del 08/11, P5, P6, P8, P9, P10 y P12):
- **Concurrencia.** Cada ejecución tiene su límite de 4 agentes, pero no hay un límite total: tres ejecuciones a la vez son 12 agentes contra la misma cuenta. Las decisiones no pasan por ningún límite.
- **Límites de uso compartidos.** Si una ejecución recibe un 429, las demás siguen lanzando consultas hasta que también lo reciben.
- **Presupuesto.** Se mira al llegar `agent.usage`, al final de cada turno, así que las ramas en paralelo pueden pasarse bastante antes de que se corte. Al alcanzarlo se cancela todo de golpe, también lo que estaba a punto de acabar. No hay límite por paso.
- **Pausa.** Se espera entre eventos del stream. El proceso de Claude sigue trabajando, y gastando, hasta que su búfer se llena.
- **Registro.** Cada `token.stream` es un evento y un `writeSync`. El bus los guarda todos en memoria.
- **Métricas.** No hay duración por paso, tasa de reintentos ni coste por agente o modelo, aunque todo está en los eventos.

## Decisiones (08/11/2026)
1. **Límite total.**
   - *Primera:* bajar el límite de cada ejecución.
   - *Revisión:* penaliza a quien lanza una sola ejecución grande.
   - *Segunda (elegida):* **dos límites**: el de cada ejecución (4, como hoy) y uno de toda la app (8 por defecto), en `runtime`. Un paso necesita hueco en los dos. Las decisiones tienen su propio límite global, más pequeño, porque son cortas.
2. **Límite de uso.** Cuando el motor recibe un 429 o un 529 con `retry-after`, **todas las ejecuciones** dejan de arrancar consultas nuevas con ese proveedor hasta que pase ese tiempo. Lo que ya está en marcha sigue.
3. **Presupuesto.**
   - *Primera:* estimar lo que costará cada paso y reservarlo antes de arrancarlo.
   - *Revisión:* el coste de un paso de agente varía de 0,01 a varios dólares. Cualquier estimación sería ruido.
   - *Segunda (elegida):* **umbrales**. Aviso al 80 %. Desde el 90 % no arranca ningún paso de agente nuevo. Al 100 % se hace lo que diga la ejecución: parar ya (como hoy) o dejar terminar lo que está en marcha. Además, cada paso y cada agente pueden tener su propio tope, que aplica el SDK (`maxBudgetUsd`).
4. **Pausa.**
   - *Primera:* interrumpir la consulta del SDK (`interrupt()`) y reanudarla después.
   - *Revisión:* no está probado cómo se comporta al reanudar, y una interrupción a mitad de una edición puede dejar un archivo a medias.
   - *Segunda (elegida):* **pausar en la siguiente herramienta**. El gancho de permisos (`canUseTool`), por el que pasa cada herramienta, espera mientras la ejecución esté en pausa. El agente puede terminar de escribir texto, pero no hace nada más. La interfaz lo dice tal cual.
5. **Tokens en el registro.** Se agrupan antes de entrar en el bus. La interfaz sigue viéndolos fluir y el registro tiene muchos menos eventos.

## Requisitos
### Concurrencia
- **R77.1** [M15h] `runtime` tiene un `GlobalLimiter` compartido por todas las ejecuciones: `maxAgentsTotal` (8 por defecto, en Ajustes › Ejecución, entre 1 y 32) para pasos de agente y `maxDecisionsTotal` (4) para decisiones, revisiones del Supervisor y comprobaciones con IA. Un paso de agente necesita hueco en su ejecución (R23.6) y cada intento, en el global (puerto `SharedResources` de `core`; `AppResources`, uno por app, en `runtime`). Las decisiones pasan por el suyo desde el decisor del motor.
- **R77.2** [M15h] El hueco global también se suelta mientras el paso espera a la persona (como `whileWaiting`, R63.9). Los pasos esperan en orden de llegada entre todas las ejecuciones.
- **R77.3** [M15h] Mientras un paso espera hueco global, su nodo sale como «En cola (8 agentes trabajando en toda la app)» (`node.queued` con `others`).

### Límites de uso compartidos
- **R77.4** [M15h] Un error `rate_limit` u `overloaded` con `retryAfterMs` (R71.1) abre un enfriamiento del proveedor: hasta que pase, ningún intento ni decisión nuevo de ninguna ejecución arranca con ese proveedor. Se emite `provider.cooldown` (`provider`, `untilTs`, `reason`) en las ejecuciones afectadas.
- **R77.5** [M15h] Mientras dura el enfriamiento, las ejecuciones afectadas lo enseñan en su barra: «Claude ha pedido esperar; sigue a las 10:42».

### Presupuesto
- **R77.6** [M15h] Al pasar del 80 % del presupuesto de la ejecución (tokens o coste) se emite una vez `run.budget_warning` (`limit`, `used`, `max`) y llega un aviso del sistema.
- **R77.7** [M15h] Desde el 90 % no arranca ningún paso de agente nuevo: los que estaban listos quedan `waiting_input` con la pregunta «Queda menos del 10 % del presupuesto», con las opciones «Seguir hasta el límite», «Subir el límite a…» y «Parar la ejecución». El `fallback` (R70.13) es «Parar la ejecución».
- **R77.8** [M15h] `RunOptions.onBudget` es `'stop-now'` (por defecto, como R7.4) o `'finish-running'`. Con `'finish-running'`, al llegar al 100 % no arranca nada nuevo, lo que está en marcha termina, y la ejecución acaba `failed` con `reason: 'budget_exceeded'`.
- **R77.9** [M15h] Un paso (`limits.maxCostUsd`, en el inspector) y una ficha de agente (`limits.maxCostUsd`, en «Avanzado» de la ficha) pueden tener tope propio, que se pasa al SDK como `maxBudgetUsd` en cada intento. Al pasarse, el intento falla con `kind: 'fatal'` y el mensaje «El paso llegó a su presupuesto de N $» (no se reintenta).
- **R77.10** [M15h] Regla `burn-rate` (`warning`): un paso gasta más de 1 $ por minuto durante 3 minutos seguidos (configurable en Ajustes › Supervisor).
- **R77.11** [M15h] Lo que gasta el verificador (R75.14) y la integración de conflictos (R73.15) cuenta en el presupuesto. Lo del Supervisor sigue sin dispararlo (R60.14).

### Pausa
- **R77.12** [M15h] Con la ejecución en pausa, el gancho de permisos del adaptador espera, antes de decidir, a que se reanude: ninguna herramienta nueva empieza durante la pausa. Lo que ya estaba en marcha termina.
- **R77.13** [M15h] Al pausar, los pasos de agente en marcha salen como «Pausando: termina lo que está haciendo», y como «En pausa» cuando su siguiente herramienta queda retenida o acaba el turno (`node.paused`, una vez por pausa).
- **R77.14** [M15h] La pausa sigue deteniendo los relojes de SPEC-070.

### Registro
- **R77.15** [M15h] El motor junta los `token.stream` seguidos de un mismo paso en un solo evento cada 250 ms o cada 2.000 caracteres, lo que llegue antes. Cualquier otro evento de ese paso cierra el grupo antes de emitirse, para que el orden se mantenga.
- **R77.16** [M15h] Con R77.15, el caso de referencia «lineal» de las grabaciones de SPEC-056, con 200 fragmentos de texto por agente, tiene al menos 10 veces menos eventos `token.stream`, con el mismo texto concatenado (hay test). Las grabaciones no cambian: el orquestador solo junta si se lo pide la app.

### Métricas
- **R77.17** [M15h] `runMetrics(events)` (pura, en `core`) da por paso: duración trabajando, duración esperando a la persona, en cola, intentos y su motivo, tokens y coste; y por ejecución: totales, coste por agente y por modelo, y lo que gastó el Supervisor aparte.
- **R77.18** [M15h] El Resumen de la ejecución tiene la pestaña «Rendimiento» con esas métricas: un cronograma de los pasos (trabajando, esperando, en cola) y una tabla por agente, que se puede exportar a CSV.
- **R77.19** [M15h] La pantalla de Ejecuciones puede ordenar y filtrar por coste, duración y reintentos (más de 1 $, más de 10 min, con reintentos). La meta de cada ejecución guarda sus reintentos.

## Escenarios
- **E77.a** *Dado* tres ejecuciones de 4 ramas con el límite global en 8, *entonces* trabajan como mucho 8 agentes a la vez y los demás esperan en orden de llegada.
- **E77.b** *Dado* un 429 con `retry-after: 30` en una ejecución, *entonces* durante 30 s ninguna otra ejecución lanza consultas a Claude.
- **E77.c** *Dado* un presupuesto de 5 $ y 4,60 $ gastados, *entonces* el siguiente paso no arranca y la persona decide si sube el límite.
- **E77.d** *Dado* que se pausa mientras un agente está editando, *entonces* la edición termina y la siguiente herramienta espera a reanudar.
- **E77.e** *Dado* un paso con `maxCostUsd: 1` que llega a 1 $, *entonces* falla sin reintentar y lo dice.

## Cambia
- **R7.2:** la pausa retiene la siguiente herramienta del agente, no solo los eventos (R77.12).
- **R7.4:** hay aviso al 80 %, freno al 90 % y la opción de terminar lo que está en marcha (R77.6–R77.8).
- **R23.6:** al límite de cada ejecución se suma el global (R77.1).

## Fuera de alcance
- Exportar trazas a OpenTelemetry: las métricas de R77.17 salen de los eventos y se pueden exportar más adelante.
- Interrumpir de verdad el turno del modelo (`interrupt()`): primero hay que probarlo con el SDK real.
- Prioridades entre ejecuciones.
