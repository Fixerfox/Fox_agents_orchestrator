# SPEC-051 · Sin preguntas por defecto

**Estado:** Implementada (M8g) · **Hito:** M8g · **Paquetes:** `core`, `store`, `claude`, `ui`

## Propósito
El 05/11, ya con SPEC-050, el usuario recibía preguntas de permiso a cada paso. Por ejemplo, «¿Puedo ejecutar este comando? (puede afectar a algo fuera de la carpeta del proyecto)» para un `cd … && wc -c … && ls … ; git status` que solo leía. Su queja: «¿para qué quiero un orquestador que no para de pedirme permisos?», y que pasaba «para todo».

Los registros de `D:\FixerfoxGames\WebApp` mostraron 14 preguntas de permiso en las últimas ejecuciones del Implementador de Spec Kit: 12 de un nivel que preguntaba cualquier comando no sencillo (`mkdir -p …`, `cat …`, `gh repo list …`) y 2 falsas, por rutas de Git Bash (R51.5). Las preguntas venían de tres sitios:
- el nivel del proyecto («Automático» por defecto, o «Preguntar»);
- el permiso por herramienta de los MCP que no son de confianza (R30.4);
- la confirmación «Permitir» de las acciones del asistente que borran o ejecutan (R29.3).

Se decide que el orquestador no pregunte nada salvo que el usuario lo pida.

## Requisitos
- **R51.1** [M8g] El nivel por defecto del proyecto es «Sin preguntar nunca» (`DEFAULT_PERMISSION = 'full'`). Los ajustes pasan a la versión 2 (`SETTINGS_SCHEMA_VERSION`). Al leer unos de la versión 1, el nivel guardado, sea cual sea, pasa a «Sin preguntar nunca», porque hasta ahora nadie lo había elegido sabiendo lo que costaba. Desde la versión 2 se respeta lo que se elija. Sustituye el valor por defecto de R47.8.
- **R51.2** [M8g] Con «Sin preguntar nunca», las herramientas de los servidores MCP del agente tampoco preguntan, sean o no de confianza. Un servidor que no está asignado al agente se sigue denegando.
- **R51.3** [M8g] Con el proyecto en «Sin preguntar nunca», las acciones del asistente que piden «Permitir» (borrar, ejecutar un diagrama, probar un MCP, abrir la terminal) se hacen sin preguntar, y su tarjeta queda como cualquier otra acción hecha. Con otro nivel, se pregunta como siempre (R29.3).
- **R51.5** [M8g] En Windows, la `Bash` de Claude Code es Git Bash, que escribe las rutas como `/d/FixerfoxGames/WebApp` (o `/cygdrive/d/…`). Antes de decidir si un comando sale de la carpeta (R47.1, R47.5), esas rutas se pasan a `D:/FixerfoxGames/WebApp`, también en los `cd` encadenados y en los valores de opciones (`nativePath`). Antes, `cd /d/FixerfoxGames/WebApp && ls` dentro del propio proyecto preguntaba «puede afectar a algo fuera de la carpeta del proyecto». En Linux y macOS no se toca nada. `/tmp` y las demás rutas de fuera siguen contando como fuera.
- **R51.4** [M8g] Lo que sigue preguntando es solo lo que el usuario configura para eso: un agente con su propio nivel en la ficha (R47.10), un agente supervisado (R39.3), «Confirmar antes de terminar» (SPEC-043) y las preguntas que el agente hace con `AskUserQuestion`.

## Escenarios
- Abro la app con los ajustes de antes (versión 1, «Automático»): pasan a «Sin preguntar nunca». El agente ejecuta `cd /d/FixerfoxGames/WebApp && ls _raiz/assets` y usa un MCP que no es de confianza, sin ninguna pregunta.
- Pido al asistente «borra el agente Revisor»: lo borra y la tarjeta dice que está hecho, con «Deshacer» si la acción lo permite.
- Pongo el proyecto en «Preguntar»: los permisos vuelven a preguntarse y la elección se conserva al reiniciar.

## Fuera de alcance
- Quitar los niveles: siguen en Ajustes y en la ficha de cada agente para quien quiera más control.
