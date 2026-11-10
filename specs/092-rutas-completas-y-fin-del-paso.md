# SPEC-092 · Rutas completas y fin del paso

**Estado:** Implementada · **Hito:** M17b · **Paquetes:** `claude` · **Rama:** `fix/rutas-y-fin-de-paso`

## Propósito
Una ejecución real en FoxPixels (10/11/2026) se quedó colgada:
1. **El agente buscó por todo el disco.** El planificador tenía la skill obligatoria `speckit-plan`, que dice «lee la plantilla de `referencias/`, junto a este SKILL.md». Como cabía en el presupuesto, la app la pegó entera en el prompt (R36.5), pero **sin decir de qué carpeta venía**. El agente no tenía forma de saber dónde estaba «junto a este SKILL.md» y lanzó `find / -name plan-template.md`. Ese `find` estuvo dos minutos recorriendo el disco hasta que Claude Code lo pasó a segundo plano.
2. **El paso no terminaba.** El agente entregó su respuesta a las 10:37 (con 0,73 $ de gasto), pero el nodo siguió «ejecutando». El adaptador, después del resultado, seguía esperando mensajes del SDK, y el SDK no cierra mientras quede una tarea en segundo plano. El agente intentó pararla con `TaskStop`, que está desactivada.

Además, R36.9 pedía rutas legibles desde el directorio del agente, pero solo se cumplía con las skills sin pegar:
- las skills pegadas enteras no llevaban ruta;
- los contextos de archivo se leían respecto a la carpeta de trabajo, aunque se guardan respecto al proyecto (`.orquestador/context-files/…`), así que con otra carpeta de trabajo no se encontraban.

## Decisiones (10/11/2026, del usuario)
1. **Ruta entera siempre.** Cada skill y cada contexto de archivo se entrega con su ruta absoluta, se pegue entero o no. Los MCP se nombran por su prefijo de herramientas (`mcp__<servidor>__*`), que es su forma de llamarlos.
2. **El paso termina con la respuesta.** Al llegar el resultado se deja de leer el SDK y se cierra su sesión, y con ella lo que el agente dejara en segundo plano. Un paso no deja procesos colgados.
3. **Nada de buscar por todo el disco.** El prompt lo dice, con las rutas que el agente tiene a mano.

## Requisitos
- **R92.1** [M17b] La ruta de una skill es siempre absoluta: `<proyecto>/.orquestador/skills/<id>/SKILL.md`. Así se puede leer desde cualquier carpeta de trabajo y no depende de R36.9.
- **R92.2** [M17b] Cada skill obligatoria pegada entera lleva, bajo su título, «Carpeta de esta skill: <ruta absoluta>. Lo que la skill llama «junto a este SKILL.md» o «referencias/» está ahí.»
- **R92.3** [M17b] Un contexto de archivo se resuelve respecto a la carpeta del proyecto, no a la de trabajo, y se entrega con su ruta absoluta. Al pegarlo entero lleva «(archivo: <ruta absoluta>)». No se lee nada fuera de la carpeta del proyecto.
- **R92.4** [M17b] El prompt de los agentes con carpeta de trabajo dice: «Lo que necesitas está en tu carpeta de trabajo, en la del proyecto (<ruta>) o en las rutas que se te dan aquí. No busques por todo el disco (find /, dir /s C:\, Get-ChildItem -Recurse en la raíz): si algo no aparece, pregúntalo.»
- **R92.5** [M17b] En cuanto el SDK entrega el resultado, el adaptador deja de leer mensajes y aborta la sesión (`AbortController`). Así el paso termina aunque quede una tarea en segundo plano, y Claude Code cierra lo que lanzó.

## Casos
- **E92.a** *Dado* un paso con la skill obligatoria `speckit-plan` pegada entera, *entonces* el prompt incluye la carpeta absoluta de la skill y que `referencias/` está ahí.
- **E92.b** *Dado* un SDK que entrega el resultado pero no cierra su flujo de mensajes (como con una tarea en segundo plano), *entonces* el paso termina igual con ese resultado y la sesión se aborta.
