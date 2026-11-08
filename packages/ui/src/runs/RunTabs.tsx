import type { RunEvent } from '@orquestador/core';
import { summarizeRun, supervisorAlerts, type ProjectApi } from '@orquestador/editor';
import { AuditPanel } from './AuditPanel';
import { LogViewer } from './LogViewer';
import { ProjectChanges } from './RunFiles';
import { Result, SummaryBody } from './RunSummary';
import { SupervisorPanel } from './SupervisorTab';
import { useEffect, useState } from 'react';
import type { RuleStats } from '@orquestador/core';
import { MemoryCards } from './MemoryCards';
import { MemoryProposals, useMemoryEntries } from './MemoryProposals';
import { Gantt, RunStory } from './Timeline';
import type { RunData } from './useRunData';

export type Btab = 'summary' | 'gantt' | 'log' | 'result' | 'files' | 'audit' | 'memory' | 'supervisor';

export const BTABS: Btab[] = ['summary', 'gantt', 'log', 'result', 'files', 'audit', 'memory', 'supervisor'];

/** Contenido de cada pestaña de una ejecución: el mismo abajo en la vista y en el modal [R35.10][R44.1]. */
export function RunTabBody({ tab, data: d, api, runId, selected, onPick, onExport, wide = false, onOpenFile, onOpenDeliverable, openPath, focusAlert, onAlert }: { focusAlert?: string | undefined; onAlert?: ((key?: string) => void) | undefined; tab: Btab; data: RunData; api: ProjectApi; runId: string; selected?: string | undefined; onPick: (key: string) => void; onExport: (runId: string, jsonl: string) => void; wide?: boolean; onOpenFile: (path: string) => void; onOpenDeliverable?: (path: string) => void; openPath?: string | undefined }) {
  if (!d.live) return null;
  if (tab === 'summary') {
    const summary = summarizeRun(d.events, d.label, 600, Date.now(), d.status === 'interrupted');
    return (
      <>
        <SummaryBody summary={summary} onPick={onPick} wide={wide} onAlert={onAlert} {...(onOpenDeliverable ? { onOpenDeliverable } : {})} />
        {/* «Para recordar» [R76.10]. */}
        <SummaryMemory events={d.events} api={api} runId={runId} />
      </>
    );
  }
  if (tab === 'supervisor') {
    const { supervisor } = summarizeRun(d.events, d.label, 600, Date.now(), d.status === 'interrupted');
    return supervisor ? <SupervisorTabWithFeedback watch={supervisor} events={d.events} label={d.label} api={api} runId={runId} focus={focusAlert} onPick={onPick} /> : null;
  }
  if (tab === 'memory') {
    // La memoria de la ejecución en su pestaña, como tarjetas [R69.6].
    const { supervisor } = summarizeRun(d.events, d.label, 600, Date.now(), d.status === 'interrupted');
    return supervisor ? (
      <div className="orq-rsum__sec">
        <MemoryCards notes={supervisor.notes} branch={supervisor.branch} warned={new Set(supervisor.alerts.map((a) => a.label))} />
      </div>
    ) : null;
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

/** La pestaña «Supervisor» con «No era un problema» / «Sí lo era» y lo que acierta cada regla [R75.21][R75.22]. */
function SupervisorTabWithFeedback({ watch, events, label, api, runId, focus, onPick }: { watch: Parameters<typeof SupervisorPanel>[0]['watch']; events: readonly RunEvent[]; label: RunData['label']; api: ProjectApi; runId: string; focus?: string | undefined; onPick: (key: string) => void }) {
  const [stats, setStats] = useState<{ run: RuleStats[]; recent: RuleStats[] }>();
  const marks = events.filter((e) => e.type === 'supervisor.feedback').length;
  useEffect(() => {
    let on = true;
    void api.supervisorStats?.(runId).then((r) => on && r.ok && setStats(r.value));
    return () => {
      on = false;
    };
  }, [api, runId, marks]);
  return (
    <SupervisorPanel
      watch={watch}
      alerts={supervisorAlerts(events, label)}
      focus={focus}
      onPick={onPick}
      onFeedback={(alertSeq, verdict) => void api.supervisorFeedback?.({ runId, alertSeq, verdict })}
      stats={stats}
    />
  );
}

/** «Para recordar» con las entradas actuales, para ver qué cambia una actualización [R76.10]. */
function SummaryMemory({ events, api, runId }: { events: readonly RunEvent[]; api: ProjectApi; runId: string }) {
  const decided = events.filter((e) => e.type === 'memory.decided').length;
  const entries = useMemoryEntries(api, decided);
  return <MemoryProposals events={events} api={api} runId={runId} entries={entries} />;
}
