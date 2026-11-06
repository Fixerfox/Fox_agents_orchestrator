import { type FieldProblem, type Id, LIMITS, isSafeId } from '../shared';

/** Skill del proyecto [R24.1]: se guarda como `SKILL.md` en formato nativo de Claude Code. */
export interface SkillDefinition {
  id: Id;
  name: string;
  description: string;
  /** Contenido en Markdown (sin la cabecera). */
  body: string;
}

export const SKILL_LIMITS = { body: 50_000 } as const;

export function newSkill(id: Id, name: string): SkillDefinition {
  return { id, name, description: '', body: '' };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Valida una skill [R24.1]. */
export function validateSkill(s: unknown): FieldProblem[] {
  if (!isObject(s)) return [{ field: 'skill', message: 'La skill no es válida' }];
  const out: FieldProblem[] = [];
  if (!isSafeId(s.id)) out.push({ field: 'id', message: 'El identificador no es válido' });
  const name = typeof s.name === 'string' ? s.name.trim() : '';
  if (name.length === 0) out.push({ field: 'name', message: 'Escribe un nombre' });
  else if (name.length > LIMITS.name) out.push({ field: 'name', message: `El nombre admite hasta ${LIMITS.name} caracteres` });
  const description = typeof s.description === 'string' ? s.description.trim() : '';
  if (description.length === 0) out.push({ field: 'description', message: 'Describe cuándo debe usarse la skill' });
  else if (description.length > LIMITS.description) out.push({ field: 'description', message: `La descripción admite hasta ${LIMITS.description} caracteres` });
  if (typeof s.body !== 'string') out.push({ field: 'body', message: 'El contenido no es válido' });
  else if (s.body.length > SKILL_LIMITS.body) out.push({ field: 'body', message: `El contenido admite hasta ${SKILL_LIMITS.body} caracteres` });
  return out;
}

export interface Frontmatter {
  /** Valores tal como aparecen; las listas `[a, b]` se devuelven como texto `a, b`. */
  data: Record<string, string>;
  body: string;
}

function unquote(raw: string): string {
  const v = raw.trim();
  if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) {
    try {
      return JSON.parse(v) as string;
    } catch {
      return v.slice(1, -1);
    }
  }
  if (v.startsWith("'") && v.endsWith("'") && v.length >= 2) return v.slice(1, -1).replace(/''/g, "'");
  if (v.startsWith('[') && v.endsWith(']')) return v.slice(1, -1).split(',').map((x) => unquote(x)).join(', ');
  return v;
}

/**
 * Lee la cabecera `---` de un Markdown (subconjunto de YAML: `clave: valor`, comillas,
 * listas en línea y bloques `|` / `>`). Sin cabecera, todo es cuerpo [R24.2][R25.2].
 */
export function parseFrontmatter(input: string): Frontmatter {
  const text = input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const m = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(text);
  if (!m) return { data: {}, body: text };
  const data: Record<string, string> = {};
  const lines = m[1]!.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const km = /^([A-Za-z_][\w-]*):[ \t]*(.*)$/.exec(lines[i]!);
    if (!km) continue;
    const key = km[1]!;
    const rest = km[2]!;
    const block: string[] = [];
    while (i + 1 < lines.length && (/^[ \t]+\S/.test(lines[i + 1]!) || lines[i + 1] === '')) {
      block.push(lines[i + 1]!);
      i++;
    }
    while (block.length > 0 && block[block.length - 1] === '') block.pop();
    const indent = Math.min(...block.filter((l) => l.trim() !== '').map((l) => /^[ \t]*/.exec(l)![0].length), Infinity);
    const dedented = block.map((l) => (l.trim() === '' ? '' : l.slice(indent)));
    if (/^[|>][+-]?$/.test(rest)) {
      data[key] = rest.startsWith('|') ? dedented.join('\n') : dedented.join(' ').replace(/\s+/g, ' ').trim();
    } else if (block.length > 0 && rest !== '' && !/^["']/.test(rest)) {
      data[key] = [rest, ...dedented].join(' ').replace(/\s+/g, ' ').trim();
    } else {
      data[key] = unquote(rest);
    }
  }
  return { data, body: text.slice(m[0].length).replace(/^\n+/, '') };
}

/** Escribe una skill como `SKILL.md`: cabecera con `name` y `description` (entre comillas) y el contenido [R24.2]. */
export function serializeSkillMd(skill: Pick<SkillDefinition, 'name' | 'description' | 'body'>): string {
  const body = skill.body.replace(/\s+$/, '');
  return `---\nname: ${JSON.stringify(skill.name.trim())}\ndescription: ${JSON.stringify(skill.description.trim())}\n---\n\n${body}\n`;
}

/** Lee un `SKILL.md`; `id` lo pone quien llama (nombre de la carpeta). */
export function parseSkillMd(id: Id, text: string): SkillDefinition {
  const { data, body } = parseFrontmatter(text);
  return { id, name: data['name'] ?? id, description: data['description'] ?? '', body: body.replace(/\s+$/, '') };
}
