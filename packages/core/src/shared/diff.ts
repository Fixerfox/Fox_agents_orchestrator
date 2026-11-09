/** Tope de líneas por lado para calcular un diff exacto; por encima, solo se cuentan [R75.7]. */
export const DIFF_MAX_LINES = 3000;

type Op = { k: ' ' | '-' | '+'; line: string };

/** Diferencias por líneas con LCS; para archivos grandes, `undefined` [R75.7]. */
function ops(a: string[], b: string[]): Op[] | undefined {
  if (a.length > DIFF_MAX_LINES || b.length > DIFF_MAX_LINES) return undefined;
  // Prefijo y sufijo comunes fuera: el caso habitual es un cambio pequeño en un archivo grande.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const x = a.slice(start, endA);
  const y = b.slice(start, endB);
  const n = x.length;
  const m = y.length;
  const lcs: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i]![j] = x[i] === y[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
  const out: Op[] = a.slice(0, start).map((line) => ({ k: ' ', line }));
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) {
      out.push({ k: ' ', line: x[i]! });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) out.push({ k: '-', line: x[i++]! });
    else out.push({ k: '+', line: y[j++]! });
  }
  while (i < n) out.push({ k: '-', line: x[i++]! });
  while (j < m) out.push({ k: '+', line: y[j++]! });
  for (const line of a.slice(endA)) out.push({ k: ' ', line });
  return out;
}

const split = (t: string) => (t === '' ? [] : t.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n'));

/** Líneas añadidas y quitadas entre dos versiones (aproximadas si son muy grandes) [R75.7]. */
export function lineStats(before: string, after: string): { added: number; removed: number } {
  const a = split(before);
  const b = split(after);
  const o = ops(a, b);
  if (!o) {
    const seen = new Set(a);
    const added = b.filter((l) => !seen.has(l)).length;
    return { added, removed: Math.max(0, a.length - (b.length - added)) };
  }
  return { added: o.filter((x) => x.k === '+').length, removed: o.filter((x) => x.k === '-').length };
}

/** Diff unificado con 3 líneas de contexto [R75.7]. Un archivo nuevo sale entero con `+`. */
export function unifiedDiff(path: string, before: string | undefined, after: string): string {
  const a = split(before ?? '');
  const b = split(after);
  const o = ops(a, b);
  const head = `--- ${before === undefined ? '/dev/null' : `a/${path}`}\n+++ b/${path}\n`;
  if (!o) return `${head}@@ (archivo grande: +${lineStats(before ?? '', after).added} −${lineStats(before ?? '', after).removed} líneas) @@\n`;
  const out: string[] = [];
  const CONTEXT = 3;
  let ai = 0;
  let bi = 0;
  let k = 0;
  while (k < o.length) {
    if (o[k]!.k === ' ') {
      ai++;
      bi++;
      k++;
      continue;
    }
    // Un bloque: desde 3 líneas antes del cambio hasta 3 después del último cambio cercano.
    const from = Math.max(0, k - CONTEXT);
    let to = k;
    let gap = 0;
    while (to < o.length && (o[to]!.k !== ' ' || gap < CONTEXT * 2)) {
      gap = o[to]!.k === ' ' ? gap + 1 : 0;
      to++;
    }
    to = Math.min(o.length, to - Math.max(0, gap - CONTEXT));
    const back = k - from;
    const aStart = ai - back;
    const bStart = bi - back;
    const hunk = o.slice(from, to);
    const aLen = hunk.filter((x) => x.k !== '+').length;
    const bLen = hunk.filter((x) => x.k !== '-').length;
    out.push(`@@ -${aStart + 1},${aLen} +${bStart + 1},${bLen} @@`);
    for (const x of hunk) out.push(`${x.k}${x.line}`);
    for (const x of o.slice(k, to)) {
      if (x.k !== '+') ai++;
      if (x.k !== '-') bi++;
    }
    k = to;
  }
  return head + out.join('\n') + (out.length > 0 ? '\n' : '');
}
