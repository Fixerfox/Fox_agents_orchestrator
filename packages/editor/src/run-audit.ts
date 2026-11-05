import { isApproval, pathKey, type Id, type RunEvent } from '@orquestador/core';

/**
 * Ficheros de cada paso, auditoría de las decisiones del usuario y relato de una ejecución, todo a partir de sus
 * eventos (SPEC-045). Sin React: lo usan el panel del paso, las pestañas de la ejecución y el informe exportado.
 */

type Labeler = (nodeId: Id, nodePath: readonly Id[]) => string;
const plainLabel: Labeler = (id) => id;
const SKIP = new Set(['entry', 'output']);
const ms = (iso: string | undefined) => (iso ? Date.parse(iso) : NaN);
const cut = (s: string, max = 160) => {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max).trimEnd()}…` : one;
};

// --- Ficheros (R45.4) ----------------------------------------------------------------------------

export type FileKind = 'created' | 'modified';

export interface StepFile {
  path: string;
  /** Sin tipo en ejecuciones anteriores a SPEC-045. */
  change?: FileKind;
  firstTs: string;
  lastTs: string;
  /** Pasadas del paso en que lo tocó. */
  passes: number[];
}

/** Recorre los eventos llevando la cuenta de la pasada de cada paso. */
function withPasses(events: readonly RunEvent[], visit: (e: RunEvent, key: string | undefined, pass: number) => void): void {
  const pass = new Map<string, number>();
  const open = new Set<string>();
  for (const e of events) {
    const key = 'nodeId' in e && typeof e.nodeId === 'string' ? pathKey(e.nodePath ?? [], e.nodeId) : undefined;
    if (key !== undefined && e.type === 'node.started' && !open.has(key)) {
      pass.set(key, (pass.get(key) ?? 0) + 1);
      open.add(key);
    }
    visit(e, key, key !== undefined ? (pass.get(key) ?? 1) : 0);
    if (key !== undefined && e.type === 'node.finished') open.delete(key);
  }
}

const merge = (prev: FileKind | undefined, next: FileKind | undefined): FileKind | undefined => (prev === 'created' || next === 'created' ? 'created' : (next ?? prev));

/** Ficheros que tocó un paso, en el orden en que los tocó; creado y luego retocado sigue siendo nuevo [R45.4]. */
export function stepFiles(events: readonly RunEvent[], key: string): StepFile[] {
  const out = new Map<string, StepFile>();
  withPasses(events, (e, k, pass) => {
    if (e.type !== 'file.produced' || k !== key) return;
    const f = out.get(e.path);
    if (!f) {
      out.set(e.path, { path: e.path, ...(e.change ? { change: e.change } : {}), firstTs: e.ts, lastTs: e.ts, passes: [pass] });
      return;
    }
    const change = merge(f.change, e.change);
    if (change) f.change = change;
    f.lastTs = e.ts;
    if (!f.passes.includes(pass)) f.passes.push(pass);
  });
  return [...out.values()];
}

/**
 * Archivos de cada paso para las fichas del lienzo, por clave `ruta/id`, en el orden en que se tocaron; cada uno con
 * su cambio acumulado [R54.1].
 */
export function filesByStep(events: readonly RunEvent[]): Record<string, { path: string; change?: FileKind }[]> {
  const out: Record<string, Map<string, { path: string; change?: FileKind }>> = {};
  for (const e of events) {
    if (e.type !== 'file.produced') continue;
    const key = [...(e.nodePath ?? []), e.nodeId].join('/');
    const files = (out[key] ??= new Map());
    const f = files.get(e.path);
    const change = merge(f?.change, e.change);
    files.set(e.path, { path: e.path, ...(change ? { change } : {}) });
  }
  return Object.fromEntries(Object.entries(out).map(([k, m]) => [k, [...m.values()]]));
}

/**
 * Archivos que hicieron los pasos del mismo nivel desde la decisión anterior de una revisión hasta su pregunta
 * `questionId`, sin repetir: lo que el usuario tiene que revisar [R54.6].
 */
export function filesSinceReview(events: readonly RunEvent[], reviewId: Id, nodePath: readonly Id[], questionId: string): { key: string; path: string }[] {
  const level = nodePath.join('/');
  const same = (e: RunEvent) => (e.nodePath ?? []).join('/') === level;
  const q = events.find((e) => e.type === 'agent.question' && e.questionId === questionId && e.nodeId === reviewId && same(e));
  if (!q) return [];
  let from = 0;
  for (const e of events) if (e.seq < q.seq && e.type === 'review.decided' && e.nodeId === reviewId && same(e)) from = e.seq;
  const out = new Map<string, { key: string; path: string }>();
  for (const e of events) {
    if (e.seq <= from || e.seq >= q.seq || e.type !== 'file.produced' || !same(e)) continue;
    const key = [...(e.nodePath ?? []), e.nodeId].join('/');
    out.set(`${key}|${e.path}`, { key, path: e.path.replace(/\\/g, '/') });
  }
  return [...out.values()];
}

export interface RunFile {
  path: string;
  change: FileKind;
  /** Pasos que lo tocaron, en orden. */
  steps: { key: string; nodeId: Id; nodePath: Id[] }[];
  firstTs: string;
  lastTs: string;
  /** Hay copia de antes de la ejecución (se puede restaurar). */
  backup: boolean;
  /** Lo cambió un comando: si era un archivo que ya existía, no hay copia [R55.5]. */
  byCommand: boolean;
}

/**
 * Ficheros de toda la ejecución con quién los tocó. Si el evento no dice el tipo, «modificado» cuando hay copia y
 * «nuevo» cuando no; un fichero con copia del que no hay evento también aparece, como modificado [R45.4].
 */
export function runFiles(events: readonly RunEvent[], backups: readonly string[] = []): RunFile[] {
  const out = new Map<string, RunFile & { kind?: FileKind }>();
  const copy = new Set(backups);
  for (const e of events) {
    if (e.type !== 'file.produced') continue;
    const np = e.nodePath ?? [];
    const key = pathKey(np, e.nodeId);
    let f = out.get(e.path);
    if (!f) {
      f = { path: e.path, change: 'created', steps: [], firstTs: e.ts, lastTs: e.ts, backup: copy.has(e.path), byCommand: false };
      out.set(e.path, f);
    }
    const kind = merge(f.kind, e.change);
    if (kind) f.kind = kind;
    if (e.via === 'command') f.byCommand = true;
    f.lastTs = e.ts;
    if (!f.steps.some((s) => s.key === key)) f.steps.push({ key, nodeId: e.nodeId, nodePath: [...np] });
  }
  for (const path of backups) if (!out.has(path)) out.set(path, { path, change: 'modified', steps: [], firstTs: '', lastTs: '', backup: true, byCommand: false, kind: 'modified' });
  return [...out.values()].map(({ kind, ...f }) => ({ ...f, change: kind ?? (f.backup ? 'modified' : 'created') }));
}

// --- Auditoría (R45.5, R45.6) --------------------------------------------------------------------

export type AuditGroup = 'answer' | 'permission' | 'confirm' | 'control';
export type AuditEffect = 'input' | 'answered' | 'allowed' | 'allowed-run' | 'denied' | 'approved' | 'changes' | 'paused' | 'resumed' | 'cancelled' | 'budget' | 'unanswered';

export interface AuditEntry {
  seq: number;
  ts: string;
  /** Paso al que afecta; sin él, es de la ejecución entera. */
  key?: string;
  nodeId?: Id;
  nodePath?: Id[];
  group: AuditGroup;
  /** Lo que se preguntó o lo que se hizo. */
  asked: string;
  /** Lo que respondió el usuario (vacío en pausas, cancelaciones y sin respuesta). */
  answer: string;
  effect: AuditEffect;
}

type QuestionEvent = Extract<RunEvent, { type: 'agent.question' }>;

/** Qué se preguntó, como se lee en la auditoría [R43.9][R53.15]. */
function askedOf(q: QuestionEvent): string {
  if (q.confirm) return `Confirmar antes de terminar · vuelta ${q.confirm.round}`;
  if (q.review) return q.review.phase === 'route' ? `A qué paso volver · vuelta ${q.review.round} de ${q.review.max}` : `Revisión humana · vuelta ${q.review.round} de ${q.review.max}`;
  return q.text;
}

/** Tipo de una pregunta; en ejecuciones anteriores a R45.3 se deduce del texto. */
export function questionGroup(q: Pick<QuestionEvent, 'text' | 'kind' | 'confirm'> & { review?: QuestionEvent['review'] }): 'answer' | 'permission' | 'confirm' | 'gate' {
  // Una revisión humana es una confirmación: aprobar o pedir cambios [R53.15].
  if (q.confirm || q.review) return 'confirm';
  if (q.kind === 'permission' || q.kind === 'gate') return q.kind;
  if (q.kind === 'question') return 'answer';
  if (/^¿Puedo (modificar |ejecutar este comando\?)/.test(q.text) || /^¿Puede usar «.+» del servidor MCP «.+»\?/.test(q.text)) return 'permission';
  if (/ha terminado sin consultarte\. ¿Doy por bueno su resultado\?$/.test(q.text)) return 'gate';
  return 'answer';
}

function effectOf(kind: ReturnType<typeof questionGroup>, answer: string): AuditEffect {
  const a = answer.trim();
  if (kind === 'permission') return a === 'Permitir' ? 'allowed' : a === 'Permitir en esta ejecución' ? 'allowed-run' : 'denied';
  if (kind === 'gate') return a === 'Dar por bueno' ? 'approved' : 'changes';
  if (kind === 'confirm') return isApproval(a) ? 'approved' : 'changes';
  return 'answered';
}

/** Decisiones del usuario en una ejecución, en orden [R45.5]. */
export function auditEntries(events: readonly RunEvent[]): AuditEntry[] {
  const out: AuditEntry[] = [];
  const open = new Map<string, { q: QuestionEvent; at: number }>();
  const node = (e: { nodeId: Id; nodePath?: Id[] }) => ({ key: pathKey(e.nodePath ?? [], e.nodeId), nodeId: e.nodeId, nodePath: [...(e.nodePath ?? [])] });
  let budget = false;
  for (const e of events) {
    switch (e.type) {
      case 'node.started':
        if (e.nodeId === 'entry' && !e.nodePath?.length && e.input) out.push({ seq: e.seq, ts: e.ts, group: 'control', asked: 'Lanzaste la ejecución', answer: e.input.text, effect: 'input' });
        break;
      case 'agent.question':
        open.set(e.questionId, { q: e, at: out.length });
        break;
      case 'agent.answer': {
        const o = open.get(e.questionId);
        open.delete(e.questionId);
        const q = o?.q;
        const kind = q ? questionGroup(q) : 'answer';
        out.push({ seq: e.seq, ts: e.ts, ...node(e), group: kind === 'gate' ? 'confirm' : kind, asked: q ? askedOf(q) : '', answer: e.text, effect: effectOf(kind, e.text) });
        break;
      }
      case 'run.paused':
        out.push({ seq: e.seq, ts: e.ts, group: 'control', asked: budget ? 'Se pausó al llegar al límite de presupuesto' : 'Pausaste la ejecución', answer: '', effect: 'paused' });
        budget = false;
        break;
      case 'run.resumed':
        out.push({ seq: e.seq, ts: e.ts, group: 'control', asked: 'Reanudaste la ejecución', answer: '', effect: 'resumed' });
        break;
      case 'run.cancelled':
        out.push({ seq: e.seq, ts: e.ts, group: 'control', asked: 'Cancelaste la ejecución', answer: e.reason ?? '', effect: 'cancelled' });
        break;
      case 'run.budget_reached':
        budget = true;
        out.push({ seq: e.seq, ts: e.ts, group: 'control', asked: `Límite de presupuesto (${e.limit === 'tokens' ? 'tokens' : 'coste'}): ${e.used} de ${e.max}`, answer: '', effect: 'budget' });
        break;
      default:
        break;
    }
  }
  // Las que quedaron sin responder, en el sitio en que se hicieron.
  const pending = [...open.values()].sort((a, b) => b.at - a.at);
  for (const { q, at } of pending) {
    const kind = questionGroup(q);
    out.splice(at, 0, { seq: q.seq, ts: q.ts, ...node(q), group: kind === 'gate' ? 'confirm' : kind, asked: askedOf(q), answer: '', effect: 'unanswered' });
  }
  return out.sort((a, b) => a.seq - b.seq);
}

export function auditCounts(entries: readonly AuditEntry[]): Record<'all' | AuditGroup, number> {
  const c = { all: entries.length, answer: 0, permission: 0, confirm: 0, control: 0 };
  for (const e of entries) c[e.group]++;
  return c;
}

export const AUDIT_EFFECT_LABEL: Record<AuditEffect, string> = {
  input: 'Entrada',
  answered: 'Respondida',
  allowed: 'Permitido',
  'allowed-run': 'Permitido en la ejecución',
  denied: 'Denegado',
  approved: 'Aprobado',
  changes: 'Pidió cambios',
  paused: 'Pausa',
  resumed: 'Sigue',
  cancelled: 'Cancelada',
  budget: 'Límite',
  unanswered: 'Sin responder',
};

const STATUS_LABEL: Record<string, string> = { running: 'En marcha', succeeded: 'Terminada', failed: 'Falló', cancelled: 'Cancelada', interrupted: 'Interrumpida' };
const clock = (iso: string) => (iso ? new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '');
const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

export interface AuditReportInfo {
  diagramName: string;
  status: string;
  startedAt?: string;
  durationS?: number;
  usage?: { tokens: number; costUsd: number };
  reason?: string;
  finalOutput?: string;
  backups?: readonly string[];
  labelOf?: Labeler;
}

/** Informe Markdown de la ejecución para guardar o compartir [R45.6]. */
export function auditReport(events: readonly RunEvent[], info: AuditReportInfo): string {
  const label = info.labelOf ?? plainLabel;
  const entries = auditEntries(events);
  const lines: string[] = [`# Auditoría · ${info.diagramName}`, ''];
  lines.push(`- **Estado:** ${STATUS_LABEL[info.status] ?? info.status}`);
  if (info.startedAt) lines.push(`- **Inicio:** ${new Date(info.startedAt).toLocaleString('es-ES')}`);
  if (info.durationS !== undefined) lines.push(`- **Duración:** ${Math.round(info.durationS)} s`);
  if (info.usage) lines.push(`- **Tokens:** ${info.usage.tokens.toLocaleString('es-ES')} · **Coste:** ${info.usage.costUsd.toFixed(3).replace('.', ',')} US$`);
  const input = entries.find((e) => e.effect === 'input');
  lines.push('', '## Entrada', '', input ? input.answer : '(sin entrada)', '', '## Decisiones', '');
  const decisions = entries.filter((e) => e.effect !== 'input');
  if (decisions.length === 0) lines.push('No hubo decisiones del usuario.');
  else {
    lines.push('| Hora | Paso | Qué se preguntó o hizo | Respuesta | Efecto |', '|---|---|---|---|---|');
    for (const e of decisions) lines.push(`| ${clock(e.ts)} | ${e.nodeId ? cell(label(e.nodeId, e.nodePath ?? [])) : '—'} | ${cell(e.asked)} | ${cell(e.answer) || '—'} | ${AUDIT_EFFECT_LABEL[e.effect]} |`);
  }
  lines.push('', '## Ficheros', '');
  const files = runFiles(events, info.backups);
  if (files.length === 0) lines.push('No se creó ni modificó ningún fichero.');
  else for (const f of files) lines.push(`- \`${f.path}\` · ${f.change === 'created' ? 'nuevo' : 'modificado'}${f.steps.length ? ` · ${f.steps.map((s) => label(s.nodeId, s.nodePath)).join(', ')}` : ''}`);
  lines.push('', '## Cómo terminó', '');
  if (info.status === 'failed' || info.status === 'interrupted' || info.status === 'cancelled') lines.push(info.reason ? `${STATUS_LABEL[info.status]}: ${info.reason}` : (STATUS_LABEL[info.status] ?? info.status));
  else lines.push(info.finalOutput?.trim() ? info.finalOutput.trim() : '(sin resultado final)');
  return lines.join('\n') + '\n';
}

// --- Relato (R45.8) ------------------------------------------------------------------------------

export type StoryClass = 'step' | 'file' | 'decision' | 'tool';

export interface StoryLine {
  seq: number;
  /** Segundos desde el arranque. */
  atS: number;
  who: string;
  /** El usuario, un paso o la ejecución. */
  whoKind: 'user' | 'step' | 'run';
  text: string;
  cls: StoryClass;
  tag?: string;
  key?: string;
}

const VERB: Record<FileKind, string> = { created: 'Creó', modified: 'Modificó' };
const STATUS_VERB: Record<string, string> = { succeeded: 'Terminó', failed: 'Falló', cancelled: 'Se canceló', skipped: 'Se saltó', interrupted: 'Se interrumpió' };

/** Relato de la ejecución en orden, con quién hizo qué [R45.8]. */
export function runStory(events: readonly RunEvent[], labelOf: Labeler = plainLabel): StoryLine[] {
  const t0 = ms(events[0]?.ts);
  const out: StoryLine[] = [];
  const questions = new Map<string, QuestionEvent>();
  withPasses(events, (e, key, pass) => {
    const atS = Number.isNaN(t0) ? 0 : Math.max(0, (ms(e.ts) - t0) / 1000);
    const np = e.nodePath ?? [];
    const inner = 'nodeId' in e && SKIP.has(e.nodeId as string);
    const step = (text: string, cls: StoryClass, tag?: string) => {
      if (!('nodeId' in e) || e.nodeId === undefined) return;
      out.push({ seq: e.seq, atS, who: labelOf(e.nodeId, np), whoKind: 'step', text, cls, ...(tag ? { tag } : {}), ...(key ? { key } : {}) });
    };
    const user = (text: string, tag: string, withKey = true) => out.push({ seq: e.seq, atS, who: 'Tú', whoKind: 'user', text, cls: 'decision', tag, ...(withKey && key ? { key } : {}) });
    switch (e.type) {
      case 'node.started':
        if (e.nodeId === 'entry' && np.length === 0 && e.input) user(`Lanzaste la ejecución con: «${cut(e.input.text)}»`, 'ENTRADA', false);
        else if (!inner) step(pass > 1 ? `Empezó (pasada ${pass})` : 'Empezó', 'step');
        break;
      case 'file.produced':
        step(`${e.change ? VERB[e.change] : 'Tocó'} ${e.path}`, 'file', e.change === 'created' ? 'NUEVO' : e.change === 'modified' ? 'MODIFICADO' : 'FICHERO');
        break;
      case 'agent.question': {
        questions.set(e.questionId, e);
        const g = questionGroup(e);
        step(g === 'confirm' ? 'Pide que confirmes lo que ha hecho' : g === 'permission' ? `Pide permiso: «${cut(e.text)}»` : `Preguntó: «${cut(e.text)}»`, 'step', 'ESPERA');
        break;
      }
      case 'agent.answer': {
        const q = questions.get(e.questionId);
        const eff = effectOf(q ? questionGroup(q) : 'answer', e.text);
        user(eff === 'answered' ? `Respondiste «${cut(e.text)}»` : `${AUDIT_EFFECT_LABEL[eff]}${e.text && eff === 'changes' ? `: «${cut(e.text)}»` : ` («${cut(e.text, 60)}»)`}`, 'DECISIÓN');
        break;
      }
      case 'review.decided':
        step(e.verdict === 'approved' ? 'Aprobó' : e.verdict === 'rejected' ? `Rechazó${e.reason ? `: «${cut(e.reason)}»` : ''}${e.returnTo ? ` → vuelve a ${labelOf(e.returnTo, np)}` : ''}` : 'Agotó las vueltas de revisión', 'step', e.verdict === 'approved' ? 'OK' : 'RETORNO');
        break;
      case 'node.retrying':
        step(`Reintento ${e.attempt} de ${e.max}: ${cut(e.message)}`, 'step', 'REINTENTO');
        break;
      case 'error':
        if (e.nodeId) step(`Error: ${cut(e.message)}`, 'step', 'ERROR');
        break;
      case 'node.finished':
        if (!inner && e.status !== 'succeeded') step(STATUS_VERB[e.status] ?? e.status, 'step', e.status === 'failed' ? 'ERROR' : undefined);
        else if (!inner) step('Terminó', 'step');
        break;
      case 'tool.called':
        step(`Usó ${e.tool}`, 'tool');
        break;
      case 'run.paused':
        user('Pausaste la ejecución', 'PAUSA', false);
        break;
      case 'run.resumed':
        user('Reanudaste la ejecución', 'SIGUE', false);
        break;
      case 'run.cancelled':
        user(`Cancelaste la ejecución${e.reason ? `: ${cut(e.reason)}` : ''}`, 'CANCELADA', false);
        break;
      case 'run.finished':
        out.push({ seq: e.seq, atS, who: 'Ejecución', whoKind: 'run', text: `${STATUS_LABEL[e.status] ?? e.status}${e.reason ? `: ${cut(e.reason)}` : ''}`, cls: 'step', tag: 'FIN' });
        break;
      default:
        break;
    }
  });
  return out;
}

export function storyFilter(lines: readonly StoryLine[], show: ReadonlySet<StoryClass>): StoryLine[] {
  return lines.filter((l) => show.has(l.cls));
}

/** «m:ss» (o «h:mm:ss») desde el arranque. */
export function storyClock(s: number): string {
  const v = Math.max(0, Math.floor(s));
  const h = Math.floor(v / 3600);
  const m = Math.floor((v % 3600) / 60);
  const sec = String(v % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}
