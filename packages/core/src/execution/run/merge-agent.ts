import type { SpaceRef } from '../branch-spaces';
import type { Id } from '../../shared';
import type { RunServices } from '../nodes/handler';

/** Encargo del agente que junta los archivos en conflicto [R73.15]. */
export function mergeTask(files: readonly string[], branches: readonly [string, string]): string {
  return [
    `Dos ramas que trabajaron en paralelo («${branches[0]}» y «${branches[1]}») cambiaron las mismas líneas de estos archivos:`,
    ...files.map((f) => `- ${f}`),
    '',
    'Cada archivo tiene marcas de conflicto de git (<<<<<<<, ||||||| para la base, ======= y >>>>>>>). Edítalos para juntar los dos cambios sin perder nada de ninguno y quita todas las marcas. No toques otros archivos ni uses git. Responde con lo que hiciste en cada archivo.',
  ].join('\n');
}

/**
 * Un paso interno que junta los archivos en conflicto [R73.15]: usa el agente del nodo que junta (o el último de la
 * rama), trabaja en el destino de la fusión y cuenta en el presupuesto y en el registro como un paso más.
 */
export async function runMergeAgent(run: RunServices, o: { nodeId: Id; agentId: Id; path: Id[]; files: string[]; branches: [string, string]; space?: SpaceRef }): Promise<boolean> {
  const task = mergeTask(o.files, o.branches);
  const input = { text: task, files: [...o.files] };
  run.emitter.emit({ type: 'agent.request', nodeId: o.nodeId, agentId: o.agentId, attempt: 1, input, task, kind: 'merge', ...(o.space ? { isolated: true } : {}) }, o.path);
  const ask = (q: Parameters<RunServices['questions']['ask']>[2]) => run.questions.ask(o.nodeId, o.path, q);
  try {
    const stream = run.getAdapter(o.agentId).run({ nodeId: o.nodeId, agentId: o.agentId, runId: run.emitter.runId, input, task, attempt: 1, ask, previousAnswers: [], ...(o.space ? { workspace: { dir: o.space.dir } } : {}) }, run.signal);
    for await (const ev of stream) {
      if (run.signal.aborted) return false;
      switch (ev.type) {
        case 'token':
          run.emitter.emit({ type: 'token.stream', nodeId: o.nodeId, text: ev.text }, o.path);
          break;
        case 'tool_call':
          run.emitter.emit({ type: 'tool.called', nodeId: o.nodeId, tool: ev.tool, input: ev.input }, o.path);
          break;
        case 'tool_result':
          run.emitter.emit({ type: 'tool.result', nodeId: o.nodeId, tool: ev.tool, ok: ev.ok, ...(ev.output !== undefined ? { output: ev.output } : {}) }, o.path);
          break;
        case 'usage':
          run.emitter.emit({ type: 'agent.usage', nodeId: o.nodeId, inputTokens: ev.inputTokens, outputTokens: ev.outputTokens, ...(ev.costUsd !== undefined ? { costUsd: ev.costUsd } : {}) }, o.path);
          run.budget.add(ev.inputTokens, ev.outputTokens, ev.costUsd);
          break;
        case 'file':
          run.emitter.emit({ type: 'file.produced', nodeId: o.nodeId, path: ev.path, ...(ev.change ? { change: ev.change } : {}), ...(ev.via ? { via: ev.via } : {}) }, o.path);
          break;
        case 'blocked':
          run.emitter.emit({ type: 'supervisor.alert', nodeId: o.nodeId, rule: 'blocked', severity: 'warning', detail: ev.detail }, o.path);
          break;
        default:
          break;
      }
    }
    return true;
  } catch (err) {
    if (run.signal.aborted) return false;
    run.emitter.emit({ type: 'error', nodeId: o.nodeId, message: `El agente no pudo juntar los archivos: ${err instanceof Error ? err.message : String(err)}`, retriable: false }, o.path);
    return false;
  }
}
