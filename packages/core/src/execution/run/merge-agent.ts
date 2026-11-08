import type { Id, KnowledgeExtra, Payload } from '../../shared';
import type { SpaceRef } from '../branch-spaces';
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

/** Lo que dejó un paso interno. */
export interface InternalRun {
  ok: boolean;
  text: string;
  files: { path: string; via?: string }[];
  /** Se cortó por su presupuesto o su tiempo [R75.13]. */
  cut?: 'budget' | 'time';
}

/**
 * Un paso interno con un agente (juntar un conflicto [R73.15], verificar un paso [R75.14]): su rastro va al registro
 * con el `nodeId` del paso y su `kind`, y su gasto cuenta en el presupuesto como un paso más.
 */
export async function runInternalAgent(
  run: Pick<RunServices, 'emitter' | 'getAdapter' | 'questions' | 'signal' | 'budget' | 'timers'>,
  o: { nodeId: Id; agentId: Id; path: Id[]; input: Payload; task: string; kind: 'merge' | 'verify'; space?: SpaceRef; extra?: KnowledgeExtra; maxCostUsd?: number; maxMinutes?: number },
): Promise<InternalRun> {
  run.emitter.emit({ type: 'agent.request', nodeId: o.nodeId, agentId: o.agentId, attempt: 1, input: o.input, task: o.task, kind: o.kind, ...(o.space ? { isolated: true } : {}) }, o.path);
  const ask = (q: Parameters<RunServices['questions']['ask']>[2]) => run.questions.ask(o.nodeId, o.path, q);
  const own = new AbortController();
  const onAbort = () => own.abort();
  if (run.signal.aborted) own.abort();
  else run.signal.addEventListener('abort', onAbort, { once: true });
  let cut: InternalRun['cut'];
  const timer = o.maxMinutes !== undefined ? run.timers.set(() => ((cut = 'time'), own.abort()), o.maxMinutes * 60_000) : undefined;
  let spent = 0;
  let text = '';
  let result: string | undefined;
  const files: InternalRun['files'] = [];
  try {
    const stream = run.getAdapter(o.agentId).run({ nodeId: o.nodeId, agentId: o.agentId, runId: run.emitter.runId, input: o.input, task: o.task, attempt: 1, ask, previousAnswers: [], ...(o.space ? { workspace: { dir: o.space.dir } } : {}), ...(o.extra ? { extra: o.extra } : {}), ...(o.kind === 'verify' ? { verify: true } : {}) }, own.signal);
    for await (const ev of stream) {
      if (own.signal.aborted) break;
      switch (ev.type) {
        case 'token':
          text += ev.text;
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
          spent += ev.costUsd ?? 0;
          if (o.maxCostUsd !== undefined && spent >= o.maxCostUsd) {
            cut = 'budget';
            own.abort();
          }
          break;
        case 'file':
          files.push({ path: ev.path, ...(ev.via ? { via: ev.via } : {}) });
          run.emitter.emit({ type: 'file.produced', nodeId: o.nodeId, path: ev.path, ...(ev.change ? { change: ev.change } : {}), ...(ev.via ? { via: ev.via } : {}) }, o.path);
          break;
        case 'blocked':
          run.emitter.emit({ type: 'supervisor.alert', nodeId: o.nodeId, rule: 'blocked', severity: 'warning', detail: ev.detail }, o.path);
          break;
        case 'result':
          result = ev.text;
          break;
        default:
          break;
      }
    }
    return { ok: !own.signal.aborted, text: result ?? text, files, ...(cut ? { cut } : {}) };
  } catch (err) {
    if (run.signal.aborted) return { ok: false, text: result ?? text, files };
    if (!cut) run.emitter.emit({ type: 'error', nodeId: o.nodeId, message: `${o.kind === 'merge' ? 'El agente no pudo juntar los archivos' : 'El verificador falló'}: ${err instanceof Error ? err.message : String(err)}`, retriable: false }, o.path);
    return { ok: false, text: result ?? text, files, ...(cut ? { cut } : {}) };
  } finally {
    if (timer !== undefined) run.timers.clear(timer);
    run.signal.removeEventListener('abort', onAbort);
  }
}

/** «Que lo junte un agente» [R73.15]. */
export async function runMergeAgent(run: RunServices, o: { nodeId: Id; agentId: Id; path: Id[]; files: string[]; branches: [string, string]; space?: SpaceRef }): Promise<boolean> {
  const task = mergeTask(o.files, o.branches);
  const r = await runInternalAgent(run, { nodeId: o.nodeId, agentId: o.agentId, path: o.path, input: { text: task, files: [...o.files] }, task, kind: 'merge', ...(o.space ? { space: o.space } : {}) });
  return r.ok;
}
