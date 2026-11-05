/**
 * Markdown básico para los mensajes del asistente [R38.2]. Se analiza a una estructura y la interfaz la dibuja con
 * elementos propios: nunca se inserta HTML. Lo que no se cierra (p. ej. mientras llega el texto) queda como texto.
 */
export type MdInline =
  | { t: 'text'; v: string }
  | { t: 'br' }
  | { t: 'strong'; c: MdInline[] }
  | { t: 'em'; c: MdInline[] }
  | { t: 'code'; v: string }
  | { t: 'link'; text: string; url: string };

export type MdBlock =
  | { t: 'p'; c: MdInline[] }
  | { t: 'h'; level: 1 | 2 | 3; c: MdInline[] }
  | { t: 'ul'; items: MdInline[][] }
  | { t: 'ol'; start: number; items: MdInline[][] }
  | { t: 'code'; lang: string; v: string }
  | { t: 'quote'; c: MdInline[] }
  | { t: 'hr' };

const UL = /^\s{0,3}[-*+]\s+(.*)$/;
const OL = /^\s{0,3}(\d{1,4})[.)]\s+(.*)$/;
const H = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const FENCE = /^\s{0,3}(`{3,}|~{3,})\s*([\w+-]*)\s*$/;
const HR = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;

export function parseMarkdown(src: string): MdBlock[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const out: MdBlock[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length > 0) out.push({ t: 'p', c: inlineLines(para) });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const fence = FENCE.exec(line);
    if (fence) {
      flush();
      const mark = fence[1]!;
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trim().startsWith(mark)) body.push(lines[i++]!);
      out.push({ t: 'code', lang: fence[2] ?? '', v: body.join('\n') });
      continue;
    }
    if (line.trim() === '') {
      flush();
      continue;
    }
    if (HR.test(line)) {
      flush();
      out.push({ t: 'hr' });
      continue;
    }
    const h = H.exec(line);
    if (h) {
      flush();
      out.push({ t: 'h', level: Math.min(3, h[1]!.length) as 1 | 2 | 3, c: parseInline(h[2]!) });
      continue;
    }
    const q = QUOTE.exec(line);
    if (q) {
      flush();
      const body = [q[1]!];
      while (i + 1 < lines.length && QUOTE.test(lines[i + 1]!)) body.push(QUOTE.exec(lines[++i]!)![1]!);
      out.push({ t: 'quote', c: inlineLines(body) });
      continue;
    }
    const ul = UL.exec(line);
    const ol = OL.exec(line);
    if (ul || ol) {
      flush();
      const ordered = ol !== null;
      const re = ordered ? OL : UL;
      const items: string[][] = [[ordered ? ol![2]! : ul![1]!]];
      // Siguen los elementos de la misma lista y las líneas sangradas que continúan uno.
      while (i + 1 < lines.length) {
        const next = lines[i + 1]!;
        const m = re.exec(next);
        if (m) {
          items.push([ordered ? m[2]! : m[1]!]);
          i++;
        } else if (/^\s{2,}\S/.test(next) && !UL.test(next) && !OL.test(next)) {
          items[items.length - 1]!.push(next.trim());
          i++;
        } else if (/^\s{2,}/.test(next) && (UL.test(next) || OL.test(next))) {
          // sublista: se aplana como continuación con viñeta
          const sm = UL.exec(next) ?? OL.exec(next);
          items[items.length - 1]!.push(`• ${(sm![2] ?? sm![1])!}`);
          i++;
        } else break;
      }
      const parsed = items.map(inlineLines);
      out.push(ordered ? { t: 'ol', start: Number(ol![1]), items: parsed } : { t: 'ul', items: parsed });
      continue;
    }
    para.push(line);
  }
  flush();
  return out;
}

function inlineLines(lines: string[]): MdInline[] {
  const out: MdInline[] = [];
  lines.forEach((l, i) => {
    if (i > 0) out.push({ t: 'br' });
    out.push(...parseInline(l.trim()));
  });
  return out;
}

/** Negrita (`**`/`__`), cursiva (`*`/`_`), código y enlaces `[texto](url)` [R38.2]. */
export function parseInline(s: string): MdInline[] {
  const out: MdInline[] = [];
  let buf = '';
  const push = (n: MdInline) => {
    if (buf) out.push({ t: 'text', v: buf });
    buf = '';
    out.push(n);
  };
  let i = 0;
  while (i < s.length) {
    const c = s[i]!;
    if (c === '\\' && i + 1 < s.length && /[\\`*_[\]()#>-]/.test(s[i + 1]!)) {
      buf += s[i + 1];
      i += 2;
      continue;
    }
    if (c === '`') {
      const end = s.indexOf('`', i + 1);
      if (end > i) {
        push({ t: 'code', v: s.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if (c === '[') {
      const m = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(s.slice(i));
      if (m) {
        push({ t: 'link', text: m[1]!, url: m[2]! });
        i += m[0].length;
        continue;
      }
    }
    if ((c === '*' || c === '_') && s[i + 1] === c) {
      const mark = c + c;
      const end = s.indexOf(mark, i + 2);
      if (end > i + 2) {
        push({ t: 'strong', c: parseInline(s.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }
    if (c === '*' || c === '_') {
      // `_` dentro de una palabra (nombre_de_variable) no es cursiva
      const wordBefore = i > 0 && /\w/.test(s[i - 1]!);
      const end = s.indexOf(c, i + 1);
      if (!(c === '_' && wordBefore) && end > i + 1 && s[i + 1] !== ' ' && s[end - 1] !== ' ' && !(c === '_' && end + 1 < s.length && /\w/.test(s[end + 1]!))) {
        push({ t: 'em', c: parseInline(s.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }
    buf += c;
    i++;
  }
  if (buf) out.push({ t: 'text', v: buf });
  return out;
}
