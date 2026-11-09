# SPEC-067 · Mejoras visuales (2): Ajustes por secciones

**Estado:** Implementada (M14) · **Hito:** M14 · **Paquetes:** `editor`, `ui` · **Rama:** `feature/mejoras-visuales`

## Propósito
El 08/11 el usuario pidió un rediseño completo de Ajustes. Entre tres propuestas del lienzo «Orquestador · Ajustes (rediseño)» eligió la **A: índice por ámbito con una sección cada vez**, y además la **C: los permisos como escala, con lo que pasará en cada nivel**.

Problemas de la página actual:
- Es una sola página larga, y el índice solo hace scroll.
- No se ve de un vistazo si Claude está conectado.
- «Reglas de los agentes» es un muro de ocho frases, lejos de los permisos de los que depende.
- Radios y casillas sueltas, sin jerarquía.
- «Probar conexión» queda perdido al final de la sección.

## Decisiones (08/11/2026)
1. **Grupos del índice.**
   - *Primera (la del prototipo A):* «Esta app» (Claude, Supervisor, Apariencia) y «Este proyecto» (Carpeta y permisos, Ejecución y presupuesto).
   - *Revisión:* en el código, los permisos, el paralelo y el límite de tokens se guardan en los ajustes de la app (`SettingsStore`, carpeta de datos de la app), no en el proyecto. Ponerlos bajo «Este proyecto» mentiría. Moverlos de sitio cambiaría los datos y queda fuera de una mejora visual.
   - *Segunda (elegida):* **«General»** reúne Claude, Permisos de los agentes, Supervisor, Ejecución y presupuesto y Apariencia. **«Este proyecto»** reúne la Carpeta de trabajo, la única que es del proyecto. Este grupo solo aparece con un proyecto abierto.
2. **Una sección cada vez**, como la ficha del agente (R57.5) y la ventana «Configurar» (R66.1). Cada entrada lleva un resumen.
3. **Estado de Claude arriba.**
   - Una tarjeta dice si no se ha probado, si se está probando, si responde (en verde) o si falla (en rojo), con «Probar conexión» al lado.
   - Con el motor simulado lo dice: no se conecta ni gasta.
   - No se prueba sola al abrir: probar gasta tokens.
4. **Las reglas van con los permisos.** «Reglas de los agentes» deja de ser una sección. Pasa a ser la lista «Así trabajan con este nivel», debajo del selector, y cambia al cambiar el nivel. Los permisos se ven siempre, también sin proyecto abierto, porque son generales.
5. **Permisos como escala (prototipo C).**
   - Los tres niveles van uno al lado del otro, como una escala de más prudente a menos.
   - Debajo, una tabla «Lo que pasará con cada nivel» cruza las acciones con los niveles y resalta el elegido. Las acciones son leer, crear, modificar, comandos sencillos, otros comandos, borrar, publicar fuera, salir de la carpeta con un comando y escribir fuera.
   - La tabla sale del editor (`permissionMatrix`), no de la interfaz, para que diga lo mismo que el motor:
     - «Preguntar» solo deja sin preguntar los comandos sencillos.
     - «Automático» pregunta antes de borrar, publicar o salir de la carpeta.
     - Ninguno de los dos escribe fuera de la carpeta.
     - «Sin preguntar nunca» lo hace todo.
   - La lista de reglas sigue debajo, para lo que la tabla no cuenta: «Cambios realizados», el registro y los permisos por agente.
6. **Opciones con consecuencias, en tarjetas:** el motor y la conexión llevan su explicación debajo. Los sí/no van en filas con interruptor.

## Requisitos
- **R67.1** [M14] Ajustes tiene a la izquierda un índice con dos grupos:
  - «General»: «Claude», «Permisos de los agentes», «Supervisor», «Ejecución y presupuesto» y «Apariencia».
  - «Este proyecto», solo con un proyecto abierto: «Carpeta de trabajo».

  Cada entrada lleva su resumen debajo. Se ve una sección cada vez, y la activa lleva `aria-current="page"`. Se abre en «Claude».
- **R67.2** [M14] «Claude» empieza por una tarjeta de estado con «Probar conexión». Sus estados son:
  - «Sin probar todavía».
  - «Probando la conexión…».
  - «Claude responde», con el mensaje de R27.11 como `status`.
  - «No se pudo conectar», con el motivo como `alert` (R27.12).
  - Con el motor simulado, avisa de que no se conecta ni gasta.
- **R67.3** [M14] El motor («Simulado» / «Claude (real)») y la conexión («Cuenta de Claude Code» / «Clave API») son tarjetas de opción con una explicación debajo. El modelo por defecto y «Cargar la configuración de Claude Code» son filas con el control a la derecha.
- **R67.4** [M14] «Permisos de los agentes» muestra el selector de nivel y, debajo, la lista «Reglas de los agentes» (R31.14, R47.7), que cambia con el nivel. Se ve aunque no haya proyecto abierto.
- **R67.6** [M14] En «Permisos de los agentes», los tres niveles se eligen como una escala horizontal. Debajo, la tabla «Lo que pasará con cada nivel» (`permissionMatrix`) indica, para cada acción y cada nivel, «Sí», «Pregunta» o «Nunca», y resalta la columna del nivel elegido.
- **R67.5** [M14] Al pie del índice está «Los cambios se guardan al momento». Mientras se guarda, o al terminar, se ve el estado.

## Cambia
- **R23.5, R31.14:** las secciones ya no se ven todas a la vez. «Reglas de los agentes» vive dentro de «Permisos de los agentes». «Presupuesto» pasa a llamarse «Ejecución y presupuesto».

## Fuera de alcance
- Llevar los permisos, el paralelo o el presupuesto al proyecto: siguen siendo ajustes de la app.
- Probar la conexión sola al abrir Ajustes.
