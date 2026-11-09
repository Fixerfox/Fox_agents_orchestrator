import { AGENT_ICONS, AGENT_TONES } from '@orquestador/core';
/** Tipo de un parámetro de herramienta del asistente (se traduce a zod en el proceso principal) [R29.1]. */
export type AssistantParam = { type: 'string' | 'number' | 'boolean' | 'string[]'; description: string; optional?: boolean };

export interface AssistantToolSpec {
  name: string;
  description: string;
  params: Record<string, AssistantParam>;
  /** Necesita «Permitir» del usuario antes de hacerse [R29.3]. */
  destructive?: boolean;
  /** Pide «Permitir» siempre, aunque el proyecto no pida confirmar acciones [R65.9]. */
  alwaysConfirm?: boolean;
  /** Solo consulta: no cambia nada. */
  readOnly?: boolean;
  /** Espera a que el usuario escriba algo en la tarjeta (un secreto) [R30.12]. */
  interactive?: boolean;
}

const s = (description: string, optional = false): AssistantParam => ({ type: 'string', description, ...(optional ? { optional } : {}) });
const list = (description: string, optional = false): AssistantParam => ({ type: 'string[]', description, ...(optional ? { optional } : {}) });

/** Catálogo único de herramientas del servidor MCP de la app [R29.1]. */
export const ASSISTANT_TOOLS: readonly AssistantToolSpec[] = [
  { name: 'list_agents', description: 'Lista los agentes del proyecto con su descripción, modelo, skills, contextos y servidores MCP.', params: {}, readOnly: true },
  { name: 'get_agent', description: 'Devuelve un agente completo, con sus instrucciones.', params: { id: s('Id del agente') }, readOnly: true },
  { name: 'list_skills', description: 'Lista las skills del proyecto (id, nombre y cuándo usarlas).', params: {}, readOnly: true },
  { name: 'get_skill', description: 'Devuelve una skill completa, con sus pasos.', params: { id: s('Id de la skill') }, readOnly: true },
  { name: 'list_contexts', description: 'Lista los contextos del proyecto (id, nombre y tipo).', params: {}, readOnly: true },
  { name: 'list_mcp', description: 'Lista los servidores MCP del proyecto (sin secretos).', params: {}, readOnly: true },
  { name: 'list_diagrams', description: 'Lista los diagramas del proyecto.', params: {}, readOnly: true },
  {
    name: 'list_runs',
    description: 'Lista las últimas ejecuciones del proyecto (más recientes primero): id, diagrama, estado, cuándo, lo que se pidió, tokens y coste, y el motivo si falló.',
    params: { limit: { type: 'number', description: 'Cuántas (por defecto 10, máximo 30)', optional: true } },
    readOnly: true,
  },
  {
    name: 'get_run',
    description:
      'Resumen de una ejecución: cómo terminó y por qué, qué recibió y entregó cada paso (recortado), revisiones y sus veredictos, preguntas y respuestas, archivos creados o cambiados, errores y la salida final. Sin runId, la más reciente.',
    params: { runId: s('Id de la ejecución (de list_runs)', true) },
    readOnly: true,
  },
  {
    name: 'resume_run',
    description: 'Reanuda una ejecución interrumpida, fallida o cancelada (canResume en list_runs): arranca otra que reutiliza lo que ya terminó bien y sigue desde donde se quedó. Gasta tokens: pide permiso al usuario.',
    params: { runId: s('Id de la ejecución que reanudar') },
    destructive: true,
  },
  {
    name: 'accept_run',
    description:
      'Da por buena una ejecución fallida (status failed): queda como terminada bien y aceptada por el asistente, y se guarda por qué había fallado. Úsala SOLO cuando la persona te lo pida expresamente (p. ej. «dala por buena», «el fallo no importa»), nunca por iniciativa propia. reason: por qué se acepta, con las palabras de la persona. Pide permiso siempre.',
    params: { runId: s('Id de la ejecución fallida (de list_runs)'), reason: s('Por qué se da por buena') },
    destructive: true,
    alwaysConfirm: true,
  },
  { name: 'list_memory', description: 'Lista la memoria del proyecto: lo que se aprendió en ejecuciones anteriores (id, tipo, ámbito, título, texto, estado).', params: { query: s('Texto que buscar', true) }, readOnly: true },
  {
    name: 'save_memory',
    description:
      'Guarda o cambia una entrada de la memoria del proyecto, que reciben los agentes en los pasos siguientes. Solo lo que la persona dijo o pidió recordar, general para el proyecto. kind: convention, preference, lesson o false-alarm. scope: project, diagram:<id> o agent:<id>. Sin id crea una; con id la cambia; status archived la archiva. Pide permiso siempre.',
    params: { id: s('Id de la entrada que cambiar', true), kind: s('Tipo'), scope: s('Ámbito'), title: s('Título (80 caracteres como mucho)'), text: s('Qué hay que recordar (600 como mucho)'), status: s('active o archived', true) },
    destructive: true,
    alwaysConfirm: true,
  },
  { name: 'get_diagram', description: 'Describe el diagrama abierto: pasos (id, tipo, nombre, agente, tarea) y conexiones.', params: {}, readOnly: true },
  {
    name: 'create_agent',
    description: 'Crea un agente del proyecto. Devuelve su id.',
    params: {
      name: s('Nombre corto'),
      description: s('Para qué sirve (una frase)'),
      instructions: s('Instrucciones en Markdown'),
      skillIds: list('Ids de skills existentes', true),
      contextIds: list('Ids de contextos existentes', true),
      mcpIds: list('Ids de servidores MCP existentes', true),
      askFirst: { type: 'boolean', description: 'Pregunta siempre al usuario antes de implementar o decidir (semáforo amarillo en el diagrama)', optional: true },
      icon: s(`Icono: ${AGENT_ICONS.join(', ')}`, true),
      tone: s(`Tono del icono: ${AGENT_TONES.join(', ')}`, true),
    },
  },
  {
    name: 'update_agent',
    description: 'Cambia campos de un agente existente; lo que no se pasa se queda igual.',
    params: {
      id: s('Id del agente'),
      name: s('Nombre', true),
      description: s('Para qué sirve', true),
      instructions: s('Instrucciones en Markdown', true),
      skillIds: list('Lista completa de skills', true),
      contextIds: list('Lista completa de contextos', true),
      mcpIds: list('Lista completa de servidores MCP', true),
      askFirst: { type: 'boolean', description: 'Pregunta siempre al usuario antes de implementar o decidir (semáforo amarillo en el diagrama)', optional: true },
      icon: s(`Icono: ${AGENT_ICONS.join(', ')}`, true),
      tone: s(`Tono del icono: ${AGENT_TONES.join(', ')}`, true),
    },
  },
  { name: 'create_skill', description: 'Crea una skill (formato de Claude Code). Devuelve su id.', params: { name: s('Nombre'), description: s('Cuándo usarla'), body: s('Pasos en Markdown') } },
  { name: 'create_context', description: 'Crea un contexto de texto. Devuelve su id.', params: { name: s('Nombre'), text: s('Contenido en Markdown') } },
  {
    name: 'add_step',
    description: 'Añade al diagrama abierto un paso con un agente, después del paso indicado (o justo antes de Salida). Devuelve el id del paso.',
    params: { agentId: s('Id del agente'), task: s('Qué tiene que hacer en este paso', true), after: s('Id del paso tras el que va (por defecto, antes de Salida)', true) },
  },
  {
    name: 'add_coordinator',
    description: 'Añade un Coordinador detrás de un paso: una pieza fija de la app que divide el trabajo entre los pasos que salen de él, y cada uno recibe solo su parte. Conéctalo después con `connect` a al menos 2 pasos. Solo el Coordinador reparte: de cualquier otro paso con varias salidas, todas reciben lo mismo.',
    params: { after: s('Id del paso tras el que va'), task: s('Tarea del Coordinador', true) },
  },
  { name: 'set_task', description: 'Cambia la tarea de un paso del diagrama abierto.', params: { nodeId: s('Id del paso'), task: s('Tarea') } },
  {
    name: 'set_deliverable',
    description:
      'Define qué se entrega al final de cada ejecución del diagrama abierto (lo compone la Salida y lo guarda como archivo): enlaces a lo generado (sin IA), un resumen en Markdown, datos en JSON con esquema opcional y secciones propias. Los pasos finales lo reciben en su prompt. Sustituye al que hubiera; clear lo quita.',
    params: {
      links: { type: 'boolean', description: 'Incluir los archivos creados o cambiados y las URLs', optional: true },
      summary: { type: 'boolean', description: 'Incluir un resumen en Markdown', optional: true },
      summaryInstructions: s('Qué debe decir el resumen', true),
      json: { type: 'boolean', description: 'Incluir datos en JSON', optional: true },
      jsonSchema: s('JSON Schema que debe cumplir el JSON', true),
      jsonInstructions: s('Qué datos debe llevar el JSON', true),
      sections: list('Secciones propias, cada una «Título: qué debe contener»', true),
      notify: s('A quién se avisa: «final» (pasos finales, por defecto), «all» o «none»', true),
      onMissing: s('Si algo no se completa: «warn» (termina con aviso, por defecto) o «fail»', true),
      fileName: s('Nombre del archivo sin extensión (minúsculas, números, - y _)', true),
      clear: { type: 'boolean', description: 'Quitar el entregable', optional: true },
    },
  },
  { name: 'connect', description: 'Conecta dos pasos del diagrama abierto.', params: { from: s('Id del paso de origen'), to: s('Id del paso de destino') } },
  {
    name: 'add_parallel',
    description: 'Inserta varios agentes que trabajan a la vez después de un paso, y opcionalmente un agente que junta sus resultados.',
    params: { agentIds: list('Ids de 2 a 8 agentes'), after: s('Id del paso tras el que van (por defecto, antes de Salida)', true), joinAgentId: s('Agente que junta los resultados', true), joinTask: s('Tarea del agente que junta', true) },
  },
  { name: 'create_diagram', description: 'Crea un diagrama nuevo vacío y lo abre.', params: { name: s('Nombre del diagrama') } },
  {
    name: 'create_mcp',
    description:
      'Da de alta un servidor MCP: comando local (stdio: command y args) o servidor web (http: url). Los secretos (tokens, claves) NO van en args ni en la url: pon solo sus nombres en secretNames y pide cada valor con request_secret. scope «project» (solo este proyecto, por defecto) o «app» (todos los proyectos del usuario). Devuelve su id.',
    params: {
      name: s('Nombre corto'),
      description: s('Para qué sirve', true),
      transport: s('«stdio» (comando local) o «http» (servidor web)'),
      command: s('Comando que lo arranca (stdio), p. ej. npx', true),
      args: list('Argumentos (stdio), uno por elemento', true),
      url: s('Dirección http(s) (http)', true),
      secretNames: list('Nombres de las variables de entorno (stdio) o cabeceras (http) secretas', true),
      scope: s('«project» o «app»', true),
    },
  },
  {
    name: 'update_mcp',
    description: 'Cambia campos de un servidor MCP existente; lo que no se pasa se queda igual. enabled lo activa o apaga.',
    params: {
      id: s('Id del servidor'),
      name: s('Nombre', true),
      description: s('Para qué sirve', true),
      command: s('Comando (stdio)', true),
      args: list('Lista completa de argumentos (stdio)', true),
      url: s('Dirección (http)', true),
      secretNames: list('Lista completa de nombres de secreto', true),
      scope: s('«project» o «app»', true),
      enabled: { type: 'boolean', description: 'Activado', optional: true },
    },
  },
  { name: 'test_mcp', description: 'Prueba la conexión de un servidor MCP (arranca su programa y lista sus herramientas, sin gastar tokens). Pide permiso al usuario.', params: { id: s('Id del servidor') }, destructive: true },
  {
    name: 'assign_mcp',
    description: 'Asigna un servidor MCP a un agente (siempre) o solo a un paso del diagrama abierto. Pasa agentId o nodeId.',
    params: { mcpId: s('Id del servidor'), agentId: s('Id del agente', true), nodeId: s('Id del paso del diagrama abierto', true) },
  },
  {
    name: 'request_secret',
    description:
      'Pide al usuario el valor de un secreto de un servidor MCP con un campo de contraseña. El valor se guarda cifrado y tú nunca lo ves: solo sabrás si quedó guardado. Si el nombre no estaba en secretNames, se añade.',
    params: { mcpId: s('Id del servidor'), name: s('Nombre de la variable o cabecera, p. ej. GITHUB_TOKEN'), why: s('Dónde conseguirlo, en una frase', true) },
    interactive: true,
  },
  {
    name: 'ask_user',
    description:
      'Hace al usuario UNA pregunta cerrada con botones (2 a 6 opciones cortas); también puede escribir otra respuesta. Úsala para elegir servicio, ámbito («Solo este proyecto» / «Todos mis proyectos»), tipo o confirmar un paso, en vez de preguntar con una lista en el texto. Devuelve { answer }.',
    params: { question: s('Pregunta corta'), options: list('De 2 a 6 opciones cortas, sin numerar') },
    interactive: true,
  },
  {
    name: 'open_terminal',
    description: 'Abre una terminal en la carpeta del proyecto con Claude Code (program «claude», con una petición opcional) o la consola («shell»), para que el usuario inicie sesión, instale algo o escriba lo que pida el servidor.',
    params: { program: s('«claude» o «shell»'), prompt: s('Petición inicial para Claude Code', true) },
    destructive: true,
  },
  { name: 'remove_step', description: 'Quita un paso del diagrama abierto. Si estaba en medio de una cadena, une el paso anterior con el siguiente; si no, dice qué pasos quedaron sin conexión.', params: { nodeId: s('Id del paso') }, destructive: true },
  { name: 'delete_agent', description: 'Borra un agente del proyecto.', params: { id: s('Id del agente') }, destructive: true },
  { name: 'delete_skill', description: 'Borra una skill del proyecto.', params: { id: s('Id de la skill') }, destructive: true },
  { name: 'delete_context', description: 'Borra un contexto del proyecto.', params: { id: s('Id del contexto') }, destructive: true },
  { name: 'run_diagram', description: 'Ejecuta el diagrama abierto con una entrada (gasta tokens). Antes lo valida: si tiene problemas, falla con la lista. Devuelve el id de la ejecución.', params: { input: s('Entrada para el diagrama') }, destructive: true },
];

export const ASSISTANT_SERVER = 'orquestador';
export const ASSISTANT_MAX_MESSAGES = 30;
export const ASSISTANT_MAX_TEXT = 20_000;
/** Pestañas del asistente como mucho, y elementos que se guardan de cada una [R86.3][R86.12]. */
export const ASSISTANT_MAX_TABS = 8;
export const ASSISTANT_MAX_SAVED_ITEMS = 200;
export const ASSISTANT_TAB_TITLE_MAX = 80;

/** Estado de una tarjeta de acción del asistente [R29.5]. */
export type AssistantToolStatus = 'running' | 'ask' | 'secret' | 'choice' | 'done' | 'error' | 'denied' | 'undone';

/** Elemento de una conversación tal como se guarda: sin funciones [R86.13]. */
export type SavedChatItem =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'assistant'; id: string; text: string }
  | { kind: 'tool'; id: string; turnId: string; name: string; args: Record<string, unknown>; status: AssistantToolStatus; summary?: string; answer?: string }
  | { kind: 'read'; id: string; tool: string; target: string; ok: boolean }
  | { kind: 'error'; id: string; text: string };

/** Pestañas del asistente de un proyecto, tal como se guardan [R86.11]. */
export interface SavedAssistantTabs {
  activeId: string;
  tabs: { id: string; title: string; updatedAt: number; items: SavedChatItem[] }[];
}

export interface AssistantMessage {
  role: 'user' | 'assistant';
  text: string;
}

/** Lo que el proceso principal envía a la interfaz durante un turno [R29.4]. */
export type AssistantEvent =
  | { type: 'text'; text: string }
  | { type: 'tool'; callId: string; name: string; args: Record<string, unknown> }
  /** Lectura de un archivo, carpeta o página: solo el nombre, el patrón o el dominio, nunca la ruta [R29.9]. */
  | { type: 'read'; tool: string; target: string; ok: boolean }
  | { type: 'done'; text: string; usage?: { inputTokens: number; outputTokens: number; costUsd: number } }
  | { type: 'error'; message: string };

export const ASSISTANT_EVENTS_CHANNEL = 'assistant:events';
