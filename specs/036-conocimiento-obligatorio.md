# SPEC-036 · Conocimiento obligatorio y registro de uso

**Estado:** Implementada (M9a) · **Hito:** M9a · **Paquetes:** `core`, `claude`, `runtime`, `editor`, `ui`
**Amplía:** SPEC-033 (conocimiento por paso y por diagrama), SPEC-027 (adaptador de Claude), SPEC-030 (MCP por agente).

## Propósito
Hoy una skill, un contexto de archivo o URL, o un MCP añadido a un paso solo se **ofrece** al agente (ruta o nombre en el prompt) y él decide si lo usa; no hay forma de exigirlo ni de saber si lo usó. Esta spec permite marcar **cada asignación** como obligatoria, garantiza (o verifica) que se use y deja constancia de ello. La marca vive en la ficha enchufada al paso o al diagrama, no en la skill, el contexto o el MCP: el mismo elemento puede ser opcional en un paso y obligatorio en otro.

## Decisiones
- **Obligatoria = por asignación.** `KnowledgeExtra` gana `required`, un subconjunto de las listas existentes. Cubre skills, contextos y MCP.
- **Dos mecanismos:**
  - *Incluido:* skills y contextos de archivo o texto obligatorios van enteros en el prompt (determinista, no depende de que el agente lea).
  - *Verificado:* lo que no se puede o no cabe incluir (URL, MCP, o lo que supere el tope) se marca «OBLIGATORIO» en el prompt y, al acabar el intento, se comprueba que el agente lo usó. Si no, el intento falla de forma recuperable y el siguiente recuerda qué faltó.
- **Línea de la ficha:** las obligatorias se dibujan con línea continua y color propio (`--req`, azul apagado) más símbolo y texto; las opcionales siguen discontinuas en ámbar. El color nuevo es una excepción a «un solo acento» (como en SPEC-034), aprobada por el usuario.
- **Enchufado a un paso = obligatorio (05/11, petición del usuario):** una skill o un MCP enchufado a un paso (conectores del lienzo o «Solo en este paso») es **siempre** obligatorio; no hay interruptor. Se calcula al ejecutar (no se guarda en `required`), así que vale también para los diagramas ya guardados. Los contextos del paso y todo lo del diagrama entero siguen con el interruptor.
- **Fuera de alcance (v1):** marcar como obligatorio lo que trae el propio agente (pantalla Agentes); modo «avisar sin fallar»; obligar herramientas del SDK que no sean MCP.

## Requisitos
### Modelo y validación
- **R36.1** [M9a] `KnowledgeExtra` admite `required?: { skillIds?: Id[]; contextIds?: Id[]; mcpIds?: Id[] }`. Sin `required`, todo es opcional como hasta ahora (los diagramas guardados siguen válidos).
- **R36.2** [M9a] La validación rechaza (`bad-extra`) un `required` que no sea un objeto de listas, con más de 50 ids, o con algún id que no esté en la lista correspondiente (`skillIds`, `contextIds`, `mcpIds`) del mismo `extra`.
- **R36.3** [M9a] `mergeExtra` une también `required`: lo obligatorio en cualquiera de las partes (diagrama o paso) lo es en el resultado, aunque en otra parte esté como opcional.
- **R36.4** [M9a] Quitar una ficha del paso o del diagrama la quita también de `required`. Marcar o desmarcar es un paso de deshacer y no cambia la definición del agente ni la de la skill, contexto o MCP.

- **R36.21** [M9a] Toda skill y todo MCP del conocimiento de un paso (`node.extra.skillIds`, `node.extra.mcpIds`) es obligatorio, esté o no en `required`: `stepExtra` lo añade a `required` antes de `mergeExtra`, y así llega a `AgentRequest.extra` y a `agent.request` (`extra.node`). Se aplica igual dentro de bucles, revisiones y subdiagramas. Los contextos del paso y lo del diagrama no cambian (R36.1). Nada de esto se escribe en el diagrama guardado.

### Entrega al agente (`packages/claude`)
- **R36.5** [M9a] Una skill obligatoria va **entera** en el prompt de sistema, en un bloque «Skills obligatorias: síguelas en esta tarea» con su nombre y su contenido; los archivos de `referencias/` no se incluyen y siguen por ruta. Las opcionales no cambian.
- **R36.6** [M9a] Un contexto obligatorio de tipo texto se entrega bajo «Contexto obligatorio»; uno de tipo archivo del proyecto se incluye con su contenido (texto). Un archivo que no sea texto, no se pueda leer o esté fuera de la carpeta cuenta como «verificado» (R36.8). Un contexto de texto va siempre en el prompt (también el opcional, como hasta ahora) y, si es obligatorio, gasta del tope de R36.7.
- **R36.7** [M9a] Lo incluido (R36.5 y R36.6) comparte un tope de 30 000 caracteres por intento. Lo que no quepa pasa a «verificado» y el prompt lo dice con su ruta. Se reparte en este orden: contextos de texto, skills y contextos de archivo.
- **R36.8** [M9a] Lo «verificado» (URL, MCP, archivos no incluibles, lo que supere el tope) aparece en el prompt como «OBLIGATORIO: úsalo antes de responder» con la ruta, la URL o el nombre del servidor.
- **R36.9** [M9a] La ruta que se da al agente se puede leer desde su directorio actual: si la carpeta de trabajo no es la raíz del proyecto, la ruta de la skill o del contexto de archivo se entrega absoluta.

### Detección de uso y verificación
- **R36.10** [M9a] Se cuenta como uso: una llamada `Read`, `Grep` o `Glob` cuya ruta (normalizadas las `\` y sin distinguir mayúsculas) esté dentro de la carpeta de la skill o sea el archivo del contexto; un `WebFetch` o `WebSearch` a esa URL (sin barra final ni fragmento); cualquier herramienta `mcp__<servidor>__*` de ese MCP. Lo incluido cuenta como usado sin comprobar nada.
- **R36.11** [M9a] Al terminar un intento con éxito, si falta algún obligatorio «verificado», el intento falla con un error **recuperable** (`required-not-used`) que nombra lo que faltó. El reintento (SPEC-007) añade al mensaje de usuario «En el intento anterior no usaste: … (obligatorio)». Agotados los intentos, el nodo termina en error con ese mensaje; no se da por buena una salida incompleta.
- **R36.12** [M9a] Lo opcional se registra pero nunca se verifica ni hace fallar un paso.
- **R36.20** [M9a] Si algo obligatorio ya no existe en el proyecto (skill, contexto o MCP borrado) o es un MCP apagado, el intento falla **sin reintento** con un mensaje que lo nombra: reintentar no lo arregla.

### Eventos y registro
- **R36.13** [M9a] Evento nuevo `knowledge.used` `{ nodeId, kind: 'skill'|'context'|'mcp', id, via: 'inline'|'read'|'tool', required }`, una vez por elemento y intento. Evento nuevo `knowledge.unmet` `{ nodeId, kind, id, attempt }` por cada obligatorio que faltó. Ambos entran en `docs/04-eventos.md` y en el visor de logs.
- **R36.14** [M9a] `agent.request` indica qué elementos llegaron como obligatorios (`extra.required`, además de lo de R33.4); con qué mecanismo se entregó o usó cada uno lo dice `knowledge.used` (`via`). Los eventos solo llevan ids, nunca el contenido incluido; los secretos siguen ocultos (SPEC-008).

### Avisos
- **R36.15** [M9a] Un paso con conocimiento añadido (`extra`) y sin tarea da un aviso ámbar del **editor** (no de la validación del motor): no impide ejecutar. Vale también dentro de bucles. No distingue entre obligatorios y opcionales.

### Interfaz
- **R36.16** [M9a] Cada ficha de conocimiento (en el lienzo, en «Solo en este paso» y en «Para todos sus agentes») tiene un interruptor «Obligatoria» (clic en la ficha o botón del panel). Una obligatoria muestra el símbolo de candado y el texto «Obligatoria» (también en el tooltip y en la etiqueta accesible).
- **R36.17** [M9a] En el lienzo, la línea que une la ficha con el conector del paso es continua y de color `--req` si es obligatoria, y discontinua ámbar si no. Nunca se distingue solo por el color. Las fichas del diagrama entero se dibujan igual en el panel.
- **R36.18** [M9a] En el lienzo, en vivo y al ver una ejecución, cada ficha del paso muestra el estado del último intento: «Incluida», «Usada», «Falta» (`--neg`) o «No usada» (solo cuando el paso ya terminó), siempre con texto. Cada intento empieza de cero.
- **R36.22** [M9a] En el lienzo y en «Solo en este paso», una skill o un MCP del paso se muestra siempre como obligatorio (candado, texto «Obligatoria», línea continua `--req`) y sin botón para desmarcarlo; el tooltip dice «Obligatoria: está enchufada a este paso». Un contexto del paso y las fichas de «Para todos sus agentes» conservan el interruptor de R36.16.
- **R36.19** [M9a] Dentro del mismo diagrama, un elemento obligatorio en el diagrama y opcional en el paso se muestra como obligatorio con la nota «Por el diagrama» y no se puede desmarcar desde el paso.

## Revisión crítica
**Primera versión (descartada).** Una opción «Cómo se entrega» en la skill (`on-demand | inline`) guardada junto a su `SKILL.md`. Problemas: afecta a todos los usos de la skill (el caso real es «en este paso sí»), no cubre MCP ni contextos, y obliga a un archivo extra fuera del formato nativo de Claude Code.

**Segunda versión (esta, revisada al implementarla).** La marca va en la asignación. Riesgos revisados:
- *Coste de tokens:* una skill de 50 000 caracteres incluida entera pesa ~12 000 tokens por intento. Mitigado con el tope común de R36.7 y degradación a «verificado».
- *Falsos «no usado»:* un agente puede leer la skill con `Bash cat`. Se acepta como límite conocido; el error es recuperable y el mensaje del reintento lo explica. Si molesta, se amplía R36.10 en otra spec.
- *Reintentos por una obligación:* los intentos son 3 con espera creciente; un MCP caído haría fallar 3 veces. Aceptado: el error nombra el elemento y el usuario puede desmarcarlo.
- *Ruta ilegible:* `engine.ts` obtiene `workFolder` y `projectRoot` por separado, así que pueden diferir y la ruta relativa `.orquestador/skills/…` no resolverse; R36.9 lo cubre y lo prueba.
- *Avisos que bloquean:* cualquier incidencia de `validateDiagram` impide ejecutar (motor, servicio y botón Ejecutar), así que el aviso de «sin tarea» (R36.15) vive en el editor y no en la validación del motor.
- *Elemento borrado o MCP apagado:* sin R36.20 habría tres reintentos inútiles.
- *Contexto de texto grande:* no se puede «verificar» (no hay nada que leer), así que va siempre en el prompt y solo gasta del tope.
- *Color:* excepción a un solo acento, con símbolo y texto siempre (R36.16, R36.17).

**Tercera revisión (R36.21–R36.22, petición del usuario: «lo enchufado se usa por obligación»).**
- *Guardar o calcular:* guardar `required` al enchufar dejaría fuera los diagramas existentes y un `required` editado a mano podría desmarcarlo; se calcula en el motor (`stepExtra`) y en la vista con la misma función.
- *Coste:* una skill enchufada se incluye entera (R36.5) en cada intento; el tope de R36.7 la pasa a «verificada» si es grande.
- *MCP apagado o borrado:* el paso falla sin reintento (R36.20) en vez de seguir sin él. Es lo que pide «obligatorio»; el mensaje nombra el MCP.
- *Alcance:* el usuario pidió skills y MCP; los contextos del paso siguen opcionales salvo que se marquen.

## Tests previstos
- `core`: `[R36.1]`–`[R36.4]` (validación, `mergeExtra`, quitar ficha), `[R36.15]` aviso.
- `claude`: `[R36.5]`–`[R36.9]` prompt (incluido, tope, verificado, ruta con carpeta distinta), `[R36.10]`–`[R36.12]` detección y reintento con un `QueryFn` falso que ignora, usa o falla.
- `core` + `runtime`: `[R36.13]`, `[R36.14]` eventos y registro sin contenido incluido.
- `ui`: `[R36.16]`–`[R36.19]` interruptor, línea y estados, con jsdom.
- MockAgent: opción para «ignorar lo obligatorio» y así probar el reintento sin gastar tokens.
