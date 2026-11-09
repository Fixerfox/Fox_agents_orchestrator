# SPEC-083 · Los tokens de caché cuentan

**Estado:** Implementada · **Hito:** M16b · **Paquetes:** `claude`, `core`, `editor`, `ui` · **Rama:** `feature/modo-prueba-mcp`

## Propósito
En una prueba real con el modo prueba (SPEC-082), una ejecución que costó 0,30 $ marcaba «26 tokens de entrada». El adaptador de Claude solo sumaba `input_tokens`, y Claude Code lee casi toda la entrada de la caché de prompts (`cache_read_input_tokens`) o la escribe en ella (`cache_creation_input_tokens`). Esos tokens no se contaban.

Consecuencias:
- los tokens que enseña la app no se parecen a lo que procesa Claude;
- el límite de tokens de una ejecución (SPEC-007, SPEC-077) casi no frena nada, porque solo ve la salida.

## Decisiones (09/11/2026)
1. **Qué cuenta como entrada.**
   - *Primera:* contar solo los tokens nuevos y los escritos en caché, porque los leídos de caché son mucho más baratos.
   - *Revisión:* el número seguiría sin ser lo que procesa Claude, y el criterio «qué es barato» ya lo da el coste.
   - *Segunda (elegida):* **la entrada es todo lo que lee Claude**: nuevos + escritos en caché + leídos de caché. El límite de tokens mide eso. Para limitar el dinero está el límite de coste de cada agente o paso.
2. **Dónde se arregla.** En el traductor de mensajes del SDK (`MessageMapper`): por él pasan los agentes, las decisiones (enrutador, evaluador, revisión, Supervisor) y el asistente. El núcleo no cambia de contrato.
3. **Transparencia.** Lo leído de caché va aparte en el evento de uso (`cachedTokens`), para que los registros expliquen por qué la entrada es tan grande.

## Requisitos
- **R83.1** [M16b] `MessageMapper` emite el uso de un resultado con `inputTokens = input_tokens + cache_creation_input_tokens + cache_read_input_tokens` (los que falten cuentan 0), tanto en un resultado correcto como en uno con error.
- **R83.2** [M16b] Si `cache_read_input_tokens` es mayor que 0, el uso lleva también `cachedTokens` con esa cifra (ya incluida en `inputTokens`). El evento `agent.usage` de un paso de agente lo copia.
- **R83.3** [M16b] El límite de tokens de la ejecución suma `inputTokens + outputTokens` de R83.1: con un agente que lee 1.000 tokens de caché y un límite de 500, la ejecución se para por presupuesto.
- **R83.4** [M16b] En Ajustes, el campo «Límite de tokens por defecto» explica que cuenta todo lo que lee Claude, también lo que sale de la caché, y que para limitar el gasto conviene el límite de coste del agente o del paso.

## Casos
- **E83.a** *Dado* un resultado del SDK con `input_tokens: 26`, `cache_creation_input_tokens: 4000`, `cache_read_input_tokens: 90000` y `output_tokens: 900`, *entonces* el uso es `inputTokens: 94026`, `outputTokens: 900`, `cachedTokens: 90000`.
