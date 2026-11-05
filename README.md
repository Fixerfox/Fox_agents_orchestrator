# Orquestador

Aplicación de escritorio para **orquestar agentes de IA de forma visual**: se diseñan flujos como diagramas, se asignan tareas, skills y contextos a cada agente y se observa en tiempo real qué hace cada uno.

- Reglas de trabajo y decisiones de stack: [`CLAUDE.md`](CLAUDE.md)
- **Specs** (desarrollo guiado por especificaciones): [`specs/`](specs/README.md)
- Documentación: [`docs/`](docs/)
  - [01 Visión y alcance](docs/01-vision.md)
  - [02 Arquitectura](docs/02-arquitectura.md)
  - [03 Modelo de dominio](docs/03-modelo-dominio.md)
  - [04 Catálogo de eventos](docs/04-eventos.md)
  - [05 Estrategia de tests](docs/05-tests.md)
  - [06 Roadmap](docs/06-roadmap.md)
  - [ADR-0001 Stack](docs/adr/0001-stack.md)

## Cómo empezar
Requiere Node.js 22 o superior.

```bash
npm install        # instala dependencias (hazlo en tu equipo; no se versionan)
npm run check      # tipos + lint + tests + trazabilidad spec → test
npm test           # solo los tests
npm run spec:check # cada requisito del hito en curso debe tener test
```

## Estado
- M0 (cimientos) y M1 (dominio: validación, bus de eventos, orquestador, bucles, subdiagramas, preguntas de agentes, logs) en `packages/core`.
- M2 (persistencia y logs en disco) en `packages/store`: proyectos con `.orquestador/`, documentos versionados con migración, escritura atómica, `events.jsonl` incremental por ejecución, listado, retención.
- M3 (editor visual): `packages/editor` (operaciones puras, historial, validación en español, plantillas de ejemplo, contrato IPC), `packages/ui` (React + React Flow) y `apps/desktop` (Electron: ventana aislada, CSP, IPC validado).
- M3b: `packages/workspace` (espacio aislado por agente con git worktree o copia, fusión con conflictos, instantáneas por iteración, archivos producidos).
- M4: `packages/runtime` (servicio de ejecución, lotes de eventos, orquestador de demostración) y vista en vivo en `packages/ui` (estado de nodos, ruta, chat con el agente, registro, resultados). Sin el adapter de Claude (M6) la app ejecuta agentes simulados.
- M4c: interfaz visual (SPEC-021): tema claro, oscuro y automático, tipografía Geist, iconos (lucide), menú contextual con el botón derecho, galería de tarjetas para elegir agente, «En este diagrama», panel inferior con pestañas y paneles plegables. `npm run build:preview` genera una vista previa en navegador para revisarla con capturas.
- M5a: agentes y contextos del proyecto (SPEC-022: pantalla «Agentes», contextos de texto, web y archivo, galería con «Crear agente») y ajustes (SPEC-023: conexión con Claude, clave API cifrada con el almacén del sistema, modelo, paralelismo, límite de tokens y tema).
- M5b: skills del proyecto (SPEC-024: `SKILL.md` en formato Claude Code, pestaña «Skills», asignación a agentes) e instalación de agentes y skills desde una carpeta o un Zip (SPEC-025) con pantalla de revisión previa. «Redactar con Claude» está diseñado (SPEC-026) y llega con M6.
- 638 tests; 252 requisitos de M1–M6e cubiertos (`npm run check`).
- Arrancar la app en Windows: doble clic en `iniciar.bat` (instala la primera vez). O a mano: `npm install` y `npm run start:desktop` (compila con esbuild y abre Electron).
- Siguiente: contexto configurable por proyecto y por agente (parte de M5), después el adapter de Claude (M6).
