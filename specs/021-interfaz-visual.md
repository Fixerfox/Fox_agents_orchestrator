# SPEC-021 · Interfaz visual: temas, iconos y diseño

**Estado:** Implementado (M4c) · **Hito:** M4c · **Paquete:** `ui`

## Propósito
Que la app se entienda de un vistazo: modo claro y oscuro, botones con icono, nodos que muestran qué son y qué están haciendo, y una pantalla que guía al usuario cuando no hay nada que mostrar.

## Dirección de diseño
Elegida por el usuario entre tres prototipos (variante «A2», revisada con la skill unslop de Damir Sokolovsky, CC BY 4.0).
- **Concepto:** sala de control nocturna. Superficies en gris tinta casi neutro; lo único que «se enciende» es lo que ocurre: la selección y la ruta recorrida, en un único acento ámbar.
- **Sin color por tipo:** los tipos de nodo se distinguen por su icono (en gris), no por su color. Los estados usan verde (correcto), ámbar (en curso o esperando), rojo (fallido) y siempre llevan icono y texto.
- **Señal propia:** los puertos de conexión son anillos, como los conectores de un parcheador.
- **Tipografía:** Geist para la interfaz y Geist Mono para cifras, transcripciones y registros; pesos 400 y 500, frases en minúscula salvo la inicial.
- **Sin brillos ni degradados:** la profundidad sale de escalones de superficie y líneas finas.
- **Movimiento:** solo el nodo en ejecución y las aristas recorridas; todo con una misma curva y sin animar el diseño.

## Requisitos
- **R21.1** [M4c] Hay tres temas: claro, oscuro y automático (sigue al sistema). Un selector cambia de tema (desde SPEC-032 vive en Ajustes, no en la barra superior; el componente `ThemeToggle` sigue disponible), la elección se recuerda entre sesiones y el tema correcto se aplica antes de pintar la ventana (sin parpadeo). Todos los colores salen de variables.
- **R21.2** [M4c] En ambos temas el texto principal y el secundario tienen un contraste mínimo de 4,5:1 sobre sus fondos, y los bordes de los controles 3:1. Un test lo calcula a partir de las variables reales.
- **R21.3** [M4c] Los botones y los tipos de nodo llevan icono. Un botón con solo icono tiene nombre accesible y tooltip.
- **R21.4** [M4c] Los nodos de la paleta se pueden arrastrar al lienzo y se crean donde se sueltan; el clic sigue añadiéndolos.
- **R21.5** [M4c] Cada nodo es una tarjeta con icono de su tipo, nombre, subtítulo (agente o modo; el agente no se repite si se llama como el paso, R63.25) e indicador de estado con icono y texto; los nodos con problemas lo señalan con un icono.
- **R21.6** [M4c] La ejecución se controla con una barra de transporte: ejecutar, pausar o reanudar y parar son botones inequívocos; el presupuesto de tokens se muestra como un medidor y el contador usa singular y plural correctos.
- **R21.7** [M4c] Los problemas del diagrama se ven en un contador junto a «Ejecutar» que abre su lista (sin panel inferior; SPEC-032, R32.23); los resultados de una ejecución viven en Ejecuciones › Resultados (R32.20).
- **R21.8** [M4c] Las pantallas vacías dicen qué hacer: lienzo sin proyecto, sin nodos añadidos, sin resultados, sin registro.
- **R21.9** [M4c] Todo se puede usar con teclado, con foco visible; los objetivos táctiles miden al menos 32 px; con «reducir movimiento» no hay animaciones.
- **R21.10** [M4c] El panel izquierdo de Diagramas se pliega pulsando «Diagramas» en el rail cuando ya se está en esa sección, y el derecho con su botón de la barra; la interfaz es usable hasta 900 px de ancho.
- **R21.11** [M4c] Las fuentes e iconos se empaquetan con la app (sin red) y cumplen la política de contenido.
- **R21.12** [M4c] Con el botón derecho se abre un menú contextual. En un nodo: renombrar, duplicar, entrar (bucles) y eliminar; en una conexión: editar condición (si sale de un router) y eliminar; en el lienzo vacío: añadir agente, router o bucle en ese punto. La entrada y la salida no se pueden duplicar ni eliminar. El menú se maneja con teclado (flechas, Intro, Esc) y se cierra al hacer clic fuera.
- **R21.13** [M4c] Las conexiones se seleccionan con facilidad (zona de clic ancha), se resaltan al seleccionarlas y se pueden quitar con Supr, con Retroceso, con el menú contextual o con un botón «Eliminar» del inspector.
- **R21.14** [M4c] Al añadir un agente (desde la paleta o desde el menú del lienzo) se abre una galería de tarjetas con los agentes disponibles (icono, nombre y descripción), no un desplegable. Elegir una tarjeta lo añade; Esc o clic fuera cierran la galería.
- **R21.15** [M4c] El panel izquierdo muestra en «Tus agentes» cuántas veces se usa cada agente en el diagrama (en cualquier nivel, también dentro de bucles) y la lista de esos usos; al pulsar un uso se selecciona su nodo (entrando en el bucle si hace falta) y pulsar el agente añade otro igual.
- **R21.16** [M4c] En ventanas de 1100 px o menos el panel derecho empieza cerrado y se cierra al estrechar la ventana, para dejar sitio al lienzo; se vuelve a abrir con su botón de la barra. Con la ventana ancha no cambia nada.
- **R21.17** [M6d] El panel izquierdo de Diagramas (prototipo «Editor A», SPEC-032) es un solo panel con buscador y tres apartados —Pasos, Tus agentes y Plantillas—; sustituye al rail de iconos de tres secciones, cuyo papel asume el rail global (R32.13).
- **R21.18** [M6d] El buscador filtra pasos, agentes y plantillas por nombre o descripción, avisa si nada coincide y permite borrar la búsqueda; los pasos se añaden con clic o arrastrándolos al lienzo.
- **R21.19** [M6d] Si el proyecto no tiene agentes, «Tus agentes» lo dice y ofrece «Nuevo agente», que abre Agentes con un formulario vacío.
- **R21.20** [M6d] Las plantillas son tarjetas con nombre, descripción y «Cargar en el lienzo».
- **R21.22** [M6d] El panel derecho se ensancha o estrecha arrastrando su borde (entre 288 px y un máximo que deja sitio al lienzo), con el teclado (flechas, Inicio y Fin) y vuelve a 288 px con doble clic; el ancho se recuerda entre sesiones.

