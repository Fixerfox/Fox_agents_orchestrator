# SPEC-061 · Bandeja del sistema y avisos de escritorio

**Estado:** Implementada (M12) · **Hito:** M12 · **Paquetes:** `runtime`, `editor`, `ui`, `apps/desktop` · **Rama:** `feature/bandeja-avisos`

## Propósito
El 06/11 el usuario pidió dos cosas. Que al cerrar la ventana la app se quede junto a la hora de Windows (o su equivalente en Linux) en vez de terminar, y que el sistema avise cuando un agente necesita una respuesta o cuando acaba algo. Una ejecución puede durar media hora: hoy cerrar la ventana la corta, y una pregunta se queda esperando sin que nadie lo sepa si la app no está delante.

## Decisiones (06/11/2026)
1. **Desde dónde se avisa.**
   - *Primera:* en el renderer, con la `Notification` del navegador.
   - *Revisión:* el renderer solo recibe los eventos de la ejecución que tiene abierta, así que no vería las demás.
   - *Segunda (elegida):* **en el proceso principal**, con un observador de todas las ejecuciones en `RunService`. Sigue siendo el bus de eventos: solo se añade otro oyente.
2. **Cuándo se avisa.**
   - *Primera:* siempre.
   - *Revisión:* con la app delante, el aviso repite lo que ya se ve y distrae.
   - *Segunda (elegida):* **solo si la ventana no está en primer plano**: oculta, minimizada o con otra app delante.
3. **Qué es «finalización».**
   - *Primera:* cada paso que termina.
   - *Revisión:* un diagrama con veinte pasos daría veinte avisos.
   - *Segunda (elegida):* **el final de la ejecución**, bien o mal. Cancelar no avisa: lo ha hecho el usuario.
4. **Linux sin bandeja.** GNOME sin extensión no enseña iconos de bandeja y Electron no permite detectarlo, así que la ventana podría quedar oculta sin forma de volver.
   - *Primera:* cerrar la app de verdad en GNOME.
   - *Revisión:* Ubuntu sí trae bandeja en GNOME, y la variable de entorno no lo distingue.
   - *Segunda (elegida):* **una sola instancia**: volver a abrir la app muestra la ventana en cualquier sistema, y el primer cierre de cada sesión lo explica con un aviso.
5. **Salir con trabajo en marcha.** Salir corta lo que esté en curso, y desde la bandeja es fácil pulsarlo sin ver la ventana: se pide confirmación si hay ejecuciones en marcha o en cola.
6. **Avisos en Windows sin instalador.**
   - *Primera:* `app.setAppUserModelId(process.execPath)`, lo que recomienda Electron para desarrollo.
   - *Revisión:* probado de verdad, Electron informa de `show` pero Windows no enseña nada, y mirando la pantalla no aparece. Windows descarta en silencio los avisos de una identidad que nadie ha registrado.
   - *Segunda (elegida):* **la app registra su identidad al arrancar**, en la rama del usuario actual: sin permisos de administrador y con nombre e icono propios en el aviso.
7. **Sin ajustes nuevos.** Windows y Linux ya permiten silenciar los avisos de cada app; si hace falta un interruptor propio, se añade después.

## Requisitos
- **R61.1** [M12] Cerrar la ventana la oculta sin terminar la app: las ejecuciones siguen.
- **R61.2** [M12] Hay un icono en la bandeja del sistema. Pulsarlo abre la ventana; su menú ofrece «Abrir Orquestador» y «Salir».
- **R61.3** [M12] «Salir» termina la app. Si hay ejecuciones en marcha o en cola, antes pide confirmación con cuántas son y, si se rechaza, no pasa nada.
- **R61.4** [M12] El primer cierre de cada sesión avisa de que la app sigue abierta y de cómo volver.
- **R61.5** [M12] Si no se puede crear el icono, cerrar la ventana termina la app como antes. Apagar o cerrar la sesión del sistema nunca se queda bloqueado por la ventana oculta.
- **R61.6** [M12] Solo hay una instancia: abrir la app otra vez muestra la ventana existente, aunque esté oculta o minimizada.
- **R61.7** [M12] Toda pregunta a la persona (`agent.question`) da un aviso con quién la hace y su texto recortado. El título cambia según sea una pregunta, un permiso, una confirmación o una revisión.
- **R61.8** [M12] El final de una ejecución da un aviso con el nombre del diagrama: terminada, fallida o sin presupuesto. Cancelar no avisa, ni tampoco los pasos que terminan.
- **R61.9** [M12] `RunService.watch` entrega los eventos de todas las ejecuciones que arranca, sea cual sea la que muestra la interfaz, con su diagrama, y `runningCount` dice cuántas siguen en marcha.
- **R61.10** [M12] Solo se avisa si la ventana no está en primer plano.
- **R61.11** [M12] Pulsar un aviso abre la ventana en esa ejecución: en «En directo» si sigue en marcha y en «Historial» si ha terminado.
- **R61.12** [M12] Abrir una ejecución llega al renderer por `onOpenRun`, un canal de una sola dirección que solo lleva `runId` y si sigue en marcha.
- **R61.13** [M12] La app tiene icono propio en la ventana, la bandeja y los avisos, y la compilación lo deja junto al programa.
- **R61.14** [M12] En Windows, la app registra al arrancar su identidad en el usuario actual, con nombre e icono, porque sin ella el sistema descarta los avisos.

## Escenarios
- **E61.a** *Dada* una ejecución en marcha, *cuando* el usuario cierra la ventana, *entonces* la ejecución sigue, y al terminar llega un aviso que al pulsarlo abre su resumen.
- **E61.b** *Dados* dos agentes en paralelo en dos ejecuciones, *cuando* uno pregunta en la que no está abierta y la app está detrás de otra ventana, *entonces* llega el aviso y lleva a esa ejecución.
- **E61.c** *Dado* un Linux sin bandeja, *cuando* el usuario cierra la ventana y vuelve a lanzar la app, *entonces* reaparece la misma ventana con sus ejecuciones.

## Fuera de alcance
- El asistente: sus turnos no son ejecuciones y no avisan.
- Arrancar con el sistema o arrancar ya minimizada.
- Pulsar un aviso que ya pasó al centro de notificaciones de Windows: solo responden los que siguen en pantalla.
