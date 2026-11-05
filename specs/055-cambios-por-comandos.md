# SPEC-055 · Archivos que cambian los comandos

**Estado:** Implementada (M8g) · **Hito:** M8g · **Paquetes:** `core`, `claude`, `editor`, `ui`

## Propósito
El 05/11 el usuario vio que la ejecución «Generador» (Spec Kit) había creado la página `/test`, pero la pestaña **Archivos** no la mostraba. El registro lo explica: el Implementador escribió `checks/build_pages.py` con Write (sí aparece) y luego lo ejecutó con Bash; el script escribió `_raiz/test/index.html` y `_raiz/es/test/index.html`. Hasta ahora solo se registraba lo que pasaba por la política de Write/Edit (R31.12): lo que crea o cambia un comando (un script, un build, `sed -i`, `npm install`…) no llegaba nunca a «Archivos», a los ficheros del paso ni al visor.

## Decisiones (05/11/2026)
1. *Primera:* foto de la carpeta al empezar el paso y comparar tras cada herramienta. *Revisión:* con pasos en paralelo en la misma carpeta, a un paso se le atribuiría lo que escribe otro durante todo su tiempo. *Segunda (elegida):* **ventanas por comando**: la foto se hace cuando la política permite el comando (antes de que se ejecute) y se compara cuando vuelve su resultado. Solo se atribuye al paso lo que cambia mientras él tiene un comando en marcha.
2. *Primera:* foto en cada Bash. *Revisión:* la mayoría de comandos de los agentes solo leen (`ls`, `grep`, `cat`, `git status`) y la foto recorre la carpeta. *Segunda (elegida):* los comandos que el clasificador de solo lectura (R47.9) da por seguros no abren ventana; para emparejar cada resultado con su comando, el evento `tool_result` lleva el id de la llamada.
3. La foto es tamaño y fecha de cada archivo (sin leer contenido), sin entrar en `.git`, `node_modules` ni `.orquestador`, con un tope de 20 000 archivos.
4. **Sin copia de seguridad.** No se sabe qué va a tocar un comando hasta que termina, y copiar la carpeta entera antes de cada comando es caro. Lo que cambia un comando aparece en «Archivos» con «Ver», pero sin «Restaurar», y lo dice: «con un comando · sin copia».
5. Lo que ya registró la política de escritura (con su copia y su tipo exacto) no se repite como cambio de comando.

## Requisitos
- **R55.1** [M8g] El adaptador de Claude registra como archivos del paso (`file`) los que crea o modifica un comando Bash dentro de la carpeta de trabajo, igual que los de Write/Edit: llegan a `file.produced`, a los ficheros del paso, a «Archivos» y al visor.
- **R55.2** [M8g] Al permitir un comando que no es de solo lectura, antes de ejecutarlo, se abre una ventana con una foto de la carpeta (tamaño y fecha de cada archivo; sin `.git`, `node_modules` ni `.orquestador`; tope de 20 000). Varios comandos a la vez comparten la foto de partida; el resultado de cada uno cierra solo su ventana (por el id de la llamada, que ahora lleva `tool_result`). Sin ventanas abiertas no se mira la carpeta, así que lo que cambie otro paso entonces no se atribuye a este.
- **R55.3** [M8g] Al volver el resultado de un comando se hace otra foto y se emite `file` con `via: 'command'` por cada archivo nuevo (`created`) o con otro tamaño o fecha (`modified`), en orden de ruta. Si la foto de partida se cortó por el tope, un archivo que no estaba en ella no se da por nuevo.
- **R55.4** [M8g] No se repite lo ya registrado por la política de escritura ni lo ya enviado. El resultado de un subagente compara sin cerrar ventanas, y al terminar el paso (bien, con error o cancelado) se cierran todas y se recoge lo pendiente.
- **R55.5** [M8g] `file.produced` guarda `via`; `runFiles` marca `byCommand`. En «Archivos», un archivo cambiado por un comando dice «con un comando» y, si era modificado y no hay copia, «con un comando · sin copia» (sin «Restaurar»); debajo se explica por qué.

## Fuera de alcance
- Archivos **borrados** por un comando (`FileChange` no tiene «borrado»).
- Copia de seguridad de lo que modifica un comando.
- Lo que un comando escribe fuera de la carpeta de trabajo.
- Ejecuciones ya terminadas: no se reescriben; la ejecución «Generador» del 05/11 sigue sin mostrar las dos páginas.
