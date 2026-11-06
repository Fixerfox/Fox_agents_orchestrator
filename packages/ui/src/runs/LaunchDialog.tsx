import { finalSteps, validateDiagram } from '@orquestador/core';
import type { ProjectApi } from '@orquestador/editor';
import { RunDialog } from './RunDialog';
import type { RunLauncher } from './useRunLauncher';
import type { RunsIndex } from './useRunsIndex';

interface Props {
  api: ProjectApi;
  launcher: RunLauncher;
  runsIndex: RunsIndex;
  engine: 'simulated' | 'claude';
  currentDiagramId: string;
  defaultMaxTokens: number | undefined;
  onEngine: (engine: 'simulated' | 'claude') => void;
}

/** Diálogo de lanzar el diagrama elegido [R52.7]. */
export function LaunchDialog({ api, launcher, runsIndex, engine, currentDiagramId, defaultMaxTokens, onEngine }: Props) {
  const { launch, lastInput, lastInputs, maxTokens } = launcher;
  if (!launch) return null;
  return (
    <RunDialog
      diagramName={launch.name}
      engine={engine}
      runnable={validateDiagram(launch).length === 0}
      lastInput={lastInputs.current.get(launch.id) ?? (launch.id === currentDiagramId ? lastInput : '')}
      defaultLimit={maxTokens ?? defaultMaxTokens}
      onEngine={onEngine}
      onStart={() => undefined}
      onLaunch={(o, l, d, f, opts) => void launcher.onLaunch(launch, o, l, d, f, opts)}
      busyRuns={{ running: runsIndex.runs.filter((r) => r.status === 'running' && r.diagramId === launch.id).length, queued: runsIndex.queue.filter((q) => q.diagramId === launch.id).length }}
      api={api}
      onClose={launcher.closeLaunch}
      deliverable={launch.deliverable}
      finals={finalSteps(launch).map((id) => launch.nodes.find((n) => n.id === id)?.label ?? id)}
      onSaveDeliverable={(spec) => launcher.saveDeliverableTo(launch, spec)}
    />
  );
}
