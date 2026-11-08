import { clipMiddle, redactString, stops, type Severity, type StopAt } from '../shared';
import type { RunEvent } from './events';

/** Lo que dice la persona de un aviso del Supervisor [R75.21]. */
export type FeedbackVerdict = 'false-alarm' | 'confirmed';

/** Un caso de referencia para medir el Supervisor [R75.23]. */
export interface SupervisorCase {
  schemaVersion: 1;
  runId: string;
  rule: string;
  detail: string;
  gravity?: string;
  evidence?: string[];
  /** Lo que recibió la revisión: el paso, su entrada y su entrega, recortados y sin secretos. */
  step?: { label?: string; input: string; output: string; files: string[] };
  person: { verdict: FeedbackVerdict; note?: string };
  at: string;
}

const short = (s: string, n: number) => redactString(clipMiddle(s, n));

/** El caso de un aviso marcado: la regla, lo que vio la revisión y lo que dijo la persona [R75.23]. */
export function supervisorCase(events: readonly RunEvent[], alertSeq: number, verdict: FeedbackVerdict, note: string | undefined, at: string): SupervisorCase | undefined {
  const alert = events.find((e): e is Extract<RunEvent, { type: 'supervisor.alert' }> => e.type === 'supervisor.alert' && e.seq === alertSeq);
  if (!alert) return undefined;
  const same = (e: RunEvent) => 'nodeId' in e && e.nodeId === alert.nodeId && (e.nodePath ?? []).join('/') === (alert.nodePath ?? []).join('/') && e.seq < alertSeq;
  const req = [...events].reverse().find((e): e is Extract<RunEvent, { type: 'agent.request' }> => e.type === 'agent.request' && same(e) && e.kind === undefined);
  const done = events.find((e): e is Extract<RunEvent, { type: 'node.finished' }> => e.type === 'node.finished' && 'nodeId' in e && e.nodeId === alert.nodeId && (e.nodePath ?? []).join('/') === (alert.nodePath ?? []).join('/') && (req ? e.seq > req.seq : true));
  return {
    schemaVersion: 1,
    runId: alert.runId,
    rule: alert.rule,
    detail: short(alert.detail, 1000),
    ...(alert.gravity ? { gravity: alert.gravity } : {}),
    ...(alert.evidence ? { evidence: alert.evidence.map((x) => short(x, 400)) } : {}),
    ...(req ? { step: { input: short(req.input.text, 3000), output: short(done?.output?.text ?? '', 3000), files: [...(done?.output?.files ?? [])].slice(0, 50) } } : {}),
    person: { verdict, ...(note?.trim() ? { note: short(note.trim(), 1000) } : {}) },
    at,
  };
}

/** Avisos por regla: cuántos hubo y cuántos se marcaron como falsos o acertados [R75.22]. */
export interface RuleStats {
  rule: string;
  alerts: number;
  falseAlarms: number;
  confirmed: number;
}

export function feedbackStats(runs: readonly (readonly RunEvent[])[]): RuleStats[] {
  const by = new Map<string, RuleStats>();
  for (const events of runs) {
    const rules = new Map<number, string>();
    for (const e of events) {
      if (e.type === 'supervisor.alert') {
        rules.set(e.seq, e.rule);
        const s = by.get(e.rule) ?? { rule: e.rule, alerts: 0, falseAlarms: 0, confirmed: 0 };
        s.alerts++;
        by.set(e.rule, s);
      }
    }
    // La última opinión de la persona sobre cada aviso es la que cuenta.
    const last = new Map<number, FeedbackVerdict>();
    for (const e of events) if (e.type === 'supervisor.feedback') last.set(e.alertSeq, e.verdict);
    for (const [seq, v] of last) {
      const rule = rules.get(seq);
      const s = rule ? by.get(rule) : undefined;
      if (!s) continue;
      if (v === 'false-alarm') s.falseAlarms++;
      else s.confirmed++;
    }
  }
  return [...by.values()].sort((a, b) => b.alerts - a.alerts || a.rule.localeCompare(b.rule));
}

/**
 * ¿Coincide un veredicto de la revisión con lo que dijo la persona? [R75.23] Un falso aviso coincide si la revisión ya
 * no pararía; uno acertado, si la revisión sigue diciendo que no.
 */
export function caseAgrees(c: Pick<SupervisorCase, 'person'>, v: { ok: boolean; severity?: Severity }, stopAt: StopAt = 'high'): boolean {
  const blocks = !v.ok && stops(v.severity ?? 'high', stopAt);
  return c.person.verdict === 'false-alarm' ? !blocks : !v.ok;
}
