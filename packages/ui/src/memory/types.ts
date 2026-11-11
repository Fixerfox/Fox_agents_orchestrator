import type { AgentDefinition, AppSettings, ContextDefinition, Diagram, GitAction, GitChoice, GitState, ImportPlan, LibraryFolders, McpServerDefinition, Orchestrator, RecentView, RunEvent, RunHandle, SkillDefinition, SourceTree } from '@orquestador/core';
import type { ApiResult, AssistantMessage, ConnectionResult, DraftRequest, DraftResult, FilePreview, GitHistoryView, GitOverviewView, McpTestResult, ProjectApi, RunSummary, TerminalProgram } from '@orquestador/editor';

export interface MemoryApiOptions {
  /** Simula unos ajustes que estaban dañados [R89.6]. */
  settingsRecovered?: boolean;
  /** Lo que trae la configuración de Claude Code del proyecto, para la pantalla de confianza [R88.6]. */
  trustItems?: { file: string; key: string; detail: string }[];
  /** Orquestador a usar; por defecto agentes simulados que responden «salida de <agente>». */
  orchestrator?: Orchestrator;
  /** Archivos de salida por ejecución (nombre → texto). */
  outputs?: Record<string, string>;
  /** Vistas previas de los archivos de los pasos, por `runId|key|ruta`; si falta, se usa `outputs` [R54.4]. */
  previews?: Record<string, FilePreview>;
  /** Agentes y contextos iniciales del proyecto. */
  agents?: AgentDefinition[];
  contexts?: ContextDefinition[];
  /** Servidores MCP del proyecto y secretos guardados («id» → nombre → valor) [R30.1]. */
  mcp?: McpServerDefinition[];
  mcpSecrets?: Record<string, Record<string, string>>;
  /** Carpetas de la biblioteca [R38.13]. */
  folders?: LibraryFolders;
  /** Asistente simulado: pasos (texto o herramienta) que responde a cada turno [R29.6]. */
  assistant?: (messages: AssistantMessage[]) => AssistantStep[];
  /** Resultado de «Probar conexión» de un servidor MCP [R30.5]. */
  mcpTest?: McpTestResult | ((id: string) => McpTestResult);
  skills?: SkillDefinition[];
  /** Archivos incluidos en cada skill (id → ruta → contenido). */
  skillFiles?: Record<string, Record<string, string>>;
  /** Archivos que «elegirá» el usuario al añadir referencias; sin ellos el diálogo se cancela [R24.9]. */
  pickedFiles?: SourceTree;
  /** La carpeta del proyecto; `separate` simula un proyecto antiguo sin unir [R96.2][R96.4]. */
  workFolder?: { name: string; files: number; separate?: boolean };
  /** Git simulado de la carpeta del proyecto para la guarda de rama; sin él, no hay repositorio [R97.2]. */
  git?: { state: GitState; suggested?: string; otherRuns?: number };
  /** Repositorio simulado para la sección «Versiones»; sin él, la carpeta no es un repositorio [R98.2]. */
  repo?: { overview: GitOverviewView; history?: GitHistoryView; diffs?: Record<string, string>; actError?: string };
  /** Motivo con el que falla «Unir» [R96.6]. */
  joinError?: string;
  /** La opción «Orquestador y git»; sin ella no se ofrece [R96.9]. */
  gitIgnore?: { available: boolean; exists: boolean; mode: 'shared' | 'all' };
  /** Lo que devuelven «Adjuntar» y «Del proyecto…» (en los tests) [R48.3]. */
  attachPick?: { name: string; size: number }[];
  projectPick?: { path: string; size: number }[];
  /** Copias de seguridad por ejecución (ruta → texto original) [R31.6]. */
  backups?: Record<string, Record<string, string>>;
  /** Contenido actual de los ficheros que tocaron las ejecuciones, por ejecución y ruta [R45.10]. */
  runFiles?: Record<string, Record<string, string>>;
  /** Proyectos recientes iniciales [R28.3]. */
  recent?: RecentView[];
  /** Resultado de «Probar conexión» [R27.12]. */
  connection?: ConnectionResult;
  /** Resultado de «Elegir archivos/carpeta» en un contexto; `'cancel'` simula cancelar el diálogo. */
  contextPick?: 'cancel' | { value: string; files: number; bytes: number; renamed: number; scripts: string[] };
  /** Respuesta de «Redactar con Claude»; por defecto una propuesta fija. Una función puede fallar con `fail`. */
  draft?: DraftResult | ((req: DraftRequest) => ApiResult<DraftResult> | Promise<ApiResult<DraftResult>>);
  /** Paquete que «elegirá» el usuario al instalar; sin él, el diálogo se cancela [R25.1]. */
  importTree?: SourceTree;
  /** Contenido simulado de la carpeta de trabajo para `inspectWorkFolder` [R32.16]. */
  workFolderTree?: { files: SourceTree['files']; summary: string; docs: { name: string; text: string }[] };
  /** Simula un sistema sin almacenamiento cifrado [R23.3]. */
  noEncryption?: boolean;
  /** Terminal simulada: `external` simula que se abrió la del sistema; `fail` que no hay ninguna [R30.13][R30.14]. */
  terminal?: { external?: boolean; fail?: boolean };
  /** Ejecuciones anteriores ya terminadas (historial) con sus eventos [R35.7]. */
  pastRuns?: { summary: RunSummary; events: RunEvent[]; diagram?: Diagram }[];
}

export interface RunEntry {
  handle: RunHandle;
  events: RunEvent[];
  diagramId: string;
  subscribed: boolean;
  order: string;
  /** Copia del diagrama al arrancar (R35.16). */
  diagram: Diagram;
}

/** Un paso del asistente simulado: decir algo o llamar a una herramienta de la app [R29.6]. */
export type AssistantStep = { text: string } | { tool: string; args: Record<string, unknown> } | { read: string; target: string; ok?: boolean };

export type MemoryApi = ProjectApi & {
  saved: Map<string, Diagram>;
  runs: Map<string, RunEntry>;
  agents: Map<string, AgentDefinition>;
  contexts: Map<string, ContextDefinition>;
  mcp: Map<string, McpServerDefinition>;
  mcpSecrets: Map<string, Record<string, string>>;
  /** Carpetas guardadas [R38.13]. */
  folders: () => LibraryFolders;
  skills: Map<string, SkillDefinition>;
  /** Copias restauradas con `restoreBackup` («ejecución:ruta») [R31.6]. */
  restored: string[];
  /** Terminales simuladas abiertas: programa, petición y lo escrito [R30.13]. */
  terminals: Map<string, { program: TerminalProgram; prompt?: string; written: string; alive: boolean }>;
  /** Simula que la terminal escribe algo (salida del programa). */
  terminalOutput(id: string, data: string): void;
  /** Lo que la interfaz devolvió a Claude por cada herramienta (para comprobar que no lleva secretos) [R30.12]. */
  assistantResults: { name: string; ok: boolean; result: unknown }[];
  /** Elección de rama de cada lanzamiento, en orden [R97.3]. */
  gitChoices: (GitChoice | undefined)[];
  /** Acciones de git hechas desde el visor o el asistente, en orden [R98.6]. */
  gitActions: GitAction[];
  /** Mensajes que recibió el asistente en cada turno. */
  assistantTurns: AssistantMessage[][];
};

/** Estado que comparten los contextos de la API en memoria; lo demás vive en cada contexto [R56.18]. */
export interface MemoryState {
  saved: Map<string, Diagram>;
  runs: Map<string, RunEntry>;
  agents: Map<string, AgentDefinition>;
  contexts: Map<string, ContextDefinition>;
  mcp: Map<string, McpServerDefinition>;
  mcpSecrets: Map<string, Record<string, string>>;
  skills: Map<string, SkillDefinition>;
  /** Hay un proyecto abierto. */
  open: boolean;
  /** Importación analizada y pendiente de confirmar. */
  pending: { id: string; plan: ImportPlan } | undefined;
  importCount: number;
  settings: AppSettings;
}
