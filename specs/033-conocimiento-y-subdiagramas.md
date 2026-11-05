# SPEC-033 · Conocimiento por paso y diagramas dentro de diagramas

**Estado:** Implementado (M8a) · **Hito:** M8a · **Paquetes:** `core`, `claude`, `runtime`, `editor`, `ui`, `desktop`

## Propósito
Que un agente pueda usar algo solo en un diagrama o en un paso concreto, sin añadírselo para siempre, y que un diagrama se pueda usar como un solo paso de otro (ejecutable también por separado), recogiendo su salida.

## Requisitos
### Conocimiento añadido
- **R33.1** [M8a] Un nodo agente y un diagrama pueden llevar conocimiento añadido (`extra`): listas de ids de skills, contextos y servidores MCP del proyecto. El del diagrama lo reciben todos sus agentes (también dentro de sus bucles); el del nodo, solo ese paso. Añadir o quitar es un paso de deshacer y no cambia la definición del agente.
- **R33.2** [M8a] La validación rechaza (`bad-extra`) un conocimiento añadido que no sea un objeto con `skillIds`, `contextIds` o `mcpIds` como listas de hasta 50 ids válidos.
- **R33.3** [M8a] Al ejecutar un paso, el agente recibe lo suyo más lo del diagrama raíz y lo del paso, sin repetir (`mergeExtra`). El adaptador de Claude carga esas skills y contextos como si fueran del agente.
- **R33.4** [M8a] El evento `agent.request` dice qué vino del diagrama y qué del paso (`extra.diagram`, `extra.node`), para el registro técnico.
- **R33.5** [M8a] En el panel de un paso, «Solo en este paso» muestra lo añadido con fichas (discontinuas) que se quitan y botones «+ Skill», «+ Contexto» (y «+ MCP» cuando haya) que abren el selector.
- **R33.6** [M8a] Sin nada seleccionado, el panel derecho no se ve (cambio del 05/11 a petición del usuario). «Ajustes del diagrama», en la cabecera del Diseñador, o el botón de mostrar el panel lo abren con el diagrama: su nombre y «Para todos sus agentes» con el mismo editor; se cierra con su ✕, con el mismo botón o al seleccionar algo.

### Conectores en el lienzo
- **R33.10** [M8a] Cada paso de agente tiene dos conectores más: arriba, skills y contextos; abajo, MCP. Lo añadido a ese paso se dibuja como fichas enchufadas a su conector con línea discontinua (se mueven con el paso y no son nodos del diagrama), cada una con × para quitarla; el «+» junto al conector abre el selector de ese tipo solo para ese paso. La tarjeta del paso solo muestra lo que trae el agente.
- **R33.11** [M8a] El panel izquierdo tiene tres secciones plegables por separado, «Skills», «Contextos» y «MCP»: se arrastran y, al soltarlos sobre un paso de agente, se añaden solo a ese paso; soltados fuera de un agente, avisa.

### Diagramas dentro de diagramas
- **R33.7** [M8a] Un nodo `subdiagram` apunta a otro diagrama del proyecto (`templateId` = id del diagrama, versión `latest`): recibe lo que le llega, ejecuta ese diagrama entero y su Salida es la salida del paso. El motor real lo resuelve leyendo el diagrama guardado.
- **R33.8** [M8a] El panel izquierdo tiene una sección plegable «Diagramas» con los del proyecto (el abierto marcado): un clic lo abre, el botón derecho ofrece Abrir, Renombrar (si es el abierto), Duplicar y Eliminar, y se puede arrastrar al lienzo de otro para añadirlo como subdiagrama. No se puede meter un diagrama dentro de sí mismo; las referencias circulares más profundas las detecta la ejecución.
- **R33.9** [M8a] El panel de un subdiagrama dice qué diagrama usa, qué recibe y que siempre usa su última versión guardada, con «Abrir el diagrama» (también en su menú contextual). Se ejecuta por separado abriéndolo y pulsando Ejecutar.
