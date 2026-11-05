# SPEC-025 · Instalar agentes y skills desde una carpeta o un Zip

**Estado:** Implementada (M5b) · **Hito:** M5b · **Paquetes:** `core`, `store`, `editor`, `ui`, `desktop`

## Propósito
Traer agentes y skills ya hechos en formato nativo de Claude Code. Es código de terceros, así que **nada se instala sin una pantalla de revisión** y el análisis no ejecuta nada.

## Requisitos
- **R25.1** [M5b] El usuario elige una carpeta o un archivo Zip con un diálogo del sistema; la interfaz nunca envía rutas. El proceso principal lo analiza y devuelve un informe con un identificador de esa importación. Si cancela el diálogo no pasa nada.
- **R25.2** [M5b] Se reconocen: agentes (`.md` con cabecera `name`, `description`, `tools`, `model`; el cuerpo son las instrucciones) en `agents/` o en la raíz; skills (carpetas con `SKILL.md`) en `skills/` o en la raíz; y servidores MCP en `.mcp.json`. Lo demás se ignora y se cuenta.
- **R25.3** [M5b] El análisis es seguro: no ejecuta nada y rechaza el paquete entero si supera 500 archivos, 20 MB en total o 2 MB en un archivo, o si el Zip trae rutas absolutas, con `..`, o letras de unidad (zip-slip), o si una carpeta contiene enlaces simbólicos. Nunca se crean enlaces: lo que se instala son archivos normales. El mensaje dice el motivo sin revelar rutas del sistema.
- **R25.4** [M5b] El informe lista cada elemento con tipo, nombre, id propuesto, descripción y avisos: archivos ejecutables o scripts (`.sh`, `.ps1`, `.bat`, `.cmd`, `.exe`, `.js`, `.py`…), herramientas que pide el agente, posibles secretos y modelo desconocido (se usará el modelo por defecto). Si el id ya existe en el proyecto se marca como conflicto y se propone otro id libre; el usuario puede omitirlo.
- **R25.5** [M5b] Los servidores MCP solo se muestran como informativos («desactivado hasta que haya soporte de MCP»); no se instalan.
- **R25.6** [M5b] Solo se instala lo que el usuario marca tras revisar. Las skills conservan sus archivos con las mismas rutas relativas. Un agente importado conserva sus referencias a skills que vienen en el mismo paquete (por nombre) y descarta las demás avisando.
- **R25.7** [M5b] Antes de confirmar no se escribe nada en el proyecto. Cancelar o abrir otra importación descarta la anterior. Una importación ya usada o desconocida se rechaza.
- **R25.8** [M5b] El contrato IPC ofrece analizar (carpeta o Zip), confirmar con la lista de elementos marcados y cancelar; valida la forma de cada petición.
- **R25.9** [M5b] La pantalla «Agentes» tiene un botón «Instalar» con la pantalla de revisión: elementos con casillas, avisos bien visibles, conflictos y el botón «Instalar seleccionados». Al terminar dice qué se instaló.
