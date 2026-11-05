# SPEC-024 · Skills del proyecto

**Estado:** Implementada (M5b); el requisito de M6 se cumple en la SPEC-027 · **Hito:** M5b · **Paquetes:** `core`, `store`, `editor`, `ui`, `desktop`

## Propósito
Poder crear skills dentro de un proyecto y asignarlas a los agentes que las necesitan. Las skills se guardan en el formato nativo de Claude Code (una carpeta con `SKILL.md`), de modo que Claude puede leerlas tal cual. Es otro tramo de SPEC-011; la biblioteca global y las versiones siguen en M5.

## Requisitos
- **R24.1** [M5b] Una skill del proyecto tiene `id`, nombre (1–60 caracteres), descripción (1–300, obligatoria: Claude la usa para decidir cuándo aplicarla) y contenido en Markdown (hasta 50 000). Las validaciones dan mensajes en español y señalan el campo.
- **R24.2** [M5b] Se guarda en `.orquestador/skills/<id>/SKILL.md` con cabecera `---` que lleva `name` y `description`; el resto es el contenido. Leer y volver a escribir una skill no cambia su significado, ni siquiera con comillas, dos puntos o varias líneas en la descripción. La escritura es atómica y no se guarda nada que parezca un secreto.
- **R24.3** [M5b] Los demás archivos de la carpeta de la skill (plantillas, scripts, referencias) se conservan al editar y al borrar la skill se borran con ella. Se pueden listar por ruta relativa y tamaño; la pantalla no los edita.
- **R24.4** [M5b] Un agente tiene `skillIds` (por defecto vacío; los agentes anteriores sin el campo se leen como vacío). No puede referir skills que no existen. Al borrar una skill se quita de los agentes que la usaban y se puede consultar dónde se usa antes de borrar.
- **R24.5** [M5b] El contrato IPC ofrece listar, guardar y borrar skills, consultar usos y listar los archivos de una skill; valida la forma de cada petición, rechaza campos extra y no deja pasar rutas.
- **R24.6** [M5b] La pantalla «Agentes» tiene una pestaña «Skills» donde se crean, editan y borran skills, con errores junto al campo, confirmación al borrar y aviso de dónde se usan. Muestra los archivos incluidos.
- **R24.7** [M5b] El formulario del agente permite marcar las skills que usa.
- **R24.9** [M5b] Desde el formulario de una skill guardada se pueden añadir archivos o una carpeta de referencia con el diálogo del sistema; la interfaz nunca envía rutas. La app los copia dentro de la carpeta de la skill, bajo `referencias/` (una carpeta conserva su nombre y su estructura). Un archivo que ya existe no se sobrescribe: el nuevo recibe un sufijo (`paleta-2.md`). Una skill sin guardar explica que hay que guardarla antes.
- **R24.10** [M5b] Los archivos añadidos respetan los límites de SPEC-025: 500 archivos, 20 MB y 2 MB por archivo, contando los que la skill ya tiene; no se admiten enlaces simbólicos ni rutas que salgan de la carpeta; `.git` y `node_modules` se ignoran. Si algo no cabe, no se copia nada y el mensaje dice el motivo sin revelar rutas.
- **R24.11** [M5b] Cada archivo de la lista se puede quitar (con confirmación) y la ruta relativa se puede copiar para pegarla en el contenido de la skill. Nunca se puede quitar ni sustituir `SKILL.md` por esta vía.
- **R24.12** [M5b] Los archivos de texto se pueden ver sin salir de la pantalla (hasta 200 000 caracteres, con aviso si se recorta); los binarios dicen que no se pueden mostrar. Los scripts y ejecutables llevan un aviso visible.
- **R24.13** [M5b] El contrato IPC ofrece añadir (archivos o carpeta), quitar y leer un archivo de una skill; valida cada petición y rechaza rutas absolutas, con `..` y campos extra.
- **R24.8** [M6a] El adaptador de Claude entrega al agente las skills asignadas al ejecutar.
