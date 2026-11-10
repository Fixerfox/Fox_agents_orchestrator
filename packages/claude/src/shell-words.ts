import path from 'node:path';

/** Separa un comando en palabras respetando comillas simples y dobles; `null` si quedan comillas abiertas. */
export function tokenize(segment: string): string[] | null {
  const out: string[] = [];
  let cur = '';
  let has = false;
  let quote: '"' | "'" | null = null;
  for (const ch of segment) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
    } else if (/\s/.test(ch)) {
      if (has || cur) out.push(cur);
      cur = '';
      has = false;
    } else {
      cur += ch;
      has = true;
    }
  }
  if (quote) return null;
  if (has || cur) out.push(cur);
  return out;
}

/** Nombre del programa sin ruta ni extensión de Windows. */
export const programOf = (word: string): string => path.basename(word).toLowerCase().replace(/\.(exe|cmd|bat)$/, '');

/** Separa un comando en tramos: `&&`, `||`, `;`, `|`, `&`, saltos de línea y sustituciones `$(…)` y `` `…` ``. */
export function segmentsOf(command: string): { text: string; piped: boolean }[] {
  const out: { text: string; piped: boolean }[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;
  let piped = false;
  const flush = (nextPiped: boolean) => {
    if (cur.trim()) out.push({ text: cur.trim(), piped });
    cur = '';
    piped = nextPiped;
  };
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!;
    const two = command.slice(i, i + 2);
    if (quote === "'") {
      if (ch === "'") quote = null;
      cur += ch;
      continue;
    }
    // Dentro de comillas dobles las sustituciones siguen ejecutándose.
    if (two === '$(' || ch === '`') {
      flush(false);
      if (two === '$(') i++;
      continue;
    }
    if (quote === '"') {
      if (ch === '"') quote = null;
      cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
    } else if (two === '&&' || two === '||') {
      flush(false);
      i++;
    } else if (ch === '|') flush(true);
    else if (ch === ';' || ch === '&' || ch === '\n' || ch === '\r' || ch === ')') flush(false);
    else cur += ch;
  }
  flush(false);
  return out;
}
