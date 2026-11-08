import { branchMemoryLine, newBranchMemory, pathKey, rememberBranch, type Id, type RunEvent } from '@orquestador/core';
import { memoryCards, type MemoryCard } from './memory-cards';

export type SupervisorStatus = 'watching' | 'reviewing' | 'alert' | 'rules' | 'done';

export interface SupervisorTarget {
  key: string;
  warn: boolean;
}

/** Lo que enseñan la tarjeta del Supervisor y el panel de la memoria [R60.31]. */
export interface SupervisorView {
  status: SupervisorStatus;
  model?: string;
  reviewed: number;
  alerts: number;
  costUsd: number;
  branch?: string;
  /** Pasos en revisión ahora mismo: con agentes en paralelo pueden ser varios [R60.33]. */
  reviewing: string[];
  lastAlert?: string;
  targets: SupervisorTarget[];
  /** La memoria de la ejecución, por bloques [R72.22]. */
  memory: MemoryCard[];
}

/** Un aviso del Supervisor, con lo que hace falta para explicarlo [R60.39]. */
export interface SupervisorAlertItem {
  /** Paso del aviso; sin él, es de la ejecución entera. */
  key?: string;
  label: string;
  rule: string;
  detail: string;
  at: string;
  /** Para marcarlo como falso o acertado [R75.21]. */
  seq: number;
  /** Gravedad de la revisión con IA y la evidencia que cita [R75.10][R75.25]. */
  gravity?: string;
  evidence?: string[];
  /** Lo que dijo la persona del aviso [R75.21]. */
  feedback?: 'false-alarm' | 'confirmed';
}

export function supervisorAlerts(events: readonly RunEvent[], labelOf: (id: Id, path: readonly Id[]) => string): SupervisorAlertItem[] {
  const said = new Map<number, 'false-alarm' | 'confirmed'>();
  for (const e of events) if (e.type === 'supervisor.feedback') said.set(e.alertSeq, e.verdict);
  return events.flatMap((e) => {
    if (e.type !== 'supervisor.alert') return [];
    const path = e.nodePath ?? [];
    const step = e.nodeId === undefined ? { label: '' } : { key: pathKey(path, e.nodeId), label: labelOf(e.nodeId, path) };
    const feedback = said.get(e.seq);
    return [{ ...step, rule: e.rule, detail: e.detail, at: e.ts, seq: e.seq, ...(e.gravity ? { gravity: e.gravity } : {}), ...(e.evidence ? { evidence: e.evidence } : {}), ...(feedback ? { feedback } : {}) }];
  });
}

export function supervisorView(events: readonly RunEvent[], running: boolean, labelOf: (id: Id, path: readonly Id[]) => string): SupervisorView | undefined {
  let found = false;
  let reviews = false;
  let model: string | undefined;
  let reviewed = 0;
  let alerts = 0;
  let costUsd = 0;
  let lastAlert: string | undefined;
  const pending = new Map<string, { label: string; count: number }>();
  const warned = new Set<string>();
  const branches = newBranchMemory();
  for (const e of events) {
    const path = e.nodePath ?? [];
    switch (e.type) {
      case 'supervisor.started':
        found = true;
        reviews = e.review;
        model = e.model;
        break;
      case 'supervisor.reviewing':
      {
        const key = pathKey(path, e.nodeId);
        pending.set(key, { label: labelOf(e.nodeId, path), count: (pending.get(key)?.count ?? 0) + 1 });
        break;
      }
      case 'supervisor.note': {
        const key = pathKey(path, e.nodeId);
        const open = pending.get(key);
        if (open && open.count > 1) open.count--;
        else pending.delete(key);
        if (e.reviewed) reviewed++;
        break;
      }
      case 'supervisor.alert':
        alerts++;
        lastAlert = e.detail;
        if (e.nodeId !== undefined) warned.add(pathKey(path, e.nodeId));
        break;
      case 'supervisor.skipped':
        if (e.reason === 'failed') reviews = false;
        break;
      case 'agent.usage':
        if (e.source === 'supervisor') costUsd += e.costUsd ?? 0;
        break;
      case 'git.branch':
        rememberBranch(branches, e, labelOf(e.nodeId, path));
        break;
      default:
        break;
    }
  }
  if (!found) return undefined;
  const open = running ? [...pending.keys()] : [];
  const status: SupervisorStatus = !running ? 'done' : open.length > 0 ? 'reviewing' : !reviews ? 'rules' : alerts > 0 ? 'alert' : 'watching';
  const branch = branchMemoryLine(branches).replace(/^Rama de git: /, '');
  return {
    status,
    reviewed,
    alerts,
    costUsd,
    reviewing: open.map((key) => pending.get(key)!.label),
    targets: open.map((key) => ({ key, warn: warned.has(key) })),
    memory: memoryCards(events, labelOf),
    ...(model ? { model } : {}),
    ...(branch ? { branch } : {}),
    ...(lastAlert ? { lastAlert } : {}),
  };
}
