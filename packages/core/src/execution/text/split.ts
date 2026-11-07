import type { Id, Payload } from '../../shared';

/** Un paso entre los que se reparte el trabajo [R59.4]. */
export interface SplitBranch {
  id: Id;
  name: string;
  agent?: string;
  /** Ficha del agente [R59.18]. */
  purpose?: string;
  skills?: readonly string[];
  mcp?: readonly string[];
  task?: string;
}

/** Lo que recibe cada rama [R59.6]. */
export interface SplitPart {
  common: string;
  part: string;
  files: string[];
}

export type SplitProblem =
  | { code: 'missing-part' | 'unknown-part' | 'missing-files'; id: Id }
  | { code: 'overlap'; id: Id; other: Id; file: string };

export type SplitResult = { ok: true; parts: Map<Id, SplitPart> } | { ok: false; problems: SplitProblem[] };

const COMMON = /^##\s+com[uú]n\s*$/i;
const PART = /^##\s+para\s+(.+?)\s*$/i;
const FENCE = /^\s*(```|~~~)/;
const FILES = /^archivos:\s*(.*)$/i;

/** Regla que se añade al prompt del paso que reparte [R59.4]. */
export function splitRule(branches: readonly SplitBranch[]): string {
  const list = branches.map((b) =>
    [
      `- \`${b.id}\``,
      b.name,
      `agente: ${b.agent ?? 'sin agente'}`,
      ...(b.purpose?.trim() ? [`para qué sirve: ${b.purpose.trim().slice(0, 200)}`] : []),
      ...(b.skills ? [`skills: ${b.skills.join(', ') || 'ninguna'}`] : []),
      ...(b.mcp ? [`MCP: ${b.mcp.join(', ') || 'ninguno'}`] : []),
      `tarea: ${b.task?.trim() ? b.task.trim() : 'sin tarea'}`,
    ].join(' · '),
  );
  const example = branches[0]?.id ?? 'id';
  return [
    '## Reparto del trabajo',
    `Tu trabajo se repartirá entre ${branches.length} pasos que trabajan a la vez, aislados y sin hablarse:`,
    ...list,
    'Termina tu respuesta con estas secciones, con estos encabezados exactos:',
    '- `## Común`: lo compartido por todos (contratos, tipos, decisiones).',
    '- Una sección `## Para <id>` por cada paso, con el id de la lista y el trabajo de ese paso.',
    `Cada sección \`## Para <id>\` empieza con una línea \`Archivos: …\` con los archivos o carpetas que tocará ese paso, separados por comas (por ejemplo, \`## Para ${example}\` y debajo \`Archivos: src/login.ts, src/auth/\`).`,
    'Dos partes no pueden tocar el mismo archivo, ni uno dentro de una carpeta de otra.',
    'Lo que escribas antes de `## Común` no llega a ninguna rama, solo queda en el registro.',
  ].join('\n');
}

const normalize = (file: string): string =>
  file
    .trim()
    .replace(/^[`"']|[`"']$/g, '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/\*{1,2}$/, '')
    .replace(/\/+$/, '');

/** ¿Es `a` el mismo archivo que `b`, o está uno dentro de la carpeta del otro? */
const crosses = (a: string, b: string): boolean => a === b || a === '' || a === '.' || b === '' || b === '.' || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);

/** Archivos que declara la parte que recibió una rama [R60.16]. */
export function declaredFiles(text: string): string[] | undefined {
  const line = text.split(/\r?\n/).map((l) => FILES.exec(l.trim())).find((m) => m !== null);
  const files = (line?.[1] ?? '').split(',').map((f) => f.trim()).filter(Boolean);
  return files.length > 0 ? files : undefined;
}

/** ¿Está `file` en lo declarado, o dentro de una carpeta declarada? [R60.16] */
export function withinDeclared(file: string, declared: readonly string[]): boolean {
  const f = normalize(file);
  return declared.some((d) => {
    const n = normalize(d);
    return n === '' || n === '.' || f === n || f.startsWith(`${n}/`);
  });
}

/** Choques entre los archivos que declara cada parte [R59.6]. */
export function checkSplit(parts: ReadonlyMap<Id, Pick<SplitPart, 'files'>>): SplitProblem[] {
  const problems: SplitProblem[] = [];
  const list = [...parts];
  list.forEach(([id, { files }], i) => {
    for (const [other, theirs] of list.slice(i + 1)) {
      const file = files.find((f) => theirs.files.some((g) => crosses(normalize(f), normalize(g))));
      if (file !== undefined) problems.push({ code: 'overlap', id, other, file });
    }
  });
  return problems;
}

/** Secciones de una salida; lo que va antes de la primera no llega a nadie [R59.4]. */
function sections(output: string): { common: string[]; parts: Map<string, { title: string; lines: string[] }> } {
  const common: string[] = [];
  const parts = new Map<string, { title: string; lines: string[] }>();
  let current: string[] | undefined;
  let fenced = false;
  for (const line of output.split(/\r?\n/)) {
    if (FENCE.test(line)) fenced = !fenced;
    const part = fenced ? null : PART.exec(line);
    if (!fenced && COMMON.test(line)) {
      current = common;
    } else if (part) {
      const title = part[1]!.replace(/^[`<]+|[`>]+$/g, '');
      const key = title.toLowerCase();
      const found = parts.get(key) ?? { title, lines: [] };
      parts.set(key, found);
      current = found.lines;
    } else {
      current?.push(line);
    }
  }
  return { common, parts };
}

/** Lee las partes de la salida del paso que reparte [R59.6]. */
export function parseSplit(output: string, branchIds: readonly Id[]): SplitResult {
  const found = sections(output);
  const common = found.common.join('\n').trim();
  const problems: SplitProblem[] = [];
  const parts = new Map<Id, SplitPart>();
  const known = new Set(branchIds.map((id) => id.toLowerCase()));
  for (const [key, { title }] of found.parts) if (!known.has(key)) problems.push({ code: 'unknown-part', id: title });
  for (const id of branchIds) {
    const part = found.parts.get(id.toLowerCase())?.lines.join('\n').trim() ?? '';
    if (part === '') {
      problems.push({ code: 'missing-part', id });
      continue;
    }
    const declared = FILES.exec(part.split('\n')[0]!.trim());
    const files = (declared?.[1] ?? '').split(',').map((f) => f.trim()).filter(Boolean);
    if (files.length === 0) problems.push({ code: 'missing-files', id });
    parts.set(id, { common, part, files });
  }
  problems.push(...checkSplit(parts));
  return problems.length > 0 ? { ok: false, problems } : { ok: true, parts };
}

/** Entrada de cada rama: lo común y después su parte, y nada de las demás [R59.7]. */
export function splitInputs(output: Payload, branchIds: readonly Id[]): Map<Id, Payload> | undefined {
  const result = parseSplit(output.text, branchIds);
  if (!result.ok) return undefined;
  return new Map(
    [...result.parts].map(([id, p]) => {
      const text = [...(p.common ? [`## Común\n\n${p.common}`] : []), `## Para ${id}\n\n${p.part}`].join('\n\n');
      return [id, { text, files: [...output.files] }];
    }),
  );
}

/** Un problema, en la frase que leen el agente y el usuario [R59.8]. */
export function describeSplitProblem(p: SplitProblem): string {
  switch (p.code) {
    case 'missing-part':
      return `Falta la sección «## Para ${p.id}» o está vacía.`;
    case 'unknown-part':
      return `La sección «## Para ${p.id}» no es de ningún paso.`;
    case 'missing-files':
      return `La sección «## Para ${p.id}» no empieza con una línea «Archivos: …».`;
    case 'overlap':
      return `«${p.id}» y «${p.other}» se cruzan en «${p.file}».`;
  }
}

/** Entrada para repetir el paso: la original y qué corregir del reparto [R59.8]. */
export function composeSplitFix(input: Payload, problems: readonly SplitProblem[]): Payload {
  return { text: `${input.text}\n\n### Corrige el reparto\n\n${problems.map((p) => `- ${describeSplitProblem(p)}`).join('\n')}`, files: [...input.files] };
}
