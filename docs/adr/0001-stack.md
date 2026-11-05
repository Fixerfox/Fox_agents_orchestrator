# ADR-0001 · Stack tecnológico

- **Estado:** aceptada (2026-11-04)
- **Decisión:** TypeScript + Electron + React + React Flow; Python solo como sidecar opcional.
- **Contexto:** el núcleo del producto es visual (diagramas, tiempo real) y de escritorio en Windows.
- **Alternativas:** Tauri (más ligero, añade Rust); Python puro con PySide6 (UI de grafos más limitada); híbrido TS+Python.
- **Consecuencias:** un solo lenguaje en el núcleo, mejor editor de grafos, tests con Vitest/Playwright. Coste: Electron pesa más. Se reevaluará Tauri si el tamaño es un problema.
- **Actualización:** el motor es Claude Code vía Claude Agent SDK (TypeScript), por lo que el sidecar Python no es necesario por ahora. Plataformas v1: Windows y Linux.
