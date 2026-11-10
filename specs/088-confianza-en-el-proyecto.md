# SPEC-088 · Confianza en el proyecto

**Estado:** Implementada · **Hito:** M16g · **Paquetes:** `claude`, `store`, `editor`, `ui`, `desktop` · **Rama:** `feature/seguridad-1.0`

## Propósito
La auditoría para la 1.0 (09/11/2026) encontró que **abrir un proyecto ajeno equivalía a confiar en él** (A3):
- Con «Cargar la configuración de Claude Code» (activado por defecto, SPEC-050), los agentes y el asistente cargan el `.claude/settings.json` y el `.claude/settings.local.json` del repositorio. Ahí puede haber `hooks` (comandos que Claude Code ejecuta fuera de la política de la app), `env` (por ejemplo `ANTHROPIC_BASE_URL` hacia un tercero) o `apiKeyHelper` (un comando que da la clave).
- Las aprobaciones de comandos de comprobación (R75.6) se guardaban en `.orquestador/approved-checks.json`, dentro del propio repositorio: un repositorio podía traer sus comandos ya aprobados.

## Decisiones (09/11/2026, del usuario)
1. **Pantalla de confianza.** Si la configuración de Claude Code del proyecto trae algo que ejecuta comandos o cambia el entorno, se enseña qué trae y se pide confiar. Sin confiar, esa configuración se ignora (se carga solo la del usuario).
2. **La decisión vive en los datos de la app**, no en el repositorio, junto con una huella de lo que se revisó: si el repositorio cambia esa configuración, se vuelve a preguntar.
3. **Cuándo.** Al abrir el proyecto, si hay algo que revisar y no se ha decidido. Mientras no se decide, cuenta como no confiado.
4. **Las aprobaciones de comprobaciones**, a los datos de la app. Las del repositorio se ignoran (no se migran: serían justo las que traería un repositorio malicioso).

## Requisitos

### Qué se revisa (`claude`)
- **R88.1** [M16g] `scanClaudeConfig(dirs)` lee `.claude/settings.json` y `.claude/settings.local.json` de cada carpeta y devuelve los riesgos (`{ file, key, detail }`) y una huella (SHA-256 de lo arriesgado). Son riesgo: `hooks` (con el número de comandos), `env` (con los nombres de las variables), `apiKeyHelper`, `awsAuthRefresh`, `awsCredentialExport`, `otelHeadersHelper` y `statusLine`. Un archivo que no existe o no es JSON no da riesgo. Sin riesgos, la huella es vacía.
- **R88.2** [M16g] `settingSourcesFor(settings, projectTrusted)`: sin cargar la configuración, ninguna; si el proyecto no es de confianza, solo `user`; si lo es, `user`, `project` y `local`.

### Decisión (`store`)
- **R88.3** [M16g] `ProjectTrustStore` guarda en `<datos de la app>/trust.json`, por proyecto (16 caracteres del SHA-256 de su carpeta), `{ fingerprint, decision: 'trusted' | 'ignored' }`. `decision(root, fingerprint)` solo devuelve la decisión si la huella coincide.

### Motor
- **R88.4** [M16g] Cada paso de agente y cada turno del asistente cargan la configuración del proyecto solo si `scanClaudeConfig` de la carpeta del proyecto y de la de trabajo no da riesgos, o si la decisión es `trusted` con la misma huella.
- **R88.5** [M16g] Las aprobaciones de comandos de comprobación (R75.6) se guardan en `<datos de la app>/trust/<clave del proyecto>-checks.json`. Las de `.orquestador/approved-checks.json` se ignoran.

### Interfaz
- **R88.6** [M16g] `projectTrust()` devuelve los riesgos del proyecto abierto y la decisión vigente (`null` si no hay o la huella cambió), sin rutas absolutas. `setProjectTrust(decision)` la guarda con la huella actual.
- **R88.7** [M16g] Al abrir un proyecto con riesgos y sin decisión, con «Cargar la configuración de Claude Code» activado, aparece el diálogo «¿Confías en la configuración de Claude Code de este proyecto?» con la lista de lo que trae y «Confiar» o «Ignorarla». Cerrarlo sin elegir cuenta como ignorarla en esa sesión, y se vuelve a preguntar la próxima vez.
- **R88.8** [M16g] En Ajustes › Claude, si el proyecto abierto trae algo que revisar, se ve si se confía o se ignora y un botón «Revisar» que abre el mismo diálogo.

## Casos
- **E88.a** *Dado* un proyecto clonado con `.claude/settings.json` que trae `hooks.PreToolUse` y `env.ANTHROPIC_BASE_URL`, *cuando* se abre, *entonces* aparece el diálogo con «hooks: 1 comando» y «env: ANTHROPIC_BASE_URL»; si se elige «Ignorarla», los agentes se lanzan con `settingSources: ['user']`.
- **E88.b** *Dado* un proyecto de confianza, *cuando* su `.claude/settings.json` añade otro hook, *entonces* la huella cambia y se vuelve a preguntar.
