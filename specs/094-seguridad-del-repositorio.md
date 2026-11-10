# SPEC-094 · Seguridad del repositorio

**Estado:** Implementada · **Hito:** M17b · **Paquetes:** repositorio (`.github/`, `scripts/`) · **Rama:** `chore/seguridad-repo`

## Propósito
El repositorio va a ser público con licencia MIT. Antes hay que cerrar cómo entra el código:
- solo el dueño (`@Fixerfox`) aprueba los PR;
- los PR van a `develop`, y a `main` solo desde `develop`;
- `develop` y `main` no se pueden borrar ni reescribir.

## Decisiones (10/11/2026, del usuario)
1. **Un solo aprobador.** `CODEOWNERS` asigna todo a `@Fixerfox` y las reglas piden su aprobación. GitHub no deja aprobar tu propio PR, así que el administrador del repo puede fusionar sus PR sin aprobación, pero siempre con PR (nunca con push directo).
2. **El flujo de ramas es una comprobación obligatoria.** GitHub no puede limitar la rama de origen de un PR, así que lo comprueba el workflow `flujo-de-ramas`. Corre con `pull_request_target`: el código de la comprobación sale de la rama destino, y un PR no puede cambiarlo para saltársela.
3. **Las reglas viven en el repo.** Los rulesets están en `.github/rulesets/*.json` y se aplican con `scripts/repo-security.ps1`. Una regla que no está en el repo no existe.
4. **Licencia MIT.**

## Requisitos
- **R94.1** [M17b] `.github/CODEOWNERS` asigna todos los archivos a `@Fixerfox` y solo a él.
- **R94.2** [M17b] Un PR a `develop` se acepta desde cualquier rama, también desde un fork.
- **R94.3** [M17b] Un PR a `main` solo se acepta si su rama de origen es `develop` del propio repositorio. Desde cualquier otra rama, o desde un fork, falla y dice por qué.
- **R94.4** [M17b] Un PR a cualquier otra rama falla y dice que los PR van a `develop`.
- **R94.5** [M17b] El workflow `flujo-de-ramas` corre con `pull_request_target`, no descarga código del PR y lee las ramas solo desde variables de entorno (nunca interpoladas en el script del paso).
- **R94.6** [M17b] Ruleset `ramas-protegidas`: `main` y `develop` no se pueden borrar ni recibir force-push. Nadie lo salta.
- **R94.7** [M17b] Ruleset `flujo-de-ramas`: en `main` y `develop` se exige la comprobación `flujo-de-ramas` de GitHub Actions. Nadie lo salta.
- **R94.8** [M17b] Ruleset `revision-del-dueno`: en `main` y `develop` todo cambio entra por PR con una aprobación del dueño del código, y un push nuevo anula la aprobación. Solo el administrador del repo lo salta, y solo fusionando un PR.
- **R94.9** [M17b] El repositorio tiene licencia MIT (`LICENSE`) y `package.json` la declara.

## Casos
- **E94.a** *Dado* un PR de `feature/x` a `main`, *entonces* `flujo-de-ramas` falla con «A main solo se llega desde develop».
- **E94.b** *Dado* un PR de `develop` a `main`, *entonces* `flujo-de-ramas` pasa y hace falta la aprobación de `@Fixerfox` (o que él lo fusione).
- **E94.c** *Dado* alguien con permiso de escritura que intenta borrar `develop`, *entonces* GitHub lo rechaza, también si es el administrador.

## Límites
- Los rulesets en repos privados necesitan un plan de pago. Por eso se aplican después de hacer público el repo.
- El dueño puede editar o desactivar los rulesets desde GitHub. Eso no se puede impedir.
