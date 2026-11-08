import { clipMiddle, type Id } from '../../shared';
import type { RunEvent } from '../events';
import { pathKey } from '../replay';
import { parseSplit } from '../text/split';

/** De dónde sale una entrada de la memoria [R72.1]. */
export interface Provenance {
  source: 'events' | 'supervisor' | 'agent';
  nodeId: Id;
  path: Id[];
  /** Pasada del paso (1, 2…) [R74.1]. */
  pass: number;
  seq: number;
}

export interface MemoryDecision extends Provenance {
  question: string;
  answer: string;
  kind: 'question' | 'unfinished' | 'gate' | 'confirm' | 'review' | 'correction' | 'conflict';
  auto?: boolean;
  /** Viene de la ejecución que esta reanuda o corrige [R72.21]. */
  previousRun?: boolean;
}

export interface MemoryAgreement extends Provenance {
  common: string;
  branches: { to: Id; files: string[] }[];
}

export interface MemoryNote extends Provenance {
  text: string;
}

export interface MemoryAlert extends Provenance {
  rule: string;
  detail: string;
}

export interface MemoryRoute extends Provenance {
  text: string;
}

export interface MemoryStepPass {
  pass: number;
  seq: number;
  status: 'succeeded' | 'failed' | 'cancelled' | 'skipped';
  summary: string;
  reviewed: boolean;
  decided: string[];
}

export interface MemoryStep {
  nodeId: Id;
  path: Id[];
  passes: MemoryStepPass[];
}

export interface MemoryFile extends Provenance {
  path_: string;
  change?: 'created' | 'modified';
}

/** La memoria de una ejecución, en bloques [R72.1]. */
export interface RunMemory {
  branch?: { name: string; createdBy?: { nodeId: Id; path: Id[] } };
  decisions: MemoryDecision[];
  agreements: MemoryAgreement[];
  notes: MemoryNote[];
  alerts: MemoryAlert[];
  route: MemoryRoute[];
  steps: MemoryStep[];
  files: MemoryFile[];
  /** Primer `seq` y pasada de cada `node.started`, para el alcance [R72.8]. */
  starts: { key: string; pass: number; seq: number }[];
}

/** Resumen sin revisión: el primer párrafo de la salida [R72.10]. */
export const FALLBACK_SUMMARY_CHARS = 300;
export const firstParagraph = (text: string): string => {
  const para = text.trim().split(/\n\s*\n/)[0] ?? '';
  const flat = para.replace(/\s+/g, ' ').trim();
  return flat.length > FALLBACK_SUMMARY_CHARS ? `${flat.slice(0, FALLBACK_SUMMARY_CHARS - 1).trimEnd()}…` : flat;
};

const QUESTION_KINDS = new Set(['question', 'unfinished', 'gate', 'conflict']);

/**
 * La memoria de la ejecución sacada de sus eventos [R72.1]: pura, sin llamar al motor ni leer archivos, así que da lo
 * mismo en vivo que sobre `events.jsonl` [R72.2].
 */
export function memoryFromEvents(events: readonly RunEvent[]): RunMemory {
  const m: RunMemory = { decisions: [], agreements: [], notes: [], alerts: [], route: [], steps: [], files: [], starts: [] };
  const passes = new Map<string, number>();
  const asked = new Map<string, { text: string; kind: MemoryDecision['kind'] | undefined; review: boolean; confirm: boolean }>();
  const steps = new Map<string, MemoryStep>();
  const notes = new Map<string, MemoryStepPass>();
  /** La revisión llega antes de cerrar el paso: se guarda y se aplica a su pasada [R72.10]. */
  const reviewed = new Map<string, { pass: number; text: string; decided: string[] }>();
  const dismissed = new Set<number>();
  /** Pasos reutilizados de la ejecución anterior: sus decisiones vienen de allí [R72.21]. */
  const reused = new Set<string>();
  for (const e of events) {
    if (e.type === 'supervisor.feedback' && e.verdict === 'false-alarm') dismissed.add(e.alertSeq);
  }
  const prov = (e: RunEvent, nodeId: Id, source: Provenance['source'] = 'events'): Provenance => {
    const path = [...(e.nodePath ?? [])];
    return { source, nodeId, path, pass: passes.get(pathKey(path, nodeId)) ?? 1, seq: e.seq };
  };
  const stepOf = (nodeId: Id, path: Id[]) => {
    const key = pathKey(path, nodeId);
    let s = steps.get(key);
    if (!s) {
      s = { nodeId, path, passes: [] };
      steps.set(key, s);
      m.steps.push(s);
    }
    return s;
  };
  for (const e of events) {
    const path = [...(e.nodePath ?? [])];
    switch (e.type) {
      case 'node.reused':
        reused.add(pathKey(path, e.nodeId));
        break;
      case 'node.started': {
        const key = pathKey(path, e.nodeId);
        const pass = (passes.get(key) ?? 0) + 1;
        passes.set(key, pass);
        m.starts.push({ key, pass, seq: e.seq });
        break;
      }
      case 'git.branch':
        // La última rama avisada; lo que solo se leyó vale si aún no hay ninguna [R60.26].
        if (e.via !== 'ran' || !m.branch) m.branch = { name: e.branch, ...(m.branch?.name === e.branch && m.branch.createdBy ? { createdBy: m.branch.createdBy } : {}) };
        if (e.created && m.branch.name === e.branch && !m.branch.createdBy) m.branch.createdBy = { nodeId: e.nodeId, path };
        break;
      case 'agent.question':
        asked.set(e.questionId, { text: e.text, kind: e.review ? 'review' : e.confirm ? 'confirm' : (e.kind as MemoryDecision['kind'] | undefined), review: !!e.review, confirm: !!e.confirm });
        break;
      case 'agent.answer': {
        const q = asked.get(e.questionId);
        // Los permisos son ruido para los siguientes [R72.4].
        if (!q || (q.kind !== undefined && !QUESTION_KINDS.has(q.kind) && !q.review && !q.confirm)) break;
        if (q.confirm && /^\s*(aprobar|aprobado|ok)\s*$/i.test(e.text)) break;
        m.decisions.push({ ...prov(e, e.nodeId), question: clipMiddle(q.text, 600), answer: clipMiddle(e.text, 600), kind: q.kind ?? 'question', ...(e.auto ? { auto: true } : {}), ...(reused.has(pathKey(path, e.nodeId)) ? { previousRun: true } : {}) });
        break;
      }
      case 'correction.applied':
        m.decisions.push({ ...prov(e, e.nodeId), question: 'Corrección pedida', answer: clipMiddle(e.text, 600), kind: 'correction' });
        break;
      case 'route.decided':
        m.route.push({ ...prov(e, e.fromNodeId), text: `eligió ${e.chosen.join(', ')}${e.reason ? `: ${e.reason}` : ''}` });
        break;
      case 'loop.iteration':
        m.route.push({ ...prov(e, e.loopId), text: `vuelta ${e.n} de ${e.max}: ${e.verdict === 'done' ? 'terminar' : 'continuar'}${e.reason ? ` — ${e.reason}` : ''}` });
        break;
      case 'review.decided':
        if (e.verdict !== 'approved') m.route.push({ ...prov(e, e.nodeId), text: `${e.verdict === 'exhausted' ? 'agotó sus vueltas' : 'rechazó'} (vuelta ${e.round})${e.reason ? ` — ${e.reason}` : ''}` });
        break;
      case 'memory.note': {
        // Una nota por pasada: si el paso se repite dentro de la misma pasada, vale la última [R72.11].
        const note = { ...prov(e, e.nodeId, 'agent'), text: e.text };
        m.notes = m.notes.filter((n) => !(n.nodeId === note.nodeId && pathKey(n.path, n.nodeId) === pathKey(note.path, note.nodeId) && n.pass === note.pass));
        m.notes.push(note);
        break;
      }
      case 'supervisor.alert':
        if (e.severity === 'warning' && e.nodeId !== undefined && !dismissed.has(e.seq)) m.alerts.push({ ...prov(e, e.nodeId), rule: e.rule, detail: e.detail });
        break;
      case 'supervisor.note': {
        if (!e.reviewed) break;
        const key = pathKey(path, e.nodeId);
        const pass = passes.get(key) ?? 1;
        reviewed.set(key, { pass, text: e.text, decided: [...(e.decided ?? [])] });
        const p = notes.get(key);
        if (p && p.pass === pass) Object.assign(p, { summary: e.text, reviewed: true, decided: [...(e.decided ?? [])] });
        break;
      }
      case 'file.produced':
        m.files = m.files.filter((f) => f.path_ !== e.path);
        m.files.push({ ...prov(e, e.nodeId), path_: e.path, ...(e.change ? { change: e.change } : {}) });
        break;
      case 'node.finished': {
        if (e.status === 'skipped') break;
        const key = pathKey(path, e.nodeId);
        if (!passes.has(key)) break;
        const out = e.output?.text ?? '';
        const entry: MemoryStepPass = { pass: passes.get(key)!, seq: e.seq, status: e.status as MemoryStepPass['status'], summary: firstParagraph(out), reviewed: false, decided: [] };
        // Solo los pasos que trabajan (agentes y transformar) dejan resumen; los demás dejan su rastro en «Camino».
        if (!isWorkStep(events, key)) break;
        const r = reviewed.get(key);
        if (r && r.pass === entry.pass) Object.assign(entry, { summary: r.text, reviewed: true, decided: r.decided });
        stepOf(e.nodeId, path).passes.push(entry);
        notes.set(key, entry);
        // El reparto válido del Coordinador queda como acuerdo [R72.5].
        const split = splitOf(events, key, out);
        if (split) m.agreements.push({ ...prov(e, e.nodeId), ...split });
        break;
      }
      default:
        break;
    }
  }
  return m;
}

/** ¿Pidió algo a un agente o transformó? Solo esos pasos tienen resumen [R72.10]. */
function isWorkStep(events: readonly RunEvent[], key: string): boolean {
  // Un paso reutilizado al reanudar también trabajó, en la ejecución anterior [R72.21].
  return events.some((e) => (e.type === 'agent.request' || e.type === 'transform.done' || e.type === 'node.reused') && pathKey(e.nodePath, e.nodeId) === key);
}

/** Lo común y los archivos de cada rama si el paso repartió bien [R72.5]. */
function splitOf(events: readonly RunEvent[], key: string, text: string): { common: string; branches: { to: Id; files: string[] }[] } | undefined {
  const req = [...events].reverse().find((e): e is Extract<RunEvent, { type: 'agent.request' }> => e.type === 'agent.request' && pathKey(e.nodePath, e.nodeId) === key);
  if (!req?.split) return undefined;
  const ids = [...new Set(events.filter((e): e is Extract<RunEvent, { type: 'edge.traversed' }> => e.type === 'edge.traversed' && pathKey(e.nodePath, e.fromNodeId) === key).map((e) => e.toNodeId))];
  const parsed = parseSplit(text, ids);
  if (!parsed.ok) return undefined;
  const parts = [...parsed.parts];
  return { common: clipMiddle(parts[0]?.[1].common ?? '', 1500), branches: parts.map(([to, p]) => ({ to, files: p.files })) };
}
