# SPEC-022 · Agentes y contextos del proyecto

**Estado:** Implementada (M5a); los requisitos de M6 se cumplen en la SPEC-027 · **Hito:** M5a · **Paquetes:** `core`, `store`, `editor`, `ui`, `desktop`

## Propósito
Poder crear y configurar agentes y sus contextos dentro de un proyecto, en vez de usar una lista fija. Es el primer tramo de SPEC-011 (registro): agentes y contextos **de proyecto**. La biblioteca global, las versiones, las skills y los MCP siguen en M5.

## Requisitos
- **R22.1** [M5a] Un agente del proyecto tiene `id`, nombre (1–60 caracteres), descripción (hasta 300), instrucciones (hasta 20 000), modelo de una lista conocida, contextos asignados (ids) y, opcional, máximo de turnos (1–200). Las validaciones dan mensajes en español y señalan el campo.
- **R22.2** [M5a] Un contexto del proyecto tiene `id`, nombre (1–60) y un tipo: texto (hasta 100 000 caracteres), URL (solo `http` o `https`) o archivo (ruta relativa dentro del proyecto, sin `..` ni rutas absolutas).
- **R22.3** [M5a] El proyecto guarda los agentes en `.orquestador/agents/<id>.json` y los contextos en `.orquestador/contexts/<id>.json`, versionados y con escritura atómica; no se guarda nada que parezca un secreto.
- **R22.4** [M5a] Un agente no puede referir contextos que no existen. Al borrar un contexto se quita de los agentes que lo usaban. Antes de borrar un agente o un contexto se puede consultar dónde se usa (diagramas y agentes).
- **R22.5** [M5a] El contrato IPC ofrece listar, guardar y borrar agentes y contextos, y consultar usos; valida la forma de cada petición, rechaza campos extra y no deja pasar rutas absolutas.
- **R22.6** [M5a] La pantalla «Agentes» permite crear, editar y borrar agentes: nombre, descripción, instrucciones, modelo y contextos asignados. El id se genera a partir del nombre y es único. Los errores se muestran junto al campo.
- **R22.7** [M5a] La misma pantalla permite crear, editar y borrar contextos de los tres tipos.
- **R22.8** [M5a] Borrar pide confirmación y dice dónde se usa el elemento.
- **R22.9** [M5a] La galería y el panel «En este diagrama» muestran los agentes del proyecto, con su descripción; la galería ofrece «Crear agente», que abre la pantalla de agentes. Sin proyecto abierto se explica qué hacer. Los agentes de ejemplo integrados siguen disponibles hasta M6; si un agente del proyecto tiene su mismo id, manda el del proyecto.
- **R22.10** [M6a] El adaptador de Claude recibe las instrucciones, el modelo y los contextos (por referencia) de cada agente al ejecutar.
- **R22.11** [M6c] Lo escrito sin guardar en los formularios de agentes, contextos y skills no se pierde al cambiar de pestaña ni de elemento: cada borrador se conserva hasta guardar, borrar o cerrar la pantalla, y las pestañas y filas con cambios pendientes lo indican.
- **R22.12** [M6c] Las instrucciones del agente, el contenido de la skill y el texto de un contexto se editan en un campo alto que se puede ampliar, con contador de caracteres frente al límite.
- **R22.13** [M6c] Esos campos permiten cargar un archivo .md (o .txt) de hasta 200 KB: si ya hay texto se pregunta si reemplazar o añadir al final; un archivo demasiado grande o que no es texto se rechaza con un mensaje.
- **R22.14** [M6c] Un contexto de tipo archivo ofrece «Elegir archivos…» y «Elegir carpeta…» con el diálogo del sistema; lo elegido se copia dentro del proyecto (límites y renombrado de SPEC-024) y el contexto guarda la ruta relativa. La interfaz no ve rutas del disco.
- **R22.15** [M6c] Al borrar un contexto se borran también los archivos que se subieron para él.
- **R22.16** [M6c] En el formulario del agente, las skills y los contextos asignados se muestran como fichas que se quitan con un botón, y «Añadir skills…» / «Añadir contextos…» abre una pantalla aparte con buscador, el nombre y la descripción (o tipo) de cada elemento y un botón Añadir/Quitar. «Listo» aplica la selección; «Cancelar» o Escape la descartan. Desde esa pantalla se puede crear un elemento nuevo sin perder el borrador del agente.
