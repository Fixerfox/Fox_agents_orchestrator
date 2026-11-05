# SPEC-011 · Registro de agentes, skills, contextos, MCP y biblioteca

**Estado:** Borrador · **Hito:** M5 · **Paquete:** `store`, `ui`

## Requisitos
- **R11.1** [M5] Un agente tiene: nombre, descripción, instrucciones, modelo, skills, contextos, servidores MCP, permisos (nivel + autoaprobación), herramientas permitidas, límites (turnos, coste), icono, color y versión.
- **R11.2** [M5] Cada elemento (agente, skill, contexto, plantilla) tiene ámbito `global` o `project`. Un elemento de proyecto con el mismo `id` sobrescribe al global solo dentro de ese proyecto, sin modificar el global.
- **R11.3** [M5] Cada guardado de un elemento global crea una versión nueva (historial). Un proyecto puede fijar una versión o seguir la última.
- **R11.4** [M5] Un elemento global no puede depender de elementos de proyecto (se rechaza al guardar).
- **R11.5** [M5] Los contextos (texto, archivo, carpeta, URL) se entregan al agente **por referencia**; los de tipo texto se guardan como archivo dentro de `.orquestador/`. Un contexto URL exige la herramienta web permitida y la UI avisa si falta.
- **R11.6** [M5] Optimizar instrucciones con IA muestra una vista de diferencias para aceptar, editar o descartar; la versión anterior se conserva.
- **R11.7** [M5] El catálogo de MCP permite alta (comando/args/env o URL), prueba de conexión, asignación a varios agentes e importación desde `.mcp.json`. Las variables de entorno sensibles se guardan en el almacén seguro.
- **R11.8** [M5] El nivel de permisos es un preajuste (lectura/edición/ejecución) que rellena la lista de herramientas permitidas; si la lista se edita, prevalece sobre el preajuste.
- **R11.9** [M5] Antes de borrar un elemento se muestra dónde se usa (diagramas, plantillas, otros agentes).
