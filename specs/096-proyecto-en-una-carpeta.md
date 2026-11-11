# SPEC-096 · El proyecto es la carpeta en la que se trabaja

**Estado:** Implementada · **Hito:** M18a · **Paquetes:** `store`, `editor`, `ui`, `apps/desktop` · **Rama:** `feature/proyecto-una-carpeta`

## Propósito
Hasta hoy un proyecto podía vivir en dos carpetas: la que tiene `.orquestador` y una «carpeta de trabajo» elegida aparte y guardada en `.orquestador/work-folder.json` (R31.1). El usuario lo pidió claro (11/11/2026): `.orquestador` se crea **en la carpeta donde se trabaja**, no hay dos carpetas, y tiene que haber una opción para añadirlo al `.gitignore` si existe.

Tener dos carpetas daba problemas reales:
- El repositorio de git era el de la carpeta de trabajo, pero la terminal integrada (R30.13) se abría en la del proyecto.
- La confianza en la configuración de Claude Code (SPEC-088) y las copias miraban dos sitios.
- Las specs que vienen (guarda de rama y control de versiones) necesitan que «el repositorio» sea una sola carpeta.

## Decisiones (11/11/2026)
1. **Qué carpeta manda.**
   - *Primera:* mantener las dos y crear otro `.orquestador` en la de trabajo.
   - *Revisión:* habría dos `.orquestador` y no se sabría cuál vale.
   - *Segunda (elegida):* **una sola**. La carpeta del proyecto es la carpeta de trabajo. No se puede elegir, cambiar ni quitar una carpeta de trabajo aparte.
2. **Proyectos que ya tienen dos carpetas.**
   - *Primera:* mover `.orquestador` al abrir, sin preguntar.
   - *Revisión:* el destino puede tener ya un `.orquestador`, los recientes apuntan a la carpeta antigua, los secretos de los MCP se guardan por carpeta, y un movimiento a medias deja el proyecto roto.
   - *Segunda (elegida):* el proyecto **sigue funcionando como estaba** y se ofrece «Unir en <carpeta>». Unir copia, comprueba, y solo entonces aparta la antigua con otro nombre. Nunca borra.
3. **`.gitignore` de la raíz.**
   - *Primera:* añadir siempre `.orquestador/`.
   - *Revisión:* impide compartir diagramas y agentes con el equipo, que es para lo que se hizo R90.7, y toca un archivo del usuario sin preguntar.
   - *Segunda (elegida):* una **opción con dos valores**. Por defecto, «Compartir la configuración» (lo de hoy). «No subir nada de Orquestador» añade `.orquestador/` al `.gitignore` de la raíz.
4. **Saber si ya hay archivos de `.orquestador` en git.**
   - *Primera:* preguntarlo con `git ls-files` y avisar solo si los hay.
   - *Revisión:* `store` no lanza programas, y el puerto de git llega con la spec siguiente.
   - *Segunda (elegida):* la opción explica siempre que lo ya subido sigue en git hasta que se quite con `git rm -r --cached .orquestador`. La app no lo quita.

## Requisitos

### Una sola carpeta
- **R96.1** [M18a] La carpeta de trabajo de un proyecto es su propia carpeta. `ProjectStore.getWorkFolder()` devuelve siempre una ruta: la del proyecto, salvo en un proyecto antiguo sin unir (R96.4). Los agentes reciben siempre su resumen (R31.2), también en un proyecto recién creado.
- **R96.2** [M18a] El contrato ya no tiene `pickWorkFolder` ni `clearWorkFolder`, y el almacén ya no tiene `setWorkFolder`. `getWorkFolder` devuelve nombre y número de archivos (nunca la ruta) y `separate: true` si es un proyecto antiguo sin unir.
- **R96.3** [M18a] Interfaz: «Proyecto» enseña siempre la carpeta, sin «Cambiar carpeta» ni «Desconectar» y sin el estado «todavía no trabaja sobre ninguna carpeta». El asistente «Conectar la carpeta del proyecto» analiza la carpeta del proyecto directamente, sin elegirla. Ajustes › Este proyecto › «Carpeta del proyecto» la enseña sin botones para cambiarla.

### Proyectos antiguos con dos carpetas
- **R96.4** [M18a] Un proyecto con un `work-folder.json` que apunta a otra carpeta que existe sigue trabajando en ella. Si apunta a la propia carpeta del proyecto, o la carpeta ya no existe, se ignora.
- **R96.5** [M18a] `joinWorkFolder` («Unir en <carpeta>») copia `.orquestador` a la carpeta de trabajo, sin `work-folder.json`, primero con un nombre temporal y luego con el definitivo. Comprueba que el proyecto copiado se abre y después renombra el antiguo a `.orquestador.unido` (con un número detrás si ya existe). No borra nada. Devuelve el proyecto abierto en su carpeta nueva.
- **R96.6** [M18a] No se une, y se explica por qué, si la carpeta de trabajo ya tiene un `.orquestador`, si hay ejecuciones en marcha o en cola, o si el proyecto no tiene una carpeta aparte. Si la copia falla a mitad, se retira lo copiado con el nombre temporal y el proyecto sigue abierto donde estaba.
- **R96.7** [M18a] Al unir, lo que la app guarda por carpeta pasa a la nueva: el proyecto en la lista de recientes (el antiguo se quita) y los secretos de sus servidores MCP. La confianza en la configuración de Claude Code no se copia: se vuelve a preguntar, que es lo seguro.
- **R96.8** [M18a] Con un proyecto antiguo sin unir, «Proyecto» y Ajustes › «Carpeta del proyecto» enseñan el aviso «Este proyecto guarda su configuración en otra carpeta» con el botón «Unir en <carpeta>». Si falla, el motivo se ve junto al botón.

### `.gitignore` de la raíz
- **R96.9** [M18a] `getGitIgnore` dice si la opción se ofrece (`available`: la carpeta del proyecto está en un repositorio de git o tiene un `.gitignore`), si el `.gitignore` existe y el modo: `all` si alguna línea ignora `.orquestador` entero (`.orquestador`, `.orquestador/`, `/.orquestador`, `/.orquestador/`), `shared` si no. Que sea un repositorio se sabe buscando `.git` hacia arriba, sin lanzar `git`.
- **R96.10** [M18a] `setGitIgnore('all')` añade al final del `.gitignore` de la carpeta del proyecto una línea de comentario y `.orquestador/`. Si no existe, lo crea. Respeta los saltos de línea del archivo (CRLF o LF), añade un salto si el archivo no terminaba en uno, y no cambia nada si ya estaba ignorado.
- **R96.11** [M18a] `setGitIgnore('shared')` quita solo las líneas que ignoran `.orquestador` entero y el comentario que añadió la app. No toca ninguna otra línea ni borra el archivo. `.orquestador/.gitignore` (R90.7) no cambia en ningún modo.
- **R96.12** [M18a] El contrato valida el modo (`all` o `shared`) y rechaza cualquier otro valor y campos de más. Sin proyecto abierto responde con un error claro.
- **R96.13** [M18a] Ajustes › «Carpeta del proyecto» enseña la opción «Orquestador y git» con «Compartir la configuración» y «No subir nada de Orquestador», solo si `available`. Al elegir «No subir nada» se lee que lo ya subido sigue en git hasta quitarlo con `git rm -r --cached .orquestador`.

## Escenarios
- **E96.a** *Dado* un proyecto nuevo creado en la carpeta de un juego, *entonces* `.orquestador` está dentro de ella, los agentes trabajan ahí y no hay nada que conectar.
- **E96.b** *Dado* un proyecto antiguo en `Proyectos/MiJuego-orq` que trabaja en `Juegos/MiJuego`, *cuando* se pulsa «Unir en MiJuego», *entonces* `Juegos/MiJuego/.orquestador` tiene sus diagramas y agentes, la carpeta antigua conserva `.orquestador.unido`, y los MCP siguen teniendo sus secretos.
- **E96.c** *Dado* un repositorio con `.gitignore` en CRLF sin salto final, *cuando* se elige «No subir nada», *entonces* gana dos líneas en CRLF y al volver a «Compartir» queda como estaba, con un salto final.

## Limitaciones
- Si el `.orquestador` antiguo no se puede renombrar (en Windows, por un archivo en uso), se queda donde está: el proyecto ya unido funciona igual, y la carpeta antigua seguirá ofreciendo «Unir», que se rechaza porque el destino ya tiene el suyo.
- Las rutas absolutas que ya quedaron escritas en los registros de ejecuciones anteriores no se reescriben.

## Cambia
- **R31.1:** ya no se elige, cambia ni quita la carpeta de trabajo: es la del proyecto (R96.1–R96.2).
- **R31.10:** el contrato ya no ofrece elegir ni quitar la carpeta.
- **R32.16–R32.17:** el asistente de la carpeta no la elige; analiza la del proyecto (R96.3).

## Fuera de alcance
- Quitar de git lo que ya se subió de `.orquestador`.
- Mover un proyecto a otra carpeta cualquiera (solo se une con su carpeta de trabajo).
- Pasar a la carpeta nueva las pestañas del asistente y las comprobaciones aprobadas (SPEC-086, SPEC-088): empiezan de cero.
- La guarda de rama al ejecutar y el visor de control de versiones (SPEC-097 y SPEC-098).
