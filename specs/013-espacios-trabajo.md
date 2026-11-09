# SPEC-013 · Espacios de trabajo aislados

**Estado:** Implementada (gestor; integración con el orquestador en M4) · **Hito:** M3b · **Paquete:** `workspace`

> **Nota (08/11/2026):** el gestor nunca llegó a conectarse al orquestador. La integración, y los cambios a R13.1–R13.3, están en [SPEC-073](073-ramas-aisladas-y-fusion.md).

## Propósito
Evitar que agentes en paralelo se pisen los archivos del proyecto, fusionar al terminar y conservar instantáneas por iteración de bucle.

## Requisitos
- **R13.1** [M3b] Cada agente que puede editar trabaja en un espacio aislado: `git worktree` si el proyecto es un repositorio git; si no, copia temporal.
- **R13.2** [M3b] Al terminar, los cambios se fusionan en el proyecto en orden de finalización y se emite `workspace.merged` con los archivos afectados.
- **R13.3** [M3b] Si dos agentes tocaron el mismo archivo con cambios incompatibles se emite `workspace.conflict`, se conservan ambas versiones y la ejecución queda «requiere atención».
- **R13.4** [M3b] Los agentes de solo lectura no necesitan espacio aislado.
- **R13.5** [M3b] Cada vuelta de un bucle guarda una instantánea en `runs/<runId>/iterations/<bucle>/<n>/` y emite `iteration.snapshot`; se puede recuperar una vuelta anterior.
- **R13.6** [M3b] Los archivos producidos se registran con `file.produced` y se copian a `runs/<runId>/output/`.
- **R13.7** [M3b] Los espacios temporales se limpian al terminar o cancelar, también tras un cierre inesperado (limpieza al arrancar).
- **R13.8** [M3b] Cuando el proyecto sea grande y no sea un repositorio git, se avisa del coste de la copia y se permite limitar lo que se copia.
