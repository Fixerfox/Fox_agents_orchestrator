# SPEC-023 · Ajustes de la aplicación

**Estado:** Implementada (M5a); los requisitos de M6 se cumplen en la SPEC-027 · **Hito:** M5a · **Paquetes:** `core`, `store`, `editor`, `ui`, `desktop`

## Propósito
Un sitio donde configurar cómo se conecta Claude y los valores por defecto de la app, sin tocar archivos. Son ajustes globales (de la app), no del proyecto.

## Requisitos
- **R23.1** [M5a] Los ajustes globales son: conexión con Claude (`claude-code`, usa la sesión de Claude Code, o `api-key`), modelo por defecto, agentes en paralelo (1–16, por defecto 4) y límite de tokens por defecto (opcional). Se validan con mensajes en español y si falta algún valor se usan los de por defecto.
- **R23.2** [M5a] Los ajustes se guardan en el directorio de datos de la app, versionados y con escritura atómica, y nunca contienen secretos.
- **R23.3** [M5a] La clave API se guarda cifrada en el almacén seguro del sistema (nunca en `settings.json`), no se devuelve nunca al renderer (solo si existe o no) y se puede cambiar y quitar. Se rechazan claves vacías, con espacios o demasiado largas. Si el sistema no ofrece cifrado, no se guarda y se explica.
- **R23.4** [M5a] El contrato IPC ofrece leer y guardar ajustes, guardar y quitar la clave y consultar si hay clave; valida cada petición y rechaza campos extra.
- **R23.5** [M5a] La ventana de Ajustes se abre desde un botón de la barra superior. Tiene las secciones Claude (conexión, clave, modelo, paralelismo), Presupuesto (límite por defecto) y Apariencia (tema). Los cambios se guardan con «Guardar» y los errores se muestran junto al campo.
- **R23.6** [M5a] El límite de tokens por defecto rellena el campo de la barra de ejecución y el número de agentes en paralelo llega al orquestador al crear el proyecto.
- **R23.7** [M6a] «Probar conexión» comprueba que Claude responde con los ajustes actuales.
