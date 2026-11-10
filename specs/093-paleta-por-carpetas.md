# SPEC-093 · La paleta del Diseñador por carpetas

**Estado:** Implementada · **Hito:** M17c · **Paquetes:** `ui` · **Rama:** `feature/paleta-carpetas`

## Propósito
En Conocimiento, las skills, los contextos y los MCP se ordenan en carpetas (SPEC-038, `library.json`). En la paleta del Diseñador, en cambio, salían todos seguidos y sin carpeta: con las de Spec Kit y las propias, la lista era larga y no se distinguía qué era cada cosa (petición del usuario, 10/11/2026).

## Decisiones (10/11/2026)
1. **Las mismas carpetas que en Conocimiento**, leídas de `library.json`. No hay otra organización que mantener.
2. **Cada carpeta se pliega y se despliega**, y el estado se recuerda como el resto de secciones de la paleta. Al buscar se despliega todo para ver los resultados.
3. **También contextos y MCP**, para que las tres secciones se comporten igual.

## Requisitos
- **R93.1** [M17c] La paleta recibe la carpeta de cada skill, contexto y MCP (de `getLibraryFolders`). Dentro de cada sección enseña primero lo que está en la raíz y después cada carpeta, ordenada por nombre, con su número de elementos. Las subcarpetas («Arte/Píxel») van sangradas bajo su carpeta.
- **R93.2** [M17c] Cada carpeta es un botón que la pliega o la despliega (`aria-expanded`). El estado se guarda con el de las demás secciones de la paleta. Las carpetas empiezan desplegadas.
- **R93.3** [M17c] Al escribir en el buscador, se despliegan todas las carpetas, y una carpeta sin elementos que coincidan no se enseña.
- **R93.4** [M17c] Si cambian las carpetas en Conocimiento, la paleta se pone al día al volver al Diseñador.
