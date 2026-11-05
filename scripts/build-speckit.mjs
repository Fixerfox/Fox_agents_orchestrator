// Genera packages/editor/src/speckit-data.ts a partir de vendor/spec-kit (comandos y plantillas de GitHub Spec Kit,
// licencia MIT) [R38.15]. Adapta cada comando a una skill de Orquestador: quita los ganchos de extensiones y la
// cabecera de scripts, y explica cómo sustituir los scripts de Spec Kit (que aquí no existen).
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const vendor = join(root, 'vendor', 'spec-kit');
const source = readFileSync(join(vendor, 'SOURCE.txt'), 'utf8');
const commit = /Commit:\s*(\w+)/.exec(source)?.[1] ?? 'desconocido';
const license = readFileSync(join(vendor, 'LICENSE'), 'utf8');

/** Orden y plantillas de cada comando. */
const COMMANDS = {
  constitution: { name: 'Spec Kit · Constitución', es: 'Crea o actualiza los principios del proyecto (.specify/memory/constitution.md).', templates: ['constitution-template.md'] },
  specify: { name: 'Spec Kit · Especificar', es: 'Convierte una idea en la especificación de una funcionalidad (specs/NNN-nombre/spec.md): qué y por qué, sin tecnología.', templates: ['spec-template.md'] },
  clarify: { name: 'Spec Kit · Aclarar', es: 'Detecta lo ambiguo de la spec, hace hasta 5 preguntas concretas y guarda las respuestas en la spec.', templates: [] },
  plan: { name: 'Spec Kit · Planificar', es: 'Genera el plan técnico (plan.md, research.md, data-model.md, contratos y quickstart) a partir de la spec.', templates: ['plan-template.md'] },
  tasks: { name: 'Spec Kit · Tareas', es: 'Desglosa el plan en tasks.md: tareas ordenadas por dependencias y por historia, marcando lo paralelo.', templates: ['tasks-template.md'] },
  analyze: { name: 'Spec Kit · Analizar', es: 'Revisa sin modificar la coherencia entre spec.md, plan.md y tasks.md y con la constitución.', templates: [] },
  checklist: { name: 'Spec Kit · Checklist', es: 'Crea una checklist de calidad de los requisitos de la funcionalidad actual.', templates: ['checklist-template.md'] },
  implement: { name: 'Spec Kit · Implementar', es: 'Ejecuta tasks.md fase a fase y marca cada tarea hecha.', templates: [] },
  converge: { name: 'Spec Kit · Converger', es: 'Compara el código con spec, plan y tareas y añade a tasks.md lo que falte por construir.', templates: [] },
};

const preamble = (cmd, templates) =>
  [
    '## Running in Orquestador',
    '',
    `This skill is GitHub Spec Kit's \`/speckit.${cmd}\` command (commit ${commit.slice(0, 7)}, MIT license, see \`referencias/LICENSE-spec-kit.txt\`), adapted to run as an Orquestador step. Spec Kit's helper scripts and \`.specify/templates/\` are not installed here, so:`,
    '',
    '- **User input** is the task of this step plus what it receives from the previous step.',
    "- **Setup scripts** (`{SCRIPT}` below): do their job yourself. The current feature directory is `feature_directory` in `.specify/feature.json` if it exists; otherwise the highest-numbered folder under `specs/` (e.g. `specs/003-user-auth/`). FEATURE_DIR is that folder; FEATURE_SPEC is `spec.md`, IMPL_PLAN `plan.md` and TASKS `tasks.md` inside it; AVAILABLE_DOCS are the files among research.md, data-model.md, contracts/, quickstart.md and tasks.md that exist. Use absolute paths from the project folder.",
    templates.length > 0
      ? `- **Templates**: when a script would resolve or copy a template (\`TEMPLATE_CONTENT\`), read it from \`referencias/\` next to this SKILL.md: ${templates.map((t) => `\`referencias/${t}\``).join(', ')}.`
      : '- **Templates**: this step does not need one.',
    '- New features: create `specs/NNN-short-name/` with the next free three-digit number and record it in `.specify/feature.json` as `{ "feature_directory": "specs/NNN-short-name" }`.',
    '- The project constitution lives in `.specify/memory/constitution.md` (create the folder if needed).',
    '- Ignore extension hooks (`.specify/extensions.yml`) and git branch creation unless the task asks for them.',
    '- Other `/speckit.*` commands are the other «Spec Kit · …» skills; in a diagram they are separate steps, so when the text says to run one next, recommend it in your output instead.',
    '- Write the artifacts in English unless the task asks for another language, and answer the user in their language.',
    '',
  ].join('\n');

function dropSection(md, title) {
  const re = new RegExp(`\\n## ${title}[^\\n]*\\n[\\s\\S]*?(?=\\n## |$)`, 'g');
  return md.replace(re, '\n');
}

function adapt(cmd, raw, templates) {
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(raw);
  const description = /^description:\s*(.+)$/m.exec(fm?.[1] ?? '')?.[1]?.trim() ?? '';
  let body = fm ? raw.slice(fm[0].length) : raw;
  body = dropSection(body, 'Pre-Execution Checks');
  body = dropSection(body, 'Mandatory Post-Execution Hooks');
  body = body.replace(/```text\n\$ARGUMENTS\n```/g, '```text\n(the task of this step and what it receives)\n```');
  body = body.replace(/\$ARGUMENTS/g, 'the user input');
  body = body.replace(/\{ARGS\}/g, 'the user input');
  body = body.replace(/\{SCRIPT\}/g, 'the setup step (see «Running in Orquestador»)');
  body = body.replace(/__SPECKIT_COMMAND_([A-Z_]+)__/g, (_, c) => `/speckit.${c.toLowerCase()}`);
  body = body.replace(/\n{3,}/g, '\n\n').trim();
  return { description, body: `${preamble(cmd, templates)}\n${body}\n` };
}

const templates = Object.fromEntries(readdirSync(join(vendor, 'templates')).map((f) => [f, readFileSync(join(vendor, 'templates', f), 'utf8').replace(/__SPECKIT_COMMAND_([A-Z_]+)__/g, (_, c) => `/speckit.${c.toLowerCase()}`)]));
const skills = Object.entries(COMMANDS).map(([cmd, meta]) => {
  const { description, body } = adapt(cmd, readFileSync(join(vendor, 'commands', `${cmd}.md`), 'utf8'), meta.templates);
  return {
    id: `speckit-${cmd}`,
    name: meta.name,
    description: `${meta.es} (GitHub Spec Kit /speckit.${cmd}: ${description})`.slice(0, 1000),
    body,
    files: [{ path: 'referencias/LICENSE-spec-kit.txt', text: license }, ...meta.templates.map((t) => ({ path: `referencias/${t}`, text: templates[t] }))],
  };
});

const out = `// Generado por scripts/build-speckit.mjs a partir de vendor/spec-kit. No editar a mano.
// GitHub Spec Kit (https://github.com/github/spec-kit), commit ${commit}, licencia MIT.

export const SPECKIT_COMMIT = ${JSON.stringify(commit)};

export interface BuiltinSkill {
  id: string;
  name: string;
  description: string;
  body: string;
  files: { path: string; text: string }[];
}

export const SPECKIT_SKILLS: readonly BuiltinSkill[] = ${JSON.stringify(skills, null, 1)};
`;
writeFileSync(join(root, 'packages', 'editor', 'src', 'speckit-data.ts'), out);
console.log(`Spec Kit: ${skills.length} skills (${commit.slice(0, 7)}) → packages/editor/src/speckit-data.ts`);
