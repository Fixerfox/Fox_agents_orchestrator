import type { RunEvent } from '@orquestador/core';
import { summarizeRun, supervisorAlerts, type ProjectApi } from '@orquestador/editor';
import { AuditPanel } from './AuditPanel';
import { LogViewer } from './LogViewer';
import { ProjectChanges } from './RunFiles';
import { Result, SummaryBody } from './RunSummary';
import { SupervisorPanel } from './SupervisorTab';
import { Gantt, RunStory } from './Timeline';
import type { RunData } from './useRunData';

export type Btab = 'summary' | 'gantt' | 'log' | 'result' | 'files' | 'audit' | 'supervisor';

export const BTABS: Btab[] = ['summary', 'gantt', 'log', 'result', 'files', 'audit', 'supervisor'];

/** Contenido de cada pestaña de una ejecución: el mismo abajo en la vista y en el modal [R35.10][R44.1]. */
export function RunTabBody({ tab, data: d, api, runId, selected, onPick, onExport, wide = false, onOpenFile, onOpenDeliverable, openPath, focusAlert, onAlert }: { focusAlert?: string | undefined; onAlert?: ((key?: string) => void) | undefined; tab: Btab; data: RunData; api: ProjectApi; runId: string; selected?: string | undefined; onPick: (key: string) => void; onExport: (runId: string, jsonl: string) => void; wide?: boolean; onOpenFile: (path: string) => void; onOpenDeliverable?: (path: string) => void; openPath?: string | undefined }) {
  if (!d.live) return null;
  if (tab === 'summary') {
    const summary = summarizeRun(d.events, d.label, 600, Date.now(), d.status === 'interrupted');
    return <SummaryBody summary={summary} onPick={onPick} wide={wide} onAlert={onAlert} {...(onOpenDeliverable ? { onOpenDeliverable } : {})} />;
  }
  if (tab === 'supervisor') {
    const { supervisor } = summarizeRun(d.events, d.label, 600, Date.now(), d.status === 'interrupted');
    return supervisor ? <SupervisorPanel watch={supervisor} alerts={supervisorAlerts(d.events, d.label)} focus={focusAlert} onPick={onPick} /> : null;
  }
  if (tab === 'gantt')
    return (
      <>
        <Gantt timeline={d.timeline} selected={selected} label={d.label} onPick={onPick} />
        <RunStory events={d.events} label={d.label} onPick={onPick} />
      </>
    );
  if (tab === 'audit') {
    const fin = d.events.find((e): e is Extract<RunEvent, { type: 'node.finished' }> => e.type === 'node.finished' && e.nodeId === 'output' && !e.nodePath?.length);
    return (
      <AuditPanel
        runId={runId}
        events={d.events}
        labelOf={d.label}
        info={{ diagramName: d.title, status: d.status, durationS: d.duration, ...(d.events[0] ? { startedAt: d.events[0].ts } : {}), ...(d.measured ? { usage: { tokens: d.tokens, costUsd: d.live.usage.costUsd } } : {}), ...(d.reason ? { reason: d.reason } : {}), ...(fin?.output?.text ? { finalOutput: fin.output.text } : {}) }}
      />
    );
  }
  if (tab === 'log') return <LogViewer events={[...d.events]} onExport={(jsonl) => onExport(runId, jsonl)} />;
  if (tab === 'result') return <Result api={api} runId={runId} live={d.live} running={d.running} label={d.label} duration={d.duration} usage={d.measured || d.running ? { tokens: d.tokens, costUsd: d.live.usage.costUsd } : undefined} openPath={openPath} />;
  return <ProjectChanges api={api} runId={runId} finished={!d.running} events={d.events} labelOf={d.label} onOpen={onOpenFile} />;
}
