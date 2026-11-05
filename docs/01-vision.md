# 01 · Visión y alcance

## Problema
Coordinar varios agentes de IA hoy exige scripts y terminales. Es difícil ver quién hace qué, reutilizar skills y contextos, y depurar un flujo que falla.

## Propuesta
Un editor visual de diagramas donde cada **nodo es un agente** y cada **arista es un flujo de tareas o contexto**, con una vista de ejecución en vivo.

## Usuarios
Desarrolladores y creadores que ya usan agentes (Claude, otros proveedores, modelos locales) y quieren componerlos visualmente.

## Capacidades objetivo
1. **Diseñar** diagramas de agentes (nodos, aristas, grupos).
2. **Asignar** a cada agente: tareas, skills y contextos.
3. **Ejecutar** el diagrama y **observar** en tiempo real: estado, herramientas llamadas, salida en streaming, errores, coste/tokens.
4. **Persistir** diagramas (JSON versionable) e historial de ejecuciones.
5. **Reproducir** una ejecución pasada (replay) a partir de sus eventos.

## Fuera de alcance (v1)
- Colaboración multiusuario en red.
- Marketplace de skills.
- Entrenamiento o fine-tuning de modelos.

## Criterios de éxito del MVP
- Crear un diagrama de 3 agentes, ejecutarlo con agentes simulados y ver su estado en vivo.
- Guardar, cerrar y reabrir el diagrama sin pérdida.
- Todos los tests del MVP pasan en CI local.
