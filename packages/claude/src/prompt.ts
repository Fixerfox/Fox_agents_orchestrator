import type { AgentDefinition, AnsweredQuestion, ContextDefinition, Payload, PermissionLevel, SkillDefinition } from '@orquestador/core';
import type { KnowledgeItem, KnowledgePlan } from './knowledge';

/** Herramientas permitidas hasta que existan los permisos del motor [R27.9]. */
export const READ_ONLY_TOOLS = ['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch'] as const;

export const skillPath = (id: string) => `.orquestador/skills/${id}/SKILL.md`;

/**
 * Al terminar su respuesta el paso se cierra y el flujo sigue sin esperarle: una pregunta escrita en la respuesta
 * nunca llega a contestarse a tiempo [R27.13].
 */
export const QUESTION_RULE =
  'Si necesitas que el usuario decida algo o te dé un dato, pregúntaselo con la herramienta de preguntas (AskUserQuestion) antes de terminar y sigue con su respuesta. ' +
  'Nunca acabes tu respuesta con preguntas o decisiones pendientes: en cuanto respondes, tu paso termina y el flujo pasa al siguiente sin esperarte.';

/** Regla de los agentes que preguntan antes de actuar [R39.3]. */
export const ASK_FIRST_RULE =
  'Este agente está supervisado: antes de implementar nada (crear, modificar o borrar archivos, ejecutar comandos) y antes de tomar cualquier decisión que el usuario no haya tomado ya, preséntale tu plan y las opciones con la herramienta de preguntas (AskUserQuestion) y espera su respuesta. ' +
  'Hasta que responda no podrás escribir ni ejecutar nada. Si no hay nada que decidir, pregúntale igualmente si das por bueno tu plan antes de seguir.';

/** Regla de los pasos que confirman antes de terminar [R43.4]. */
export const CONFIRM_RULE =
  'Este paso se confirma antes de terminar: el usuario leerá tu respuesta final, la aprobará o te pedirá cambios. ' +
  'Termina siempre con una sección «## Resumen para confirmar» en Markdown, detallada y ordenada: qué has hecho y por qué; cada archivo creado, modificado o borrado (con su ruta relativa) y qué cambió; los comandos ejecutados; las decisiones que has tomado; y lo que queda pendiente o conviene revisar. ' +
  'Si te piden cambios, aplícalos sobre tu entrega anterior y vuelve a terminar con el resumen completo y actualizado.';

/** Regla de los pasos finales cuando la ejecución tiene entregable [R46.5]. */
export const DELIVERABLE_RULE =
  'No escribas tú ese entregable: lo compone la aplicación al final con lo que dejes. Deja tu salida y tus archivos listos para eso: nombra cada archivo que crees o cambies (con su ruta relativa) y cada enlace o dirección que generes, y di para qué sirve cada uno.';

/** Lo que el agente puede hacer en la carpeta según su nivel de permisos [R50.6]. */
export function folderRule(level: PermissionLevel): string {
  if (level === 'readonly')
    return 'Puedes leer toda la carpeta, pero eres de solo lectura: no crees, modifiques ni borres archivos ni ejecutes comandos que cambien algo; propón los cambios en tu respuesta.';
  const create = 'Puedes leer toda la carpeta y crear archivos y carpetas nuevos sin pedir permiso: hazlo cuando la tarea produzca ficheros, no pegues el código en tu respuesta.';
  if (level === 'ask')
    return `${create} Para modificar un archivo que ya existe o ejecutar comandos que no sean sencillos se le pregunta al usuario; si no lo permite, crea uno nuevo o propón el cambio. No puedes escribir fuera de la carpeta.`;
  const modify = 'Puedes modificar archivos existentes sin preguntar (se guarda una copia antes) y ejecutar comandos.';
  if (level === 'auto') return `${create} ${modify} Solo se pregunta al usuario antes de borrar, salir de la carpeta o publicar fuera del equipo. No puedes escribir fuera de la carpeta.`;
  return `${create} ${modify} Nada pide permiso, y también puedes escribir fuera de la carpeta, salvo en .orquestador, que es de la aplicación.`;
}

/** Lo nuestro de un prompt de sistema: el texto propio o lo añadido al de Claude Code [R50.1]. */
export const promptText = (p: string | { append?: string } | undefined): string => (typeof p === 'string' ? p : (p?.append ?? ''));

/** Prompt de sistema de un paso de agente: el de Claude Code con lo nuestro al final [R50.1]. */
export const claudeCodePrompt = (append: string) => ({ type: 'preset' as const, preset: 'claude_code' as const, append });

/** Bloque del entregable en el prompt de sistema: contrato completo o una línea de objetivo [R46.5]. */
export function deliverableSection(d: { role: 'final' | 'goal'; text: string }): string {
  return d.role === 'final' ? `## Entregable de esta ejecución
${d.text}

${DELIVERABLE_RULE}` : d.text;
}

/** Prompt de sistema: quién es el agente, sus contextos por referencia y sus skills [R27.2][R27.3][R27.4]. */
export function buildSystemPrompt(agent: AgentDefinition, contexts: ContextDefinition[], skills: SkillDefinition[], folder?: { text: string }, plan?: KnowledgePlan, opts: { confirm?: boolean; deliverable?: { role: 'final' | 'goal'; text: string }; level?: PermissionLevel } = {}): string {
  const must = (kind: KnowledgeItem['kind']) => (plan?.items ?? []).filter((i) => i.kind === kind && i.required);
  const isMust = (kind: KnowledgeItem['kind'], id: string) => must(kind).some((i) => i.id === id);
  const optionalContexts = contexts.filter((c) => !isMust('context', c.id));
  const optionalSkills = skills.filter((s) => !isMust('skill', s.id));
  const parts: string[] = [`Eres «${agent.name}», un agente de un diagrama de trabajo.`];
  if (agent.description.trim()) parts.push(`Qué haces: ${agent.description.trim()}`);
  if (agent.instructions.trim()) parts.push(`Instrucciones:\n${agent.instructions.trim()}`);
  if (optionalContexts.length > 0) {
    const lines = optionalContexts.map((c) => {
      if (c.kind === 'text') return `- ${c.name} (texto):\n${c.value}`;
      if (c.kind === 'url') return `- ${c.name}: consulta ${c.value} si la tarea lo necesita.`;
      return `- ${c.name}: el archivo ${c.value} del proyecto; léelo si la tarea lo necesita.`;
    });
    parts.push(`Contextos que debes tener en cuenta:\n${lines.join('\n')}`);
  }
  if (optionalSkills.length > 0) {
    const lines = optionalSkills.map((s) => `- ${s.name}: ${s.description} Léela en ${plan?.items.find((i) => i.kind === 'skill' && i.id === s.id)?.where ?? skillPath(s.id)} cuando encaje con la tarea; sus archivos de referencia están en la misma carpeta, bajo referencias/.`);
    parts.push(`Tienes estas skills:\n${lines.join('\n')}`);
  }
  parts.push(...requiredSections(must('context'), must('skill'), must('mcp')));
  if (folder) {
    parts.push(`Trabajas sobre la carpeta de trabajo del usuario (tu directorio actual). Esto es lo que contiene:\n${folder.text}`);
    parts.push(`${folderRule(opts.level ?? 'ask')} Si te falta un dato, pregúntalo con la herramienta de preguntas en vez de suponerlo. Responde con el resultado final.`);
    parts.push(QUESTION_RULE);
    if (agent.askFirst) parts.push(ASK_FIRST_RULE);
    parts.push(
      'Termina siempre tu respuesta con una sección «Cambios realizados» que explique todo lo que has tocado: cada archivo creado, modificado o borrado (con su ruta relativa), qué cambió y por qué, y los comandos que hayas ejecutado. Si no has tocado nada, dilo.',
    );
  } else {
    parts.push(QUESTION_RULE);
    if (agent.askFirst) parts.push(ASK_FIRST_RULE);
    parts.push('Responde con el resultado final de tu tarea.');
  }
  if (opts.confirm) parts.push(CONFIRM_RULE);
  if (opts.deliverable) parts.push(deliverableSection(opts.deliverable));
  return parts.join('\n\n');
}

/** Bloques de lo obligatorio: incluido entero o exigido con su ubicación [R36.5][R36.6][R36.8]. */
function requiredSections(contexts: KnowledgeItem[], skills: KnowledgeItem[], mcp: KnowledgeItem[]): string[] {
  const out: string[] = [];
  if (contexts.length > 0) {
    const lines = contexts.map((c) => (c.mode === 'inline' ? `- ${c.name}:\n${c.content ?? ''}` : `- ${c.name}: OBLIGATORIO consultarlo antes de responder (${c.where}).`));
    out.push(`Contexto obligatorio: tenlo en cuenta siempre.\n${lines.join('\n')}`);
  }
  const inline = skills.filter((s) => s.mode === 'inline');
  if (inline.length > 0) out.push(`Skills obligatorias: síguelas en esta tarea.\n\n${inline.map((s) => `## ${s.name}\n\n${(s.content ?? '').trim()}`).join('\n\n')}`);
  const verify = skills.filter((s) => s.mode === 'verify');
  if (verify.length > 0) out.push(`Skills obligatorias: OBLIGATORIO leerlas antes de responder.\n${verify.map((s) => `- ${s.name}: léela en ${s.where}; sus archivos de referencia están en la misma carpeta, bajo referencias/.`).join('\n')}`);
  if (mcp.length > 0) out.push(`Servidores MCP obligatorios: OBLIGATORIO usar al menos una de sus herramientas antes de responder.\n${mcp.map((m) => `- ${m.name} (herramientas ${m.where})`).join('\n')}`);
  return out;
}

/** Mensaje del usuario: la tarea del nodo, su entrada y las respuestas ya dadas en intentos anteriores [R27.2][R32.2]. */
export function buildUserPrompt(input: Payload, previous: AnsweredQuestion[], task?: string, missed: string[] = []): string {
  const parts: string[] = [];
  if (task?.trim()) {
    parts.push(`Tu tarea en este paso:\n${task.trim()}`);
    parts.push(`Entrada recibida:\n${input.text.trim() || '(sin texto)'}`);
  } else parts.push(input.text.trim() || 'Empieza tu tarea.');
  if (input.files.length > 0) parts.push(`Archivos recibidos:\n${input.files.map((f) => `- ${f}`).join('\n')}`);
  if (previous.length > 0) parts.push(`Respuestas del usuario a tus preguntas anteriores:\n${previous.map((a) => `- ${a.question} → ${a.answer}`).join('\n')}`);
  if (missed.length > 0) parts.push(`En el intento anterior no usaste: ${missed.join(', ')} (obligatorio). Úsalo esta vez antes de responder.`);
  return parts.join('\n\n');
}
