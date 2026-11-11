# SPEC-099 · Control de versiones: PR y MR de GitHub y GitLab

**Estado:** Implementada · **Hito:** M18d · **Paquetes:** `core`, `git`, `runtime`, `editor`, `ui`, `apps/desktop` · **Rama:** `feature/versiones-remoto`

## Propósito
El visor de SPEC-098 enseña el git local. Falta la parte que el usuario pidió con nombre (11/11/2026): **GitHub y GitLab**. Esta spec añade al visor las revisiones (PR en GitHub, MR en GitLab) con su estado y sus comprobaciones, y deja abrir una desde el visor y desde el asistente.

## Decisiones (11/11/2026)
1. **Cómo se conecta.**
   - *Primera:* guardar un token en la app y llamar siempre a las API.
   - *Revisión:* quien ya usa `gh` o `glab` tendría que dar de alta otro secreto, y es uno más que custodiar.
   - *Segunda (elegida):* **primero el CLI** (`gh` o `glab`) si está instalado y con sesión para ese servidor; **si no, un token** guardado cifrado, que nunca llega a la interfaz ni a Claude. Sin ninguno, el visor explica las dos formas de conectar.
2. **A quién se manda el token.**
   - *Primera:* a la API del proveedor detectado.
   - *Revisión:* un `origin` manipulado podría apuntar a un servidor cualquiera y llevarse el token.
   - *Segunda (elegida):* el token se guarda **por servidor** (el de `origin` en ese momento) y solo se envía, por HTTPS, a ese mismo servidor. Si `origin` cambia de servidor, hay que dar otro.
3. **Qué proveedor es.**
   - *Primera:* solo `github.com` y `gitlab.com`.
   - *Revisión:* deja fuera GitHub Enterprise y los GitLab propios, que son lo habitual en empresas.
   - *Segunda (elegida):* por el nombre del servidor: `github.com` o que contenga «github» es GitHub; que contenga «gitlab» es GitLab. Otro servidor no tiene revisiones en el visor.
4. **Comprobaciones.**
   - *Primera:* pedir el detalle de cada comprobación de cada revisión.
   - *Revisión:* son muchas llamadas para una lista.
   - *Segunda (elegida):* un resumen por revisión (pasan, fallan, en marcha y cuántas), y por la API solo de las abiertas y hasta diez.
5. **Abrir una revisión.** Es una acción hacia fuera: en el visor es un formulario que se envía a mano; el asistente pide permiso siempre, como al subir.

## Requisitos

### Saber dónde está el repositorio
- **R99.1** [M18d] `parseRemoteUrl` lee la dirección de `origin` (HTTPS, SSH `git@servidor:ruta` y `ssh://`, con o sin `.git` y sin las credenciales que lleve) y da el proveedor, el servidor, la ruta completa del proyecto (con subgrupos en GitLab) y su nombre. Una dirección que no entiende, o de otro servidor, no da nada. `GitCli.remoteUrl()` da la dirección de `origin`, o nada si no hay.
- **R99.2** [M18d] `reviewWord` dice «PR» para GitHub y «MR» para GitLab. `defaultReviewBase` propone como destino `develop` si existe y, si no, `main`, `master` o `trunk`; nunca la propia rama.

### Leer y abrir revisiones
- **R99.3** [M18d] El puerto `ReviewHost` lista las revisiones (número, título, estado abierta, borrador, fusionada o cerrada, rama de origen y de destino, enlace y resumen de comprobaciones) y abre una nueva.
- **R99.4** [M18d] Con CLI: `gh pr list` y `gh pr create` para GitHub, `glab mr list` y `glab mr create` para GitLab, siempre con lista de argumentos y sin pedir nada por la terminal. `cliReady` dice si el CLI está instalado y con sesión para ese servidor.
- **R99.5** [M18d] Con token: la API REST de GitHub (`api.github.com`, o `/api/v3` del propio servidor) y la de GitLab (`/api/v4`). El token solo viaja en la cabecera, por HTTPS, y al servidor de `origin`. Un error de la API se explica sin incluir el token.
- **R99.6** [M18d] El enlace de una revisión solo se acepta si es `https` y tiene forma de PR o MR; si no, la revisión se enseña sin enlace.

### Conectar
- **R99.7** [M18d] `connectReviewHost` elige el CLI si está listo, si no el token guardado para ese servidor, y si no hay ninguno dice que no está conectado. `GitService.reviews()` devuelve el proveedor, el proyecto, cómo está conectado (`cli`, `token` o nada) y las revisiones; `null` si no hay `origin` o no es GitHub ni GitLab. Si la lista falla, devuelve el motivo y ninguna revisión.
- **R99.8** [M18d] `setReviewToken` guarda el token cifrado para el servidor de `origin` y `clearReviewToken` lo quita. El token no vuelve nunca a la interfaz: solo se sabe si hay uno.
- **R99.9** [M18d] `GitService.createReview` comprueba antes de llamar fuera: hay que estar conectado, tener título, que origen y destino sean ramas distintas, y que la rama de origen esté subida. Devuelve la revisión creada.

### Contrato e interfaz
- **R99.10** [M18d] El contrato ofrece `gitReviews`, `gitCreateReview`, `setReviewToken` y `clearReviewToken`, y los valida: título con tope, ramas con nombres como los de git, token de una línea y con tope, sin campos de más.
- **R99.11** [M18d] En «Versiones», cada rama con una revisión abierta lleva su número. A la derecha, el bloque de la revisión de la rama actual enseña su título, estado, destino, comprobaciones y el enlace, que se abre en el navegador.
- **R99.12** [M18d] Si la rama actual no tiene revisión y está subida, «Abrir PR» (o «Abrir MR») enseña un formulario con título (por defecto, el del último commit), descripción, destino y «Borrador». Al crearla aparece su bloque. En una rama protegida o sin subir, el botón está apagado y dice por qué.
- **R99.13** [M18d] Sin conexión, el bloque explica las dos formas (iniciar sesión con el CLI o pegar un token) y tiene el campo del token, de tipo contraseña. Conectado con token, se puede quitar. Sin `origin` de GitHub o GitLab, el bloque no aparece.

### Asistente
- **R99.14** [M18d] El asistente tiene `git_list_reviews` (no pide permiso) y `git_create_review` (pide permiso siempre). Usan las mismas comprobaciones que el visor, y crear deja en el chat «Ha abierto la PR #N hacia <destino>» con su enlace en el resultado.

## Escenarios
- **E99.a** *Dado* `gh` con sesión y la rama `feature/menu` subida, *cuando* se pulsa «Abrir PR» y se envía, *entonces* aparece «#31 · Menú · Abierta · 3 de 3 comprobaciones» con su enlace, y la rama lleva «#31» en la lista.
- **E99.b** *Dado* un GitLab propio sin `glab`, *cuando* se pega un token, *entonces* se ven sus MR, y el token solo se ha enviado a ese servidor.
- **E99.c** *Dado* el asistente con «sube esto y abre la PR», *entonces* pide permiso para subir y otra vez para abrir la PR.

## Limitaciones
- Solo se mira `origin`. Un *fork* con `upstream` aparte no se entiende.
- Se enseñan las 50 revisiones más recientes.
- Las comprobaciones son un resumen: para el detalle se abre el enlace. En GitLab con token es el estado del último *pipeline*; con `glab`, solo si la lista lo trae.
- Los comandos de `gh` están comprobados contra su ayuda (2.89); los de `glab` no se han podido ejecutar al escribir esto, solo están probados con dobles.
- Al volver a la ventana, las revisiones se vuelven a pedir como mucho una vez por minuto.
- Bitbucket y Azure DevOps no están; el puerto `ReviewHost` los admite más adelante.

## Fuera de alcance
- Fusionar, cerrar o comentar una revisión desde la app.
- Revisar los cambios de una PR línea a línea.
- Avisos cuando una comprobación falla.
