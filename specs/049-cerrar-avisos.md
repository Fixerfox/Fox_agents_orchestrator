# SPEC-049 · Cerrar los avisos de error

**Estado:** Implementada (M8g) · **Hito:** M8g · **Paquetes:** `editor` (i18n), `ui`

## Propósito
El usuario indicó el 05/11 que los avisos de error de la barra roja superior (p. ej. «"X" lo está usando una ejecución en curso…») no se podían cerrar: se quedaban hasta que otra acción los borraba.

## Decisiones (05/11/2026)
1. **Primera propuesta:** que el aviso se oculte solo a los pocos segundos.
   - **Revisión:** un error largo puede desaparecer antes de leerlo, y un lector de pantalla puede perderlo.
2. **Segunda propuesta (elegida):** un botón «Cerrar aviso» (icono ×) a la derecha del aviso. El aviso no desaparece solo.
   - **Revisión:** si el mismo error vuelve a ocurrir después de cerrarlo, debe volver a mostrarse; como cerrar deja el mensaje vacío, el siguiente `fail` lo muestra de nuevo sin más lógica.

## Requisitos
- **R49.1** [M8g] El aviso de error (`role="alert"`) lleva un botón «Cerrar aviso» que lo quita al pulsarlo; si el error vuelve a ocurrir, el aviso aparece otra vez.

## Fuera de alcance
- Cola o historial de avisos.
