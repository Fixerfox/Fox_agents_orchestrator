import { AGENT_SCHEMA_VERSION, DEFAULT_MODEL, moveToFolder, type AgentIcon, type AgentDefinition, type Diagram, type LibraryFolders } from '@orquestador/core';
import { SPECKIT_SKILLS, type BuiltinSkill } from './speckit-data';
import { createDiagram } from './ops';
import type { ProjectApi } from './api';

export { SPECKIT_COMMIT, SPECKIT_SKILLS, type BuiltinSkill } from './speckit-data';

/** Carpeta en la que se instalan las skills y los agentes de Spec Kit [R38.15][R38.16]. */
export const SPECKIT_FOLDER = 'Spec Kit';

const CLOSE =
  'Al terminar, resume en español qué artefactos has creado o cambiado (con su ruta dentro de `specs/` o `.specify/`) y qué paso de Spec Kit recomiendas a continuación.';

interface AgentSeed {
  icon: AgentIcon;
  id: string;
  name: string;
  description: string;
  skills: string[];
  instructions: string;
}

/** Un agente por fase de Spec Kit, cada uno con su skill [R38.16]. */
const SEEDS: AgentSeed[] = [
  {
    id: 'speckit-constitucion',
    icon: 'scroll',
    name: 'Constitución (Spec Kit)',
    description: 'Crea o actualiza los principios del proyecto en .specify/memory/constitution.md.',
    skills: ['speckit-constitution'],
    instructions: `Eres el guardián de la constitución del proyecto con la metodología Spec Kit (desarrollo guiado por especificaciones).\n\nUsa la skill «Spec Kit · Constitución» y síguela al pie de la letra. Lo que recibes son los principios o cambios que pide el usuario. Si faltan datos, propón valores razonables y márcalos como TODO en vez de inventar.\n\n${CLOSE}`,
  },
  {
    id: 'speckit-especificador',
    icon: 'pen',
    name: 'Especificador (Spec Kit)',
    description: 'Convierte una idea en spec.md: qué y por qué, historias de usuario y criterios de aceptación; aclara lo ambiguo.',
    skills: ['speckit-specify', 'speckit-clarify'],
    instructions: `Escribes especificaciones con Spec Kit. Lo que recibes es la descripción de la funcionalidad.\n\n1. Usa la skill «Spec Kit · Especificar» para crear la carpeta de la funcionalidad en \`specs/\` y su spec.md.\n2. Si quedan marcas [NEEDS CLARIFICATION] o la idea es ambigua, aplica «Spec Kit · Aclarar»: como no hay chat en directo, pregunta lo imprescindible al usuario (máximo 3 preguntas) y si no responde, decide con supuestos razonables y anótalos en la spec.\n\nNo escribas código ni decidas tecnologías: eso es del plan.\n\n${CLOSE}`,
  },
  {
    id: 'speckit-planificador',
    icon: 'map',
    name: 'Planificador técnico (Spec Kit)',
    description: 'A partir de spec.md genera plan.md, research.md, data-model.md, contratos y quickstart.',
    skills: ['speckit-plan'],
    instructions: `Haces el plan técnico con Spec Kit. Lo que recibes es la salida del especificador (o indicaciones de tecnología del usuario).\n\nUsa la skill «Spec Kit · Planificar». Respeta la constitución en .specify/memory/constitution.md y justifica cualquier excepción. No implementes nada.\n\n${CLOSE}`,
  },
  {
    id: 'speckit-tareas',
    icon: 'clipboard',
    name: 'Desglose de tareas (Spec Kit)',
    description: 'Genera tasks.md: tareas ordenadas por dependencias y por historia de usuario, con lo que se puede hacer en paralelo.',
    skills: ['speckit-tasks'],
    instructions: `Desglosas el plan en tareas con Spec Kit. Lo que recibes es la salida del planificador.\n\nUsa la skill «Spec Kit · Tareas» y respeta su formato de checklist (IDs T001…, [P] para paralelo, [US1]… por historia).\n\n${CLOSE}`,
  },
  {
    id: 'speckit-analista',
    icon: 'search',
    name: 'Analista de coherencia (Spec Kit)',
    description: 'Revisa spec.md, plan.md y tasks.md sin modificarlos: huecos, contradicciones y choques con la constitución.',
    skills: ['speckit-analyze', 'speckit-checklist'],
    instructions: `Revisas la coherencia entre spec.md, plan.md y tasks.md con Spec Kit. No modificas esos archivos.\n\nUsa la skill «Spec Kit · Analizar». Si la tarea pide una checklist de calidad, usa también «Spec Kit · Checklist».\n\nTermina con una línea «VEREDICTO: APROBADO» si no hay problemas CRITICAL ni HIGH, o «VEREDICTO: RECHAZADO» con la lista de lo que hay que corregir, para que un paso de revisión pueda decidir.`,
  },
  {
    id: 'speckit-implementador',
    icon: 'hammer',
    name: 'Implementador (Spec Kit)',
    description: 'Ejecuta tasks.md fase a fase, marca cada tarea hecha y completa lo que falte con converger.',
    skills: ['speckit-implement', 'speckit-converge'],
    instructions: `Implementas una funcionalidad ya especificada con Spec Kit. Lo que recibes es el análisis o las indicaciones del usuario.\n\nUsa la skill «Spec Kit · Implementar»: sigue tasks.md en orden, respeta las dependencias y marca cada tarea con [X] al terminarla. Si al acabar queda trabajo sin hacer respecto a la spec, aplica «Spec Kit · Converger».\n\nTermina con «Cambios realizados»: archivos creados, modificados o borrados, qué y por qué, y los comandos que ejecutaste.`,
  },
];

export const SPECKIT_AGENTS: readonly AgentDefinition[] = SEEDS.map((s) => ({
  id: s.id,
  schemaVersion: AGENT_SCHEMA_VERSION,
  name: s.name,
  description: s.description,
  instructions: s.instructions,
  model: DEFAULT_MODEL,
  contextIds: [],
  skillIds: s.skills,
  // Su skill principal es obligatoria: va entera en el prompt y no depende de que el agente decida leerla [R39.12].
  required: { skillIds: [s.skills[0]!] },
  icon: s.icon,
  tone: 'amber' as const,
}));

/** Diagrama de ejemplo: de la idea al código con los agentes de Spec Kit [R38.16]. */
/** Id de la plantilla «Spec Kit: de la idea al código» entre los ejemplos [R38.26]. */
export const SPECKIT_TEMPLATE_ID = 'spec-kit';

export function specKitDiagram(id = SPECKIT_TEMPLATE_ID, name = 'Spec Kit: de la idea al código'): Diagram {
  const d = createDiagram(id, name);
  const steps: [string, string][] = [
    ['speckit-especificador', 'Especifica la funcionalidad que describe la entrada.'],
    ['speckit-planificador', 'Haz el plan técnico de la funcionalidad recién especificada.'],
    ['speckit-tareas', 'Desglosa el plan en tareas.'],
    ['speckit-analista', 'Analiza la coherencia de spec, plan y tareas.'],
    ['speckit-implementador', 'Implementa las tareas de la funcionalidad.'],
  ];
  const nodes = steps.map(([agentId, task], i) => ({ id: agentId.replace('speckit-', ''), kind: 'agent' as const, agentId, label: SEEDS.find((s) => s.id === agentId)!.name.replace(' (Spec Kit)', ''), task, position: { x: 220 * (i + 1), y: 120 } }));
  const ids = ['entry', ...nodes.map((n) => n.id), 'output'];
  return {
    ...d,
    nodes: [{ ...d.nodes[0]!, position: { x: 0, y: 120 } }, ...nodes, { ...d.nodes[1]!, position: { x: 220 * (nodes.length + 1), y: 120 } }],
    edges: ids.slice(1).map((to, i) => ({ id: `${ids[i]}->${to}`, from: ids[i]!, to })),
  };
}

export interface SpecKitInstallResult {
  skills: string[];
  agents: string[];
  skipped: string[];
}

/** ¿Está ya instalado? Basta con que estén todas las skills. */
/**
 * Spec Kit está completo cuando están sus skills y sus agentes [R38.15]. Mirar solo las skills no basta:
 * un proyecto que importó `speckit-*` de `.claude` las tiene, pero no los agentes que usa la plantilla.
 */
export const hasSpecKit = (skillIds: readonly string[], agentIds: readonly string[]) =>
  SPECKIT_SKILLS.every((s) => skillIds.includes(s.id)) && SPECKIT_AGENTS.every((a) => agentIds.includes(a.id));

/** Lo que necesita la instalación; lo cumplen el contrato de la interfaz y el almacén del proyecto. */
export interface SpecKitTarget {
  skillIds(): Promise<string[]>;
  agentIds(): Promise<string[]>;
  saveSkill(skill: { id: string; name: string; description: string; body: string }): Promise<void>;
  saveSkillFile(id: string, path: string, text: string): Promise<void>;
  saveAgent(agent: AgentDefinition): Promise<void>;
  getFolders(): Promise<LibraryFolders>;
  saveFolders(folders: LibraryFolders): Promise<void>;
}

/**
 * Instala las skills y los agentes de Spec Kit en la carpeta «Spec Kit». Lo que ya existe con el mismo id no se
 * toca [R38.15][R38.16].
 */
export async function installSpecKitInto(target: SpecKitTarget): Promise<SpecKitInstallResult> {
  const skillIds = new Set(await target.skillIds());
  const agentIds = new Set(await target.agentIds());
  const out: SpecKitInstallResult = { skills: [], agents: [], skipped: [] };
  for (const s of SPECKIT_SKILLS as readonly BuiltinSkill[]) {
    if (skillIds.has(s.id)) {
      out.skipped.push(s.id);
      continue;
    }
    await target.saveSkill({ id: s.id, name: s.name, description: s.description, body: s.body });
    for (const f of s.files) await target.saveSkillFile(s.id, f.path, f.text);
    out.skills.push(s.id);
  }
  for (const a of SPECKIT_AGENTS) {
    if (agentIds.has(a.id)) {
      out.skipped.push(a.id);
      continue;
    }
    await target.saveAgent(structuredClone(a));
    out.agents.push(a.id);
  }
  if (out.skills.length + out.agents.length > 0) {
    let folders = await target.getFolders();
    for (const id of out.skills) folders = moveToFolder(folders, 'skills', id, SPECKIT_FOLDER);
    for (const id of out.agents) folders = moveToFolder(folders, 'agents', id, SPECKIT_FOLDER);
    await target.saveFolders(folders);
  }
  return out;
}

/** Igual, con el contrato de la interfaz (botón «Añadir Spec Kit») [R38.15]. */
export function installSpecKit(api: ProjectApi): Promise<SpecKitInstallResult> {
  const must = <T,>(r: { ok: true; value: T } | { ok: false; error: { message: string } }): T => {
    if (!r.ok) throw new Error(r.error.message);
    return r.value;
  };
  return installSpecKitInto({
    skillIds: async () => must(await api.listSkills()).map((s) => s.id),
    agentIds: async () => must(await api.listAgents()).map((a) => a.id),
    saveSkill: async (k) => void must(await api.saveSkill(k)),
    saveSkillFile: async (id, path, text) => void must(await api.saveSkillFile({ id, path, text })),
    saveAgent: async (a) => void must(await api.saveAgent(a)),
    getFolders: async () => must(await api.getLibraryFolders()),
    saveFolders: async (f) => void must(await api.saveLibraryFolders(f)),
  });
}
