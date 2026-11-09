import type { Diagram } from '../../diagrams';
import type { Payload, StepCheck, StopAt } from '../../shared';
import type { CheckRunner, EvidenceSource } from '../checks-port';
import { runChecks } from './checks';
import type { QuestionBroker } from './question-broker';
import type { RunEmitter } from './run-emitter';
import type { SupervisorDeps } from './supervisor';

/**
 * Lo que el Supervisor recibe de SPEC-075: umbral para parar, qué hacer si no se puede comprobar, la evidencia y las
 * comprobaciones del diagrama, que se ejecutan sobre la salida final y lo que tocó la ejecución [R75.10][R75.17][R75.20].
 */
export function supervisorExtras(
  watch: { stopAt?(): StopAt; unverified?(): 'warn' | 'fail' },
  checks: { runner?: CheckRunner; evidence?: EvidenceSource } | undefined,
  diagram: Diagram,
  run: { emitter: RunEmitter; questions: QuestionBroker; signal: AbortSignal; final(): Payload | undefined },
): Partial<SupervisorDeps> {
  const list: StepCheck[] = diagram.checks ?? [];
  const outputId = diagram.nodes.find((n) => n.kind === 'output')?.id ?? diagram.id;
  return {
    ...(watch.stopAt ? { stopAt: () => watch.stopAt!() } : {}),
    ...(watch.unverified ? { unverified: () => watch.unverified!() } : {}),
    ...(checks?.evidence ? { evidence: checks.evidence } : {}),
    ...(list.length > 0
      ? {
          runChecks: () => {
            const files = [...new Set(run.emitter.history().flatMap((e) => (e.type === 'file.produced' ? [e.path] : [])))];
            return runChecks({ emitter: run.emitter, questions: run.questions, runner: checks?.runner, signal: run.signal }, { nodeId: outputId, path: [] }, list, run.final() ?? { text: '', files: [] }, files);
          },
        }
      : {}),
  };
}
