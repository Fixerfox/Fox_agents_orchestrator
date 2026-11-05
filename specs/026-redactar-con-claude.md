# SPEC-026 · Redactar agentes y skills con ayuda de Claude

**Estado:** Implementada · **Hito:** M6c · **Paquetes:** `core`, `editor`, `ui`, `desktop`

## Propósito
Describir en lenguaje natural lo que se quiere y que Claude proponga el agente o la skill, o mejore uno existente. Necesita el adaptador real de Claude (M6) y las credenciales de Ajustes.

## Requisitos
- **R26.1** [M6c] Los formularios de agente y de skill tienen «Redactar con Claude»: el usuario describe lo que quiere y Claude propone todos los campos (para un agente: nombre, descripción, instrucciones, modelo y sugerencias de contextos y skills existentes; para una skill: nombre, descripción y contenido; para un contexto de texto: nombre y texto).
- **R26.2** [M6c] La propuesta se muestra como borrador editable; no se guarda nada hasta que el usuario pulsa «Guardar». Se puede rechazar o pedir otra versión con una indicación.
- **R26.3** [M6c] «Mejorar con Claude» parte del agente o skill actual y una indicación («hazlo más estricto») y muestra los cambios antes de aplicarlos.
- **R26.4** [M6c] Solo se envía a Claude lo que el usuario ha escrito y el borrador actual, más los nombres y descripciones de contextos y skills del proyecto; nunca archivos ni la clave API.
- **R26.5** [M6c] Usa la conexión y el modelo de Ajustes y muestra cuánto ha tardado; si falla, el error se explica y el formulario no pierde lo escrito.
- **R26.6** [M6c] La respuesta de Claude se valida con las mismas reglas que un alta manual antes de mostrarla; lo que no pase se corrige o se señala campo a campo.
- **R26.7** [M6c] El contrato IPC ofrece un único canal para pedir la propuesta; valida el tipo, la indicación (1–4000 caracteres) y los campos del borrador, y rechaza campos extra. La propuesta solo conserva campos conocidos, ids de contextos y skills que existen y modelos de la lista.
