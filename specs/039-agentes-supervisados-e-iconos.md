# SPEC-039 · Agentes que preguntan antes de actuar, avisos en el diagrama e iconos de agente

**Estado:** Implementada (M8f) · **Hito:** M8f · **Paquetes:** `core`, `claude`, `editor`, `ui`

## Propósito
Poder exigir que un agente consulte antes de implementar o de decidir, verlo en el diagrama de un vistazo, ver dónde hay un agente esperando tu respuesta y distinguir a los agentes por su icono.

## Decisiones (05/11/2026)
1. *Primera:* solo una regla en el prompt. *Revisión:* el modelo puede saltársela (ya pasó con R27.13). *Segunda (elegida):* tres capas en el motor real: (a) regla en el prompt; (b) la política de herramientas **deniega escribir, editar y ejecutar comandos hasta que el agente haya preguntado y tenga respuesta** en ese intento; (c) si termina sin haber preguntado, la app pregunta por él antes de seguir («¿Doy por bueno el resultado?»), y si no, el paso se repite con tus indicaciones. Así ninguna decisión pasa sin tu visto bueno, aunque el agente no implemente nada.
2. Es una propiedad del agente (`askFirst`), no del paso: el usuario quiere exigirlo «a un agente». Se ve en todos los pasos que lo usan.
3. Semáforo amarillo para «pregunta antes de actuar» y mano levantada para «te está preguntando ahora»: dos símbolos distintos para «modo» y «estado».
4. Iconos: un catálogo fijo de iconos y de tonos (no imágenes libres): se guardan como ids, valen en tema claro y oscuro y no rompen el acento único (el tono solo tiñe el icono, sin fondos llamativos).

## Requisitos
### Preguntar antes de actuar
- **R39.1** [M8f] Un agente tiene `askFirst` («Pregunta antes de actuar», opcional, booleano). Se valida, viaja por el contrato y se guarda con el agente.
- **R39.2** [M8f] La ficha del agente tiene el interruptor «Preguntar siempre antes de implementar o decidir» con su explicación; el asistente lo puede poner con `create_agent` y `update_agent` (`askFirst`).
- **R39.3** [M8f] Con el motor Claude y `askFirst`, el prompt de sistema exige presentar el plan y las decisiones con la herramienta de preguntas y esperar el visto bueno, y la política de herramientas deniega `Write`, `Edit`, `MultiEdit`, `NotebookEdit` y `Bash` hasta que en ese intento se haya respondido al menos una pregunta del agente; el motivo de la denegación le dice que pregunte primero.
- **R39.4** [M8f] Si un agente con `askFirst` termina sin haber preguntado, antes de pasar su resultado al siguiente paso la app pregunta en el chat del nodo ««Agente» ha terminado sin consultarte. ¿Doy por bueno su resultado?» con «Dar por bueno» y «Que lo rehaga». Cualquier respuesta distinta de «Dar por bueno» repite el paso, y la respuesta le llega como indicación.

### Avisos en el diagrama
- **R39.5** [M8f] En el lienzo, un paso cuyo agente tiene `askFirst` muestra un semáforo amarillo (con texto accesible «Pregunta antes de actuar»), también en el panel «Tus agentes» de la paleta y en la lista de Agentes.
- **R39.6** [M8f] Cuando un agente está esperando tu respuesta, su paso muestra una mano levantada («Te está preguntando») en el lienzo de la ejecución (en el del Diseñador ya no, R52.8); el diagrama con preguntas pendientes lleva la mano en la paleta del Diseñador y en la sección Diagramas, y el rail la muestra en «Diseñador» si el diagrama abierto espera respuesta.

### Iconos de agente
- **R39.7** [M8f] Un agente tiene `icon` y `tone` opcionales, elegidos de catálogos fijos (`AGENT_ICONS`, 24 iconos; `AGENT_TONES`, 7 tonos). Un id desconocido se rechaza al guardar.
- **R39.8** [M8f] La ficha del agente tiene «Icono»: una cuadrícula con los iconos y los tonos y una vista previa; sin elegir, se usa la inicial como hasta ahora.
- **R39.9** [M8f] El icono del agente se ve en su paso del lienzo, en la paleta, en la lista y la portada de Agentes y en el selector de agentes. Los agentes de Spec Kit traen su icono.

### Diseño de la ficha del agente y del panel del paso
- **R39.10** [M8f] La ficha del agente se ordena en tres bloques numerados: «Quién es» (nombre y para qué sirve), «Cómo trabaja» (instrucciones, con más alto) y «Lo que sabe y usa» (skills, contextos y MCP en tres columnas, que se apilan en pantallas estrechas). El lateral empieza con «Así se ve»: el icono, el nombre y la descripción como se verán, el modelo, cuántas skills, contextos y MCP tiene, la marca «Pregunta antes de actuar» y «Cambiar icono», que despliega los iconos y los tonos; siguen «Supervisión», «Modelo», «Dónde se usa» y «Avanzado».
- **R39.11** [M8f] El panel de un paso de agente agrupa en tarjetas «Tarea del paso» (tarea, lo que recibe y la ayuda), «Quién lo hace» (icono, nombre, descripción, modelo, «Pregunta antes de actuar» y Cambiar/Editar), «Conocimiento» (lo del agente y lo añadido solo a ese paso) y «Archivos»; el nombre del paso va más grande arriba.

### Conocimiento obligatorio del agente
- **R39.12** [M8f] Un agente puede marcar como obligatorias algunas de sus skills, contextos o MCP (`required`, subconjunto de lo que tiene asignado). Con el motor Claude se tratan como lo obligatorio de SPEC-036 en todos sus pasos: la skill va entera en el prompt («Skills obligatorias») y lo que no cabe se comprueba. Los agentes de Spec Kit traen su skill principal como obligatoria (el Implementador, «Spec Kit · Implementar»), para que no dependa de que el agente decida leerla.
- **R39.13** [M8f] En la ficha del agente cada skill, contexto y MCP asignado tiene el interruptor «Obligatoria»; quitar algo del agente lo quita también de lo obligatorio.

