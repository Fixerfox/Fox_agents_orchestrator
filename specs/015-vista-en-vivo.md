# SPEC-015 · Vista de ejecución en vivo

**Estado:** Borrador · **Hito:** M4 · **Paquete:** `ui`

## Requisitos
- **R15.1** [M4] El diagrama marca en vivo el estado de cada nodo (en cola, ejecutando, correcto, fallido, omitido, cancelado) y resalta la **ruta tomada** (aristas recorridas y decisiones de enrutado).
- **R15.2** [M4] Al seleccionar un nodo, un panel lateral muestra su transcripción en directo: entrada recibida, configuración usada, texto en streaming, herramientas con sus resultados, uso de tokens/coste y salida.
- **R15.3** [M4] Controles de pausar, reanudar y cancelar; el estado «pausando» es visible mientras se completa el paso en curso.
- **R15.4** [M4b] Los nodos compuestos se ven colapsados con un resumen (estado y agente activo interno) y se abren con doble clic para ver el interior en directo, con migas de pan.
- **R15.5** [M4] Los bucles muestran la vuelta actual y el veredicto del evaluador.
- **R15.6** [M6] Las solicitudes de permiso aparecen como confirmaciones que bloquean solo al agente afectado.
- **R15.7** [M4] El streaming se agrupa por lotes (~50 ms) para no saturar el renderer; el log guarda el texto sin pérdida.
- **R15.8** [M4] Al abrir una ejecución en curso, la UI pide el estado y se suscribe desde `seq+1` sin perder ni duplicar eventos.
- **R15.9** [M4] Se muestran en vivo el coste/tokens acumulados y el presupuesto restante.
- **R15.10** [M7] El replay reproduce una ejecución pasada a partir de su `events.jsonl`, con control de velocidad.
- **R15.11** [M4] El chat con el agente (SPEC-018) se abre desde el panel del nodo y las preguntas pendientes se señalan en el diagrama.
- **R15.12** [M6d] Con doble clic en un nodo que no es un bucle y que ya tiene actividad se abre una ventana grande con su entrada, su resultado y el paso a paso, el estado y el consumo, y un botón para copiar el resultado. El panel lateral ofrece «Ver en grande» para abrirla sin ratón. Se cierra con Escape, con el botón o pulsando fuera; las preguntas pendientes se contestan desde ella.
- **R15.13** [M6d] La salida de una herramienta se muestra plegada con su número de líneas, tanto en la ventana como en el panel lateral, y el texto largo se parte en vez de desbordar.
- **R15.14** [M8f] Si un nodo se ejecuta más de una vez en la misma ejecución (retorno de una revisión), su transcripción se separa por pasadas: cada pasada a partir de la segunda empieza con un encabezado «Pasada N», con «· devuelto por <revisión>: <motivo>» cuando la devolvió una revisión, y la entrada dice «Recibió (pasada N, intento M)». Con una sola pasada se ve como hasta ahora («Recibió (intento M)»). El panel lateral y la ventana grande (R15.12) usan la misma transcripción.
- **R15.15** [M12] Lo que llega durante una ejecución no hace parpadear el lienzo: cada nodo conserva su medida, y el que no ha cambiado no se vuelve a pintar.
- **R15.16** [M12] El diagrama de una ejecución no se vacía mientras se abre: si llega más tarde qué diagrama es, lo que ya se ve sigue ahí.

