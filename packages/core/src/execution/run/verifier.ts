import { VERIFIER_AGENT_ID, VERIFY_MAX_COST_USD, VERIFY_MAX_MINUTES, VERIFY_SKILL_ID, type Id, type Payload, type VerifySettings } from '../../shared';
import type { VerifyFinding } from '../adapter';
import type { StepContext } from '../nodes/handler';
import { runInternalAgent } from './merge-agent';

/** Encabezado con el que termina el verificador [R75.15]. */
export const VERIFY_HEADING = '## Verificación';
const SEVERITY: Record<string, VerifyFinding['severity']> = { grave: 'high', alta: 'high', media: 'medium', medio: 'medium', leve: 'low', baja: 'low' };

/**
 * Lee la sección «## Verificación» [R75.15]: `Resultado: cumple|no cumple` y un hallazgo por línea,
 * `- [grave|media|leve] <dónde> — <qué>`. Sin sección o sin resultado, no se sabe (`undefined`).
 */
export function parseVerification(text: string): { met: boolean; findings: VerifyFinding[] } | undefined {
  const at = text.lastIndexOf(VERIFY_HEADING);
  if (at < 0) return undefined;
  const body = text.slice(at + VERIFY_HEADING.length).split(/\n##\s/)[0]!;
  const result = /^\s*Resultado:\s*(no cumple|cumple)\b/im.exec(body);
  if (!result) return undefined;
  const findings: VerifyFinding[] = [];
  for (const line of body.split('\n')) {
    const m = /^\s*[-*]\s*\[(grave|alta|media|medio|leve|baja)\]\s*(.+?)\s+[—–-]{1,2}\s+(.+)$/i.exec(line);
    if (m) findings.push({ severity: SEVERITY[m[1]!.toLowerCase()]!, where: m[2]!.trim(), what: m[3]!.trim() });
  }
  return { met: result[1]!.toLowerCase() === 'cumple', findings };
}

/** Encargo del verificador: lo pedido, la tarea, lo que entregó y que no arregle nada [R75.13][R75.16]. */
export function verifyTask(o: { order?: string; task?: string; output: Payload; label: string }): string {
  return [
    `Verifica el paso «${o.label}». No arregles nada: solo comprueba y cuenta lo que encuentres.`,
    ...(o.order ? ['', 'Lo que pidió la persona:', o.order.slice(0, 2000)] : []),
    ...(o.task ? ['', 'La tarea del paso:', o.task.slice(0, 2000)] : []),
    '',
    'Lo que el paso dice que hizo:',
    o.output.text.slice(0, 4000),
    ...(o.output.files.length > 0 ? ['', `Archivos que tocó: ${o.output.files.slice(0, 50).join(', ')}`] : []),
    '',
    `Termina con la sección «${VERIFY_HEADING}»: una línea «Resultado: cumple» o «Resultado: no cumple» y un hallazgo por línea con el formato «- [grave|media|leve] <archivo:línea o comando> — <qué>».`,
  ].join('\n');
}

/**
 * «Verificar con un agente» [R75.13]–[R75.15]: un agente que no puede editar ejecuta y observa, con su presupuesto y su
 * tiempo. Si un comando suyo cambia archivos, se avisa (`verifier-wrote`).
 */
export async function runVerifier(step: StepContext, at: { nodeId: Id; path: Id[]; label: string; task?: string }, output: Payload, settings: VerifySettings, order?: string): Promise<{ met: boolean; findings: VerifyFinding[] } | undefined> {
  const agentId = settings.agentId ?? VERIFIER_AGENT_ID;
  const task = verifyTask({ ...(order ? { order } : {}), ...(at.task ? { task: at.task } : {}), output, label: at.label });
  const r = await runInternalAgent(step, {
    nodeId: at.nodeId,
    agentId,
    path: at.path,
    input: { text: task, files: [...output.files] },
    task,
    kind: 'verify',
    ...(step.space ? { space: step.space } : {}),
    extra: { skillIds: settings.skillIds ?? [VERIFY_SKILL_ID] },
    maxCostUsd: settings.maxCostUsd ?? VERIFY_MAX_COST_USD,
    maxMinutes: settings.maxMinutes ?? VERIFY_MAX_MINUTES,
  });
  const wrote = [...new Set(r.files.map((f) => f.path))];
  if (wrote.length > 0) step.emitter.emit({ type: 'supervisor.alert', nodeId: at.nodeId, rule: 'verifier-wrote', severity: 'warning', detail: `El verificador cambió archivos al ejecutar comandos: ${wrote.slice(0, 10).join(', ')}` }, at.path);
  if (r.cut) step.emitter.emit({ type: 'supervisor.alert', nodeId: at.nodeId, rule: 'unverified-step', severity: 'info', detail: r.cut === 'budget' ? 'La verificación llegó a su presupuesto y se cortó.' : 'La verificación llegó a su tiempo máximo y se cortó.' }, at.path);
  const parsed = parseVerification(r.text);
  if (!parsed) {
    if (!r.cut && !step.signal.aborted) step.emitter.emit({ type: 'supervisor.alert', nodeId: at.nodeId, rule: 'unverified-step', severity: 'info', detail: 'El verificador no dejó su resultado en el formato esperado.' }, at.path);
    return undefined;
  }
  step.emitter.emit({ type: 'verify.result', nodeId: at.nodeId, met: parsed.met, findings: parsed.findings }, at.path);
  return parsed;
}
