# SPEC-019 · Cáscara de escritorio (Electron), IPC y seguridad

**Estado:** En implementación (M3) · **Hito:** M3 / M4 · **Paquete:** `apps/desktop`

## Propósito
La app de escritorio aloja la interfaz y le da acceso, de forma **mínima y validada**, al proyecto en disco. El renderer nunca toca el sistema de archivos ni Node directamente.

## Requisitos
- **R19.1** [M3] La ventana se crea con `contextIsolation` activado, `sandbox` activado y `nodeIntegration` desactivado; bloquea la navegación a páginas externas y la apertura de ventanas nuevas; y fija una política de contenido (CSP) restrictiva.
- **R19.2** [M3] El renderer solo dispone de la API tipada que expone el preload (`window.orquestador`); no recibe `ipcRenderer` ni módulos de Node.
- **R19.3** [M3] Los canales IPC se definen en un único contrato. El proceso principal valida la forma de cada petición y rechaza lo inesperado con un error claro.
- **R19.4** [M3] Operaciones disponibles: crear y abrir proyecto (con diálogo del sistema), listar, cargar y guardar diagramas, y listar plantillas de ejemplo. Todo pasa por `ProjectStore` (ids seguros, sin secretos, escritura atómica).
- **R19.5** [M3] Hay como máximo un proyecto abierto. El renderer nunca envía rutas: solo ids. No puede leer ni escribir fuera de `.orquestador/`.
- **R19.6** [M3] Los errores llegan al renderer como `{ ok: false, error: { code, message } }`, sin trazas ni rutas absolutas ajenas al proyecto.
- **R19.7** [M4] Por IPC: iniciar una ejecución, suscribirse a sus eventos (historial desde `seq` + envío en vivo por lotes), pausar, reanudar, cancelar, responder preguntas, listar ejecuciones y leer sus archivos de salida. Mismas reglas de validación y errores que el resto (R19.3, R19.5, R19.6).
- **R19.8** [M8f] La ventana no tiene barra de título ni menú del sistema (File, Edit…): la barra superior de la app hace de barra de título (se arrastra para mover la ventana; sus botones y menús siguen funcionando) y los botones minimizar, maximizar y cerrar se dibujan encima con los colores de la barra, que siguen el tema claro u oscuro de la app (el preload solo avisa «light» o «dark» por un canal de una dirección; el proceso principal ignora cualquier otro valor). En macOS se mantienen los botones propios del sistema.
- **R19.9** [M8f] La app ocupa siempre la ventana entera y nunca se desplaza como un todo (ni al enfocar o hacer visible algo): solo se desplazan los paneles. La vista de una ejecución reparte el alto entre el lienzo y las pestañas de abajo para caber en ventanas bajas.
