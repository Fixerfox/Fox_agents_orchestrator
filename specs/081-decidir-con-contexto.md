# SPEC-081 · Decidir con contexto

**Estado:** Implementada · **Hito:** M15l · **Paquetes:** `core`, `claude`, `editor`, `ui` · **Rama:** `feature/sitio-en-el-flujo`

## Propósito
SPEC-080 cuenta a cada agente lo que viene después. Quedan dos piezas que deciden el camino con menos contexto del que hay:
- **El router con IA elige casi a ciegas.** De cada opción solo recibe el nombre del nodo destino (`RouteCandidate.label`). Con «Arreglar» y «Publicar» se apaña; con «Paso 2» y «Paso 3» elige al azar. Además no hay dónde escribirle un criterio: `RouterConfig` solo tiene `mode`.
- **En una revisión `verdict`, el agente que revisa no sabe que tiene que escribir `VEREDICTO:`.** Depende de que la persona lo ponga en sus instrucciones. Si no lo pone, decide siempre el Juez (R34.26), que cuesta una consulta más y no ha visto el trabajo como el revisor.

## Decisiones (09/11/2026)
1. **Qué sabe el router de cada opción.**
   - *Primera:* el nombre del nodo y el de su agente.
   - *Revisión:* el nombre del agente dice poco; lo que distingue una opción de otra es la tarea del paso.
   - *Segunda (elegida):* **la misma descripción que SPEC-080 da a un agente de su destino** (agente y tarea; criterio de una revisión; formato de transformar; salida), con una sola función para los dos casos.
2. **El criterio del router.** Es un campo opcional del nodo (`router.criteria`), como el criterio de una revisión. Va como instrucción, no como datos: lo escribe la persona.
3. **A quién se le dice que escriba `VEREDICTO:`.**
   - *Primera:* a todo paso cuya salida vaya a una revisión `verdict`.
   - *Revisión:* si el que hace el trabajo va directo a la revisión, se aprobaría a sí mismo (por eso SPEC-080 no lo dice).
   - *Segunda (elegida):* **solo a quien está en el tramo del retorno sin ser su destino.** En `prog → qa → Revisión (✗ → prog)`, *qa* escribe el veredicto y *prog* no sabe nada de él. Sin retorno, o si el paso es el destino del retorno, no se dice.

## Requisitos

### Router con IA
- **R81.1** [M15l] `RouterConfig.criteria?` es un texto opcional. El panel del router lo ofrece solo en modo IA como «Criterio para elegir». Vacío o en blanco, no se guarda.
- **R81.2** [M15l] Con `flow` activo (R80.10), cada `RouteCandidate` lleva `description`: la misma descripción del destino que da «Tu sitio en el flujo» (R80.2), sin el guion inicial (`describeTarget`). Sin `flow`, los candidatos no cambian, y por eso no cambian las grabaciones de SPEC-056.
- **R81.3** [M15l] Si el router tiene criterio, la petición de `route` lo lleva (`criteria`), también sin `flow`. Las dos cosas quedan en el evento `decision` (`request.candidates` y `request.criteria`).
- **R81.4** [M15l] El decisor de Claude escribe cada opción con su descripción, o con su nombre si no la tiene, y, si hay criterio, una línea «Criterio para elegir: …» antes de los datos.
- **R81.5** [M15l] El texto «Claude verá» del panel del router dice que verá cada paso siguiente con su agente y su tarea, y el criterio si lo hay.

### Veredicto escrito
- **R81.6** [M15l] En «Tu sitio en el flujo», si un destino directo es una revisión en modo `verdict` con retorno, y el paso está en el tramo de ese retorno sin ser su destino, se añade: «Esa revisión lee tu veredicto: termina tu respuesta con una línea «VEREDICTO: APROBADO» o «VEREDICTO: RECHAZADO». Si rechazas, explica qué hay que corregir: es lo que recibirá «destino».».
- **R81.7** [M15l] Al destino del retorno, a un paso que va a una revisión sin retorno y a uno que va a una revisión en modo `ai` o `human` no se les dice nada del veredicto.

## Escenarios
- **E81.a** *Dado* un router con IA cuyas opciones son «Paso 2» (agente Fixer, tarea «Corrige los tests en rojo») y «Paso 3» (la salida), con criterio «Si hay tests en rojo, a arreglar», *entonces* el decisor recibe las dos descripciones y el criterio, y el evento `decision` los guarda.
- **E81.b** *Dado* `prog → qa → Revisión verdict (✗ → prog)`, *entonces* qa recibe la línea de R81.6 y prog no.
- **E81.c** *Dado* un orquestador sin `flow`, *entonces* los candidatos del router no llevan `description`.

## Fuera de alcance
- Un criterio por conexión en modo IA (las condiciones de las conexiones siguen siendo del modo reglas).
- Mostrar en el lienzo el criterio del router.
