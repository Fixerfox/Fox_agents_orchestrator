# SPEC-091 · Empaquetado para Windows, Linux y macOS, y releases

**Estado:** Implementada · **Hito:** M17a · **Paquetes:** `claude`, `editor`, `ui`, `desktop`, scripts, CI · **Rama:** `feature/empaquetado`

## Propósito
La auditoría para la 1.0 (09/11/2026) encontró que **no se podía instalar la app**:
- no había empaquetador; se arrancaba con `iniciar.bat`, que exige Node 22 y `npm install`, y solo existe para Windows;
- las dependencias de ejecución estaban declaradas en la raíz y no en la app;
- el binario de Claude (de 200 a 330 MB según la plataforma) no puede ejecutarse desde dentro de `app.asar`;
- la carpeta de datos cambiaría de sitio al ponerle nombre a la app;
- no había avisos de terceros, la versión era `0.0.0` y el código del modo prueba iba en cualquier compilación.

Además, la web (fixerfoxgames.com) necesita enlaces de descarga que no cambien con cada versión.

## Decisiones (10/11/2026, del usuario)
1. **Plataformas.** Windows (instalador NSIS), **Linux (AppImage)** y **macOS (dmg)**. Cada una se construye en su propio sistema, porque el binario de Claude y node-pty son por plataforma: en local o en la CI (`windows-latest`, `ubuntu-latest`, `macos-latest`).
2. **El binario de Claude va dentro** del instalador, como dependencia del SDK, fuera del `asar`. Si faltara, se usa el `claude` que el usuario tenga en el `PATH`. El usuario se encarga de confirmar que los términos de Anthropic lo permiten para su caso.
3. **Licencia MIT**, © Nicolas Corta Avila (el `LICENSE` llegó con SPEC-094). Solo cubre el código del Orquestador; cada dependencia conserva la suya, y el SDK de Claude, la de Anthropic («All rights reserved», sujeto a sus acuerdos). Todo eso va en `THIRD_PARTY_NOTICES.txt`.
4. **Datos.** La app se llama `Orquestador`, y su carpeta de datos pasa de `@orquestador/desktop` a `Orquestador` (`%APPDATA%` en Windows, `~/.config` en Linux, `~/Library/Application Support` en macOS), con una migración única de lo nuestro.
5. **Releases en GitHub.** Una etiqueta `vX.Y.Z` construye las tres plataformas y publica una release con los instaladores.
   - *Primera:* nombres con la versión (`Orquestador-0.9.0-Setup.exe`).
   - *Revisión:* la web necesita enlaces fijos, y `releases/latest/download/<nombre>` solo funciona si el nombre no cambia.
   - *Segunda (elegida):* **nombres fijos por plataforma**: `Orquestador-Windows-x64.exe`, `Orquestador-Linux-x86_64.AppImage`, `Orquestador-macOS-arm64.dmg` y `Orquestador-macOS-x64.dmg`. La versión va en la propia release y dentro de la app.
6. **Firma.** Sin firma, Windows enseña SmartScreen y macOS bloquea la app con Gatekeeper. La CI firma y notariza **si existen los secretos** (certificado de Windows; Apple ID, contraseña de app y equipo para macOS). Si no, publica sin firmar y la release lo dice.

## Requisitos

### Datos
- **R91.1** [M17a] La app fija su nombre a `Orquestador` antes de usar la carpeta de datos, salvo en modo prueba (SPEC-082).
- **R91.2** [M17a] `migrateDataFolder(appData)`: si `Orquestador` no tiene `config/` y `@orquestador/desktop` sí, copia `config/`, `assistant/`, `trust/`, `trust.json` y `logs/`. No toca la carpeta antigua, no copia cachés de Chromium ni `spaces/`, y solo se hace una vez.

### Paquete
- **R91.3** [M17a] `apps/desktop/package.json` lleva:
  - `productName: Orquestador`, versión `0.9.0`, la licencia MIT y el autor;
  - como `dependencies`, lo que se carga en tiempo de ejecución fuera del bundle, con versiones exactas: el SDK de Claude, sus dependencias *peer* (`@anthropic-ai/sdk`, `@modelcontextprotocol/sdk`, `zod`) y `@lydell/node-pty`;
  - además, los `@orquestador/*` que importa (la matriz de SPEC-056 lo exige). Van dentro del bundle y se quitan del `package.json` empaquetado.
- **R91.4** [M17a] `apps/desktop/electron-builder.json`:
  - `appId: com.fixerfox.orquestador`, coincidiendo con el AppUserModelId;
  - `asar` con `asarUnpack` del SDK de Claude (todas sus variantes de plataforma) y de node-pty;
  - `LICENSE`, `THIRD_PARTY_NOTICES.txt` e `icon.png` en los recursos;
  - Windows: NSIS x64, por usuario, eligiendo la carpeta;
  - Linux: AppImage x64, categoría `Development`, ejecutable `orquestador`;
  - macOS: dmg para arm64 y x64, categoría `public.app-category.developer-tools`, con `hardenedRuntime` y los permisos (*entitlements*) que necesita Electron para firmar y notarizar;
  - los nombres fijos de la decisión 5.
- **R91.5** [M17a] `npm run dist` compila en modo release, genera los avisos, instala las dependencias de la app (`--omit=dev`) y construye el paquete del sistema actual en `release/`.

### Binario de Claude
- **R91.6** [M17a] `resolveClaudeExecutable` busca `@anthropic-ai/claude-agent-sdk-<sistema>-<arquitectura>/claude[.exe]` (en Linux también la variante musl, como el SDK). Dentro de un paquete, cambia `app.asar` por `app.asar.unpacked`. Si no existe, busca `claude` en el `PATH` (con `PATHEXT` en Windows). Si tampoco, no hay ruta.
- **R91.7** [M17a] Las consultas al SDK usan esa ruta (`pathToClaudeCodeExecutable`) salvo que se pase otra.
- **R91.17** [M17a] Las terminales integradas añaden la carpeta de ese binario al final del `PATH` (en Windows, la variable se llame `PATH` o `Path`). Así, sin Claude instalado se usa el del paquete, y con él, el del usuario.

### Compilación de release
- **R91.8** [M17a] `build-desktop.mjs --release` compila sin sourcemaps y con `__ORQ_TEST_MCP__ = false`. Así el código del modo prueba no entra en `main.cjs`, que se carga por `import()` solo si la constante lo permite. La compilación normal lo sigue incluyendo.
- **R91.9** [M17a] Empaquetada, la ventana no tiene DevTools (`devTools: !app.isPackaged`).

### Versión y avisos
- **R91.10** [M17a] `scripts/notices.mjs` genera `THIRD_PARTY_NOTICES.txt` con cada paquete de producción (nombre, versión, licencia y su texto), más las fuentes Geist (OFL) y Spec Kit (MIT), que van dentro del bundle.
- **R91.11** [M17a] Los ajustes que ve la interfaz traen `app` (versión, sistema y arquitectura), que no se guarda. Ajustes enseña «Orquestador <versión>» y la licencia al pie de Apariencia.

### Cada sistema
- **R91.12** [M17a] La terminal externa:
  - en Linux prueba, en orden, `$TERMINAL`, `x-terminal-emulator`, `gnome-terminal`, `konsole`, `xfce4-terminal` y `xterm`, y usa la primera que arranca;
  - en macOS abre Terminal.app.
- **R91.13** [M17a] El icono que Windows registra para los avisos sale de los recursos del paquete (fuera del `asar`) cuando está empaquetada.

### Prueba de humo y releases
- **R91.14** [M17a] Con `--smoke`, la app arranca sin pedir la instancia única, espera a que cargue la ventana y comprueba que la carpeta de datos se puede escribir, que encuentra el binario de Claude y que arranca (`--version`), y que node-pty se carga. Escribe `ORQ_SMOKE {…}` con el resultado y sale con 0 si todo está bien, o con 1 si no.
- **R91.15** [M17a] La CI tiene un flujo `release`, que se lanza con una etiqueta `v*` o a mano:
  - construye en Windows, Linux y macOS;
  - ejecuta la prueba de humo con lo empaquetado (en Linux con `xvfb-run`);
  - con una etiqueta, crea la release de GitHub con los instaladores de nombre fijo; a mano, solo los guarda como artefactos;
  - una etiqueta con guion (`v0.9.0-rc.1`) se publica como *pre-release*, para probar sin cambiar los enlaces de `latest`.
- **R91.16** [M17a] La firma y la notarización se activan solas si existen sus secretos (`CSC_LINK`/`CSC_KEY_PASSWORD`, `APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID`). Si faltan, la release dice que va sin firmar.

## Casos
- **E91.a** *Dado* un usuario con datos en `%APPDATA%\@orquestador\desktop`, *cuando* arranca la versión empaquetada, *entonces* sus ajustes, su clave cifrada y sus recientes siguen ahí.
- **E91.b** *Dado* el AppImage en un Linux sin Node, *cuando* se ejecuta con `--smoke`, *entonces* sale con 0.
- **E91.c** *Dado* la etiqueta `v0.9.0`, *cuando* termina el flujo `release`, *entonces* `…/releases/latest/download/Orquestador-Windows-x64.exe` descarga el instalador de esa versión.
