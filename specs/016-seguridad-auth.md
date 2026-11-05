# SPEC-016 · Permisos, seguridad y autenticación

**Estado:** Borrador · **Hito:** M4 / M6 · **Paquete:** `core`, `adapters`, `desktop`

## Requisitos
- **R16.1** [M6] Autenticación por sesión de Claude Code ya iniciada o por clave API; el usuario elige el modo y la app indica cuál está activo.
- **R16.2** [M6] La clave API se guarda solo en el almacén seguro del sistema (Credential Manager en Windows, Secret Service en Linux) y nunca aparece en archivos, eventos ni logs.
- **R16.3** [M6] Los permisos de un agente (lectura/edición/ejecución + herramientas permitidas) se aplican como política del motor: lo no permitido se deniega; lo peligroso emite `permission.requested` y espera respuesta del usuario.
- **R16.4** [M6] Los agentes con autoaprobación solo la ejercen dentro de la carpeta del proyecto/espacio de trabajo.
- **R16.5** [M6] Los agentes no pueden leer ni escribir fuera de la carpeta del proyecto salvo que el usuario lo permita expresamente.
- **R16.6** [M6] Electron con aislamiento de contexto, sin integración de Node en el renderer, canal IPC tipado y validado, y política de contenido restrictiva.
- **R16.7** [M6] Los servidores MCP solo se arrancan si están activados; los de paquetes importados exigen confirmación previa (ver SPEC-012).
- **R16.8** [M6] Toda petición y respuesta de permisos queda en el log.
