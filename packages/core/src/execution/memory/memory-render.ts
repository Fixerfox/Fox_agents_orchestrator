import type { Id } from '../../shared';
import type { RunMemory } from './run-memory';

/** Bloques en el orden en que se escriben [R72.14]. */
export const MEMORY_BLOCKS = ['branch', 'decisions', 'agreements', 'notes', 'alerts', 'route', 'steps', 'files'] as const;
export type MemoryBlock = (typeof MEMORY_BLOCKS)[number];

/** Tope por defecto y reparto entre bloques, en tokens [R72.15]. */
export const MEMORY_TOKENS = 2000;
const SHARES: Record<Exclude<MemoryBlock, 'branch'>, number> = { decisions: 400, agreements: 250, notes: 350, alerts: 150, route: 150, steps: 500, files: 200 };

/** Tokens estimados de un texto: caracteres ÷ 3,5 [R72.15]. */
export const estimateTokens = (text: string): number => Math.ceil(text.length / 3.5);

export interface RenderOptions {
  labelOf(nodeId: Id, path: readonly Id[]): string;
  /** Tope total; 2.000 por defecto [R72.15]. */
  tokens?: number;
  estimate?(text: string): number;
  /** Sin topes: la memoria completa, para `memory.md` y la pestaña [R72.20]. */
  full?: boolean;
}

export interface MemoryStats {
  tokens: Partial<Record<MemoryBlock, number>>;
  trimmed: MemoryBlock[];
}

const HEADERS: Record<Exclude<MemoryBlock, 'branch'>, string> = {
  decisions: 'Decisiones de la persona:',
  agreements: 'Acuerdos del reparto:',
  notes: 'Notas que dejaron otros pasos (escritas por agentes):',
  alerts: 'Avisos abiertos:',
  route: 'Camino tomado:',
  steps: 'Resumen de los pasos:',
  files: 'Archivos:',
};

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const omitted = (n: number, what: string) => `- (${n} ${what} anteriores omitidos)`;

/** Las líneas de cada bloque, de lo más antiguo a lo más nuevo, y cómo acortarlas [R72.16]. */
function blocks(m: RunMemory, o: RenderOptions): Record<Exclude<MemoryBlock, 'branch'>, { full: string[]; short?: string[]; what: string }> {
  const L = o.labelOf;
  const decision = (d: RunMemory['decisions'][number], n: number) => {
    const who = L(d.nodeId, d.path);
    const tail = `${d.auto ? ' (respondida sola: nadie respondió)' : ''}${d.previousRun ? ' (de la ejecución anterior)' : ''}`;
    return d.kind === 'correction' ? `- Corrección pedida en ${who}: «${clip(oneLine(d.answer), n)}»${tail}` : `- ${who} preguntó «${clip(oneLine(d.question), n)}» → «${clip(oneLine(d.answer), n)}»${tail}`;
  };
  const steps = m.steps.map((s) => {
    const last = s.passes.at(-1)!;
    const who = L(s.nodeId, s.path);
    const status = last.status === 'succeeded' ? '' : last.status === 'failed' ? ' (falló)' : ' (cancelado)';
    const decided = last.decided.length > 0 ? `; decidió: ${last.decided.join('; ')}` : '';
    const head = `- ${who}${status}: ${oneLine(last.summary) || '(sin salida)'}${last.reviewed ? '' : ' (sin revisar)'}${decided}`;
    const earlier = s.passes.slice(0, -1).map((p) => `  · pasada ${p.pass}: ${p.status === 'succeeded' ? 'terminó' : p.status === 'failed' ? 'falló' : 'se canceló'}${p.summary ? ` — ${clip(oneLine(p.summary), 80)}` : ''}`);
    return { full: [head, ...earlier].join('\n'), short: `- ${who}${status} (resumen omitido)` };
  });
  const byFolder = new Map<string, number>();
  for (const f of m.files) {
    const dir = f.path_.includes('/') ? `${f.path_.slice(0, f.path_.lastIndexOf('/'))}/` : './';
    byFolder.set(dir, (byFolder.get(dir) ?? 0) + 1);
  }
  return {
    decisions: { full: m.decisions.map((d) => decision(d, 300)), short: m.decisions.map((d) => decision(d, 160)), what: 'decisiones' },
    agreements: {
      full: m.agreements.map((a) => [`- De ${L(a.nodeId, a.path)}:${a.common ? ` ${oneLine(a.common)}` : ''}`, ...a.branches.map((b) => `  · ${L(b.to, a.path)}: ${b.files.join(', ')}`)].join('\n')),
      what: 'acuerdos',
    },
    notes: { full: m.notes.map((n) => `- ${L(n.nodeId, n.path)}: ${oneLine(n.text)}`), what: 'notas' },
    alerts: { full: m.alerts.map((a) => `- ${L(a.nodeId, a.path)}: ${oneLine(a.detail)}`), what: 'avisos' },
    route: { full: m.route.map((r) => `- ${L(r.nodeId, r.path)} ${oneLine(r.text)}`), what: 'decisiones del camino' },
    steps: { full: steps.map((s) => s.full), short: steps.map((s) => s.short), what: 'pasos' },
    files: {
      full: m.files.map((f) => `- ${f.path_} (${L(f.nodeId, f.path)}${f.change === 'created' ? ', creado' : f.change === 'modified' ? ', modificado' : ''})`),
      short: [...byFolder].map(([dir, n]) => `- ${dir} (${n} archivo${n === 1 ? '' : 's'})`),
      what: 'archivos',
    },
  };
}

/** Lo más nuevo que cabe, sin cortar líneas; lo que no cabe se cuenta al principio [R72.16]. */
function fit(lines: string[], budget: number, estimate: (s: string) => number, what: string): { lines: string[]; dropped: number } {
  const kept: string[] = [];
  let used = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const cost = estimate(`${lines[i]!}\n`);
    const note = i > 0 ? estimate(`${omitted(i, what)}\n`) : 0;
    if (used + cost + note > budget) return { lines: [omitted(i + 1, what), ...kept], dropped: i + 1 };
    kept.unshift(lines[i]!);
    used += cost;
  }
  return { lines: kept, dropped: 0 };
}

/**
 * La memoria tal como la recibe un paso [R72.14]–[R72.16]: bloques en orden fijo, cada uno con su título y su tope, y
 * lo que un bloque no usa pasa a los siguientes. La rama nunca se recorta.
 */
export function renderMemory(m: RunMemory, o: RenderOptions): { text: string | undefined; stats: MemoryStats } {
  const estimate = o.estimate ?? estimateTokens;
  const total = o.tokens ?? MEMORY_TOKENS;
  const scale = total / MEMORY_TOKENS;
  const stats: MemoryStats = { tokens: {}, trimmed: [] };
  const out: string[] = [];
  if (m.branch) {
    const by = m.branch.createdBy ? ` (creada por ${o.labelOf(m.branch.createdBy.nodeId, m.branch.createdBy.path)})` : '';
    const line = `Rama de git: ${m.branch.name}${by}`;
    out.push(line);
    stats.tokens.branch = estimate(line);
  }
  const all = blocks(m, o);
  let spare = 0;
  for (const b of MEMORY_BLOCKS) {
    if (b === 'branch') continue;
    const { full, short, what } = all[b];
    if (full.length === 0) {
      spare += Math.floor(SHARES[b] * scale);
      continue;
    }
    const budget = o.full ? Number.POSITIVE_INFINITY : Math.floor(SHARES[b] * scale) + spare - estimate(`${HEADERS[b]}\n`);
    let lines = full;
    const cost = (ls: string[]) => ls.reduce((n, l) => n + estimate(`${l}\n`), 0);
    if (cost(lines) > budget) {
      stats.trimmed.push(b);
      // Primero se acorta (si el bloque sabe) y luego se quitan las más antiguas [R72.16].
      if (b === 'steps' && short) {
        // Los más antiguos se quedan en una línea, de uno en uno, hasta que quepa; si no basta, se quitan [R72.16].
        let k = 0;
        const mix = (n: number) => [...short.slice(0, n), ...full.slice(n)];
        while (k < full.length && cost(mix(k)) > budget) k++;
        lines = cost(mix(k)) <= budget ? mix(k) : fit(short, budget, estimate, what).lines;
      } else if (short && cost(short) <= budget) lines = short;
      else lines = fit(short ?? full, budget, estimate, what).lines;
    }
    const used = cost(lines) + estimate(`${HEADERS[b]}\n`);
    stats.tokens[b] = used;
    spare = o.full ? 0 : Math.max(0, Math.floor(SHARES[b] * scale) + spare - used);
    out.push('', HEADERS[b], ...lines);
  }
  const text = out.join('\n').trim();
  return { text: text === '' ? undefined : text, stats };
}
