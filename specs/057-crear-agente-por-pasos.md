# SPEC-057 · Crear un agente por pasos

**Estado:** Implementada (M8g) · **Hito:** M8g · **Paquetes:** `editor`, `ui` · **Rama:** `feature/Create-Agent`

## Propósito
«Nuevo agente» abría un formulario largo con todo a la vez (nombre, instrucciones, conocimiento, supervisión, permisos y modelo), mientras que «Nueva skill», «Nuevo contexto» y «Nuevo servidor MCP» empiezan con una bienvenida que pone al asistente por delante. El usuario pidió (05/11) que crear un agente siga ese mismo estilo y que vaya **por pasos en vez de poner todo a la vez**.

Diseños: lienzo «Orquestador · Nuevo agente» (prototipos A, B y D; el C, «el asistente propone la ficha», queda descartado).

## Decisiones (05/11/2026)
1. *Primera:* pasos también para editar un agente que ya existe. *Revisión:* cambiar solo el modelo obligaría a recorrer cuatro pantallas. *Segunda (elegida):* **pasos solo al crear**; un agente guardado se edita en una **ficha por secciones** (una cada vez, con un índice a la izquierda para saltar a cualquiera).
2. La bienvenida reutiliza `CreateWelcome` (la de skills, contextos y MCP). Describirlo o elegir una idea **no abre el chat del asistente**: abre los pasos y el asistente rellena el paso 1 ahí mismo con «Redactar con Claude» (SPEC-026), que ya devuelve nombre, para qué sirve, instrucciones, modelo, skills y contextos.
3. «Guardar» y Ctrl+S siguen valiendo en cualquier paso. Un error al guardar lleva al paso del campo que falla. El borrador se conserva al salir, como en el resto de la biblioteca (R32.34).
4. Fuera de esta versión: «Duplicar uno» en la bienvenida y elegir si el agente es del proyecto o de todos los proyectos.

## Requisitos
- **R57.1** [M8g] «Nuevo» en Agentes, sin borrador pendiente, muestra la bienvenida «¿Qué agente necesitas?»: campo para describirlo con «Empezar con el asistente», seis ideas (Implementador, Revisor de código, Pruebas, Diseñador web, Documentador, Investigador) y, a mano, «Escribir», «Instalar» y, si falta, «Spec Kit».
- **R57.2** [M8g] Describirlo o elegir una idea abre los pasos con esa descripción en «Para qué sirve». Con el motor Claude, el asistente redacta el agente (`draftWithClaude`, tipo `agent`) y rellena nombre, para qué sirve, instrucciones, modelo, skills y contextos; mientras tanto lo dice, y si falla lo dice y deja seguir a mano. Las skills y contextos que propuso salen como «Sugerido por el asistente» en el paso 2. Sin Claude, solo se rellena «Para qué sirve».
- **R57.3** [M8g] Un agente nuevo se crea en cuatro pasos: «Qué hace» (nombre, para qué sirve e instrucciones), «Qué sabe» (skills, contextos y MCP), «Qué puede hacer» (supervisión, permisos y modelo) y «Revisar». Arriba, los pasos numerados (el actual marcado con `aria-current="step"` y los hechos con ✓) se pueden pulsar; abajo, «Paso n de 4», «Atrás» y «Siguiente». Para pasar del primero hace falta un nombre. A la derecha se ve en todo momento cómo quedará (icono, nombre, para qué sirve, modelo y cuántas skills, contextos y MCP).
- **R57.4** [M8g] «Revisar» resume cada parte (qué hace, qué sabe, qué puede hacer y modelo) con «Cambiar», que lleva a su paso, y termina con «Crear agente», que lo guarda. Un error al guardar lleva al paso del campo que falla.
- **R57.5** [M8g] Un agente guardado se edita en una ficha con índice: «Qué hace», «Qué sabe», «Qué puede hacer», «Modelo y aspecto» y «Dónde se usa», cada uno con un resumen debajo (p. ej. «2 skills · 1 contexto · 1 MCP»). Se ve una sección cada vez; la activa lleva `aria-current="page"`.

## Fuera de alcance
- «Duplicar uno» desde la bienvenida (sigue en el menú del agente).
- Agentes de «Todos mis proyectos» desde la bienvenida.
