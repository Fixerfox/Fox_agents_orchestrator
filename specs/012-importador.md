# SPEC-012 · Importador de paquetes (Zip o carpeta)

**Estado:** Borrador · **Hito:** M5 · **Paquete:** `store`, `ui`

## Propósito
Instalar agentes ya hechos en formato nativo de Claude Code (subagentes `.md` con frontmatter, skills con `SKILL.md`, `.mcp.json`) sin ejecutar código de terceros sin permiso.

## Requisitos
- **R12.1** [M5] Un paquete se analiza en una carpeta temporal aislada: no se ejecuta ni se instala nada durante el análisis.
- **R12.2** [M5] Se rechazan rutas que escapan de la carpeta (zip-slip, `..`, rutas absolutas, enlaces simbólicos hacia fuera) y se limitan tamaño total, número de archivos y ratio de compresión.
- **R12.3** [M5] La pantalla de revisión lista agentes, skills, scripts, servidores MCP (comando y variables de entorno) y los permisos/herramientas que solicitan, y marca lo que ejecuta código.
- **R12.4** [M5] Hasta aprobar, no se copia nada a la biblioteca ni a un proyecto; el usuario elige el ámbito (global o proyecto) y qué elementos instalar.
- **R12.5** [M5] Los servidores MCP importados quedan **desactivados** hasta que el usuario los confirma de forma explícita; nunca se prueban solos.
- **R12.6** [M5] Si un id ya existe, se ofrece sobrescribir (creando versión nueva), instalar con otro id u omitir.
- **R12.7** [M5] Un paquete mal formado produce un informe de errores por archivo y no instala nada.
