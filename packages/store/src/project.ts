import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  AGENT_SCHEMA_VERSION,
  CONTEXT_SCHEMA_VERSION,
  CURRENT_SCHEMA_VERSION,
  containsSecrets,
  isRelativeInside,
  planSkillFiles,
  type SourceFile,
  parseSkillMd,
  serializeSkillMd,
  validateAgent,
  validateSkill,
  withoutSkill,
  validateContext,
  withoutContext,
  validateMcpServer,
  MCP_SCHEMA_VERSION,
  type McpServerDefinition,
  type McpScope,
  type AgentDefinition,
  type ContextDefinition,
  type Diagram,
  type Id,
  type SkillDefinition,
  emptyLibraryFolders,
  tidyLibraryFolders,
  validateLibraryFolders,
  type LibraryFolders,
} from '@orquestador/core';
import { atomicWrite } from './fs-util';
import { readRunLog } from './run-log';
import { StoreError } from './errors';
import { ProjectPaths } from './paths';
import { randomUUID } from 'node:crypto';

/** Límites de los adjuntos de la entrada [R48.3][R48.4]. */
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const MAX_INPUT_FILES = 20;
const RESERVED_DIRS = new Set(['.git', '.orquestador', 'node_modules']);
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp)$/i;
export const isImageName = (name: string): boolean => IMAGE_EXT.test(name);

/** Nombre de archivo sin rutas ni caracteres que Windows no admite [R48.4]. */
export function safeFileName(name: string): string {
  const last = name.split(/[\\/]/).pop() ?? '';
  const visible = [...last].map((c) => (c.charCodeAt(0) < 32 ? '_' : c)).join('');
  const clean = visible.replace(/[<>:"|?*]/g, '_').replace(/^[.\s]+|[.\s]+$/g, '').slice(0, 120);
  return clean || 'adjunto';
}

export interface AttachmentView {
  id: string;
  name: string;
  size: number;
  image: boolean;
}
import { JsonCollection, readVersioned, writeVersioned, type VersionedSpec } from './versioned-json';

export const PROJECT_SCHEMA_VERSION = 1;

export interface ProjectFile {
  schemaVersion: number;
  name: string;
  createdAt: string;
  /** Versiones fijadas de elementos de la biblioteca global (M5). */
  pins: Record<string, number | 'latest'>;
}

const projectSpec: VersionedSpec = { kind: 'project.json', current: PROJECT_SCHEMA_VERSION };
const agentSpec: VersionedSpec = { kind: 'agente', current: AGENT_SCHEMA_VERSION };
const contextSpec: VersionedSpec = { kind: 'contexto', current: CONTEXT_SCHEMA_VERSION };
const mcpSpec: VersionedSpec = { kind: 'servidor MCP', current: MCP_SCHEMA_VERSION };
const diagramSpec: VersionedSpec = { kind: 'diagrama', current: CURRENT_SCHEMA_VERSION };

/** Lo que devuelve el visor de un fichero de la ejecución [R45.11]. */
export interface RunFileView {
  path: string;
  /** El fichero ya no existe en la carpeta. */
  missing: boolean;
  /** No es texto: no se muestra el contenido. */
  binary: boolean;
  current?: { text: string; truncated: boolean };
  /** Copia de antes de que la ejecución lo modificara, si la hay. */
  before?: { text: string; truncated: boolean };
}

export const RUN_FILE_MAX = 200_000;

export class ProjectStore {
  readonly paths: ProjectPaths;
  readonly diagrams: JsonCollection<Diagram>;
  readonly templates: JsonCollection<Diagram>;
  readonly agents: JsonCollection<AgentDefinition>;
  readonly contexts: JsonCollection<ContextDefinition>;
  readonly mcp: JsonCollection<McpServerDefinition>;
  /** Servidores MCP de la app, compartidos por todos los proyectos [R30.9]. */
  private appMcp: JsonCollection<McpServerDefinition> | undefined;

  private constructor(root: string) {
    this.paths = new ProjectPaths(root);
    this.diagrams = new JsonCollection<Diagram>(this.paths.diagramsDir, diagramSpec);
    this.templates = new JsonCollection<Diagram>(this.paths.templatesDir, { ...diagramSpec, kind: 'plantilla' });
    this.agents = new JsonCollection<AgentDefinition>(this.paths.agentsDir, agentSpec);
    this.contexts = new JsonCollection<ContextDefinition>(this.paths.contextsDir, contextSpec);
    this.mcp = new JsonCollection<McpServerDefinition>(this.paths.mcpDir, mcpSpec);
  }

  static async create(root: string, opts: { name: string; now?: () => Date }): Promise<ProjectStore> {
    const store = new ProjectStore(root);
    try {
      await fs.access(store.paths.projectFile);
      throw new StoreError('exists', `Ya existe un proyecto en ${root}`);
    } catch (err) {
      if (err instanceof StoreError) throw err;
    }
    for (const dir of store.paths.all) await fs.mkdir(dir, { recursive: true });
    const file: ProjectFile = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      name: opts.name,
      createdAt: (opts.now?.() ?? new Date()).toISOString(),
      pins: {},
    };
    await writeVersioned(store.paths.projectFile, file as unknown as Record<string, unknown>, projectSpec);
    return store;
  }

  static async open(root: string): Promise<ProjectStore> {
    const store = new ProjectStore(root);
    try {
      await readVersioned<ProjectFile>(store.paths.projectFile, projectSpec);
    } catch (err) {
      if (err instanceof StoreError && err.code === 'not-found') {
        throw new StoreError('not-a-project', `${root} no es un proyecto de Orquestador`);
      }
      throw err;
    }
    return store;
  }

  async info(): Promise<ProjectFile> {
    return (await readVersioned<ProjectFile>(this.paths.projectFile, projectSpec)).data;
  }

  async listAgents(): Promise<AgentDefinition[]> {
    const out: AgentDefinition[] = [];
    for (const id of await this.agents.list()) {
      const a = await this.agents.load(id);
      out.push({ ...a, skillIds: a.skillIds ?? [] });
    }
    return out;
  }

  // --- skills (SPEC-024) ---

  async listSkillIds(): Promise<Id[]> {
    try {
      const entries = await fs.readdir(this.paths.skillsDir, { withFileTypes: true });
      const ids: Id[] = [];
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        try {
          await fs.access(path.join(this.paths.skillDir(e.name), 'SKILL.md'));
          ids.push(e.name);
        } catch {
          /* carpeta sin SKILL.md o con nombre no válido: se ignora */
        }
      }
      return ids.sort();
    } catch {
      return [];
    }
  }

  async loadSkill(id: Id): Promise<SkillDefinition> {
    try {
      return parseSkillMd(id, await fs.readFile(path.join(this.paths.skillDir(id), 'SKILL.md'), 'utf8'));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new StoreError('not-found', `No existe la skill ${id}`);
      throw err;
    }
  }

  async listSkills(): Promise<SkillDefinition[]> {
    const out: SkillDefinition[] = [];
    for (const id of await this.listSkillIds()) out.push(await this.loadSkill(id));
    return out;
  }

  /** Guarda `SKILL.md` en formato nativo y conserva el resto de archivos de la carpeta [R24.2][R24.3]. */
  async saveSkill(skill: SkillDefinition): Promise<void> {
    const problems = validateSkill(skill);
    if (problems.length > 0) throw new StoreError('invalid', problems[0]!.message, problems);
    if (containsSecrets([skill.name, skill.description, skill.body])) {
      throw new StoreError('secrets', 'La skill contiene algo que parece una clave o un token; quítalo antes de guardar');
    }
    await atomicWrite(path.join(this.paths.skillDir(skill.id), 'SKILL.md'), serializeSkillMd(skill));
  }

  /** Archivos de la carpeta de la skill (sin `SKILL.md`), con ruta relativa y tamaño [R24.3]. */
  async skillFiles(id: Id): Promise<{ path: string; size: number }[]> {
    const root = this.paths.skillDir(id);
    const out: { path: string; size: number }[] = [];
    const walk = async (dir: string, rel: string): Promise<void> => {
      for (const e of await fs.readdir(dir, { withFileTypes: true })) {
        const r = rel === '' ? e.name : `${rel}/${e.name}`;
        if (e.isDirectory()) await walk(path.join(dir, e.name), r);
        else if (e.isFile() && r !== 'SKILL.md' && out.length < 1000) out.push({ path: r, size: (await fs.stat(path.join(dir, e.name))).size });
      }
    };
    try {
      await walk(root, '');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new StoreError('not-found', `No existe la skill ${id}`);
      throw err;
    }
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  /** Añade un archivo auxiliar a una skill; la ruta debe ser relativa y quedarse dentro de la carpeta [R25.6]. */
  async writeSkillFile(id: Id, rel: string, data: Uint8Array): Promise<void> {
    if (!isRelativeInside(rel) || rel === 'SKILL.md') throw new StoreError('outside-root', 'Ruta de archivo no válida en la skill');
    const file = path.join(this.paths.skillDir(id), ...rel.split(/[\\/]/));
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, data);
  }

  /** Copia archivos de referencia a la skill bajo `referencias/` sin sobrescribir nada [R24.9][R24.10]. */
  async addSkillFiles(id: Id, incoming: SourceFile[]): Promise<{ added: { path: string; size: number }[]; scripts: string[]; renamed: number }> {
    await this.loadSkill(id);
    const plan = planSkillFiles(await this.skillFiles(id), incoming);
    if (!plan.ok) throw new StoreError('invalid', plan.message);
    for (const f of plan.add) await this.writeSkillFile(id, f.path, f.data);
    return { added: plan.add.map((f) => ({ path: f.path, size: f.data.length })), scripts: plan.scripts, renamed: plan.renamed };
  }

  /** Quita un archivo de la skill; `SKILL.md` no se puede quitar por aquí [R24.11]. */
  async removeSkillFile(id: Id, rel: string): Promise<boolean> {
    if (!isRelativeInside(rel) || rel === 'SKILL.md') throw new StoreError('outside-root', 'Ruta de archivo no válida en la skill');
    const file = path.join(this.paths.skillDir(id), ...rel.split(/[\\/]/));
    try {
      await fs.rm(file);
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw err;
    }
  }

  /** Contenido de texto de un archivo de la skill (hasta 200 000 caracteres) [R24.12]. */
  async readSkillFile(id: Id, rel: string): Promise<{ text: string; truncated: boolean }> {
    if (!isRelativeInside(rel) || rel === 'SKILL.md') throw new StoreError('outside-root', 'Ruta de archivo no válida en la skill');
    const file = path.join(this.paths.skillDir(id), ...rel.split(/[\\/]/));
    let buf: Buffer;
    try {
      buf = await fs.readFile(file);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new StoreError('not-found', 'No existe ese archivo');
      throw err;
    }
    if (buf.subarray(0, 8000).includes(0)) throw new StoreError('invalid', 'Este archivo no es de texto y no se puede mostrar');
    const text = buf.toString('utf8');
    return text.length > 200_000 ? { text: text.slice(0, 200_000), truncated: true } : { text, truncated: false };
  }

  /** Crea o reescribe un archivo de texto de la skill; no toca binarios ni `SKILL.md` [R32.35]. */
  async saveSkillText(id: Id, rel: string, text: string): Promise<void> {
    if (!isRelativeInside(rel) || rel === 'SKILL.md') throw new StoreError('outside-root', 'Ruta de archivo no válida en la skill');
    if (text.length > 200_000) throw new StoreError('invalid', 'El archivo es demasiado largo (máximo 200 000 caracteres)');
    if (containsSecrets([text])) throw new StoreError('secrets', 'El archivo contiene algo que parece una clave o un token; quítalo antes de guardar');
    await this.loadSkill(id);
    const file = path.join(this.paths.skillDir(id), ...rel.split(/[\\/]/));
    try {
      const old = await fs.readFile(file);
      if (old.subarray(0, 8000).includes(0)) throw new StoreError('invalid', 'Ese archivo no es de texto y no se puede editar aquí');
    } catch (err) {
      if (err instanceof StoreError) throw err;
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    await fs.mkdir(path.dirname(file), { recursive: true });
    await atomicWrite(file, text);
  }

  async usageOfSkill(id: Id): Promise<{ agentId: Id; name: string }[]> {
    return (await this.listAgents()).filter((a) => a.skillIds.includes(id)).map((a) => ({ agentId: a.id, name: a.name }));
  }

  /** Borra la skill con todos sus archivos y la quita de los agentes que la usaban [R24.3][R24.4]. */
  async deleteSkill(id: Id): Promise<boolean> {
    const dir = this.paths.skillDir(id);
    try {
      await fs.access(dir);
    } catch {
      return false;
    }
    for (const a of withoutSkill(await this.listAgents(), id)) await this.agents.save(a);
    await fs.rm(dir, { recursive: true, force: true });
    return true;
  }

  /** Carpetas de la biblioteca; si el archivo no está o no se entiende, todo va en la raíz [R38.13]. */
  async getLibraryFolders(): Promise<LibraryFolders> {
    try {
      return tidyLibraryFolders(JSON.parse(await fs.readFile(this.paths.libraryFile, 'utf8')));
    } catch {
      return emptyLibraryFolders();
    }
  }

  async saveLibraryFolders(folders: LibraryFolders): Promise<LibraryFolders> {
    const clean = tidyLibraryFolders(folders);
    const problem = validateLibraryFolders(folders) ?? validateLibraryFolders(clean);
    if (problem) throw new StoreError('invalid', problem);
    await atomicWrite(this.paths.libraryFile, JSON.stringify(clean, null, 2));
    return clean;
  }

  /** Carpeta de trabajo elegida, si sigue existiendo [R31.1]. */
  async getWorkFolder(): Promise<string | undefined> {
    try {
      const raw = JSON.parse(await fs.readFile(this.paths.workFolderFile, 'utf8')) as { path?: unknown };
      if (typeof raw.path !== 'string' || !path.isAbsolute(raw.path)) return undefined;
      return (await fs.stat(raw.path)).isDirectory() ? raw.path : undefined;
    } catch {
      return undefined;
    }
  }

  async setWorkFolder(folder: string | null): Promise<void> {
    if (folder === null) {
      await fs.rm(this.paths.workFolderFile, { force: true });
      return;
    }
    if (!path.isAbsolute(folder) || !(await fs.stat(folder)).isDirectory()) throw new StoreError('invalid', 'La carpeta de trabajo no existe');
    await atomicWrite(this.paths.workFolderFile, JSON.stringify({ schemaVersion: 1, path: folder }, null, 2));
  }

  // --- adjuntos de la entrada (SPEC-048) ---

  /** Copia un adjunto de la entrada en `.orquestador/attachments/<id>/` [R48.4]. */
  async stageAttachment(name: string, data: Uint8Array): Promise<AttachmentView> {
    if (data.byteLength === 0) throw new StoreError('invalid', `«${name}» está vacío`);
    if (data.byteLength > MAX_ATTACHMENT_BYTES) throw new StoreError('invalid', `«${name}» supera los 20 MB`);
    const clean = safeFileName(name);
    const id = randomUUID();
    const dir = this.paths.attachmentDir(id);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, clean), data);
    return { id, name: clean, size: data.byteLength, image: isImageName(clean) };
  }

  /** Ruta de un adjunto relativa a la carpeta de trabajo, como la recibe el agente [R48.4]. */
  async attachmentInputPath(id: string): Promise<string> {
    const dir = this.paths.attachmentDir(id);
    let names: string[];
    try {
      names = await fs.readdir(dir);
    } catch {
      throw new StoreError('not-found', 'Ese adjunto ya no existe');
    }
    if (names.length !== 1) throw new StoreError('not-found', 'Ese adjunto ya no existe');
    const base = (await this.getWorkFolder()) ?? this.paths.root;
    return path.relative(base, path.join(dir, names[0]!)).split(path.sep).join('/');
  }

  /** Comprueba archivos del proyecto para la entrada: dentro de la carpeta de trabajo y fuera de lo reservado [R48.4]. */
  async inputFiles(rels: string[]): Promise<{ path: string; size: number; image: boolean }[]> {
    const base = (await this.getWorkFolder()) ?? this.paths.root;
    const out: { path: string; size: number; image: boolean }[] = [];
    for (const rel of rels) {
      const norm = rel.split('\\').join('/');
      if (!isRelativeInside(norm) || norm.split('/').some((seg) => RESERVED_DIRS.has(seg))) throw new StoreError('outside-root', `«${rel}» no es un archivo del proyecto que se pueda adjuntar`);
      let stat;
      try {
        const real = await fs.realpath(path.join(base, ...norm.split('/')));
        const inside = path.relative(await fs.realpath(base), real);
        if (inside.startsWith('..') || path.isAbsolute(inside)) throw new Error('fuera');
        stat = await fs.stat(real);
      } catch {
        throw new StoreError('not-found', `«${rel}» no existe en la carpeta de trabajo`);
      }
      if (!stat.isFile()) throw new StoreError('invalid', `«${rel}» no es un archivo`);
      out.push({ path: norm, size: stat.size, image: isImageName(norm) });
    }
    return out;
  }

  /** Carpeta donde abrir el diálogo de «Del proyecto…» [R48.6]. */
  async inputBase(): Promise<string> {
    return (await this.getWorkFolder()) ?? this.paths.root;
  }

  /** Guarda el original de un archivo antes de que un agente lo modifique; solo la primera vez en cada ejecución [R31.6]. */
  async backupFile(runId: Id, abs: string, rel: string): Promise<void> {
    if (!isRelativeInside(rel)) throw new StoreError('outside-root', 'Ruta de copia no válida');
    const dest = path.join(this.paths.backupsDir(runId), ...rel.split('/'));
    try {
      await fs.access(dest);
      return;
    } catch {
      /* aún no hay copia */
    }
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(abs, dest);
  }

  async listBackups(runId: Id): Promise<string[]> {
    const root = this.paths.backupsDir(runId);
    const out: string[] = [];
    const walk = async (dir: string, rel: string): Promise<void> => {
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) await walk(path.join(dir, e.name), r);
        else out.push(r);
      }
    };
    await walk(root, '');
    return out.sort();
  }

  /**
   * Contenido actual y copia previa de un fichero que tocó una ejecución, para el visor [R45.11]. Solo vale para rutas
   * que la ejecución registró en `file.produced` o de las que tiene copia, dentro de la carpeta de trabajo (o la del
   * proyecto) y fuera de `.orquestador`, `.git` y de lo que `blocked` considere secreto.
   */
  async readRunFile(runId: Id, rel: string, opts: { blocked?: (rel: string) => boolean; maxBytes?: number } = {}): Promise<RunFileView> {
    const max = opts.maxBytes ?? RUN_FILE_MAX;
    const segs = rel.split('/');
    if (!isRelativeInside(rel) || rel.includes('\\') || segs.some((s) => s === '' || s === '.' || s === '..')) throw new StoreError('outside-root', 'Ruta de fichero no válida');
    if (['.orquestador', '.git'].includes(segs[0]!.toLowerCase()) || opts.blocked?.(rel)) throw new StoreError('outside-root', 'Ese fichero no se puede mostrar: puede contener secretos o es interno');
    const backups = await this.listBackups(runId);
    let recorded = backups.includes(rel);
    if (!recorded) {
      try {
        const { events } = await readRunLog(this.paths.runDir(runId));
        recorded = events.some((e) => e.type === 'file.produced' && e.path.replace(/\\/g, '/') === rel);
      } catch {
        recorded = false;
      }
    }
    if (!recorded) throw new StoreError('not-found', 'Esa ejecución no tocó ese fichero');
    const base = (await this.getWorkFolder()) ?? this.paths.root;
    const read = async (abs: string, root: string): Promise<{ text: string; truncated: boolean; binary: boolean } | undefined> => {
      let real: string;
      try {
        real = await fs.realpath(abs);
      } catch {
        return undefined;
      }
      const realRoot = await fs.realpath(root);
      const inside = path.relative(realRoot, real);
      if (inside.startsWith('..') || path.isAbsolute(inside)) throw new StoreError('outside-root', 'El fichero queda fuera de la carpeta de trabajo');
      const stat = await fs.stat(real);
      if (!stat.isFile()) return undefined;
      const fh = await fs.open(real, 'r');
      try {
        const buf = Buffer.alloc(Math.min(stat.size, max));
        await fh.read(buf, 0, buf.length, 0);
        const binary = buf.subarray(0, 8000).includes(0);
        return { text: binary ? '' : buf.toString('utf8'), truncated: stat.size > max, binary };
      } finally {
        await fh.close();
      }
    };
    const current = await read(path.join(base, ...segs), base);
    const copyRoot = this.paths.backupsDir(runId);
    const before = backups.includes(rel) ? await read(path.join(copyRoot, ...segs), copyRoot) : undefined;
    const binary = (current?.binary ?? false) || (before?.binary ?? false);
    return {
      path: rel,
      missing: current === undefined,
      binary,
      ...(current ? { current: { text: current.text, truncated: current.truncated } } : {}),
      ...(before ? { before: { text: before.text, truncated: before.truncated } } : {}),
    };
  }

  /** Devuelve un archivo a su estado anterior a la ejecución [R31.6]. */
  async restoreBackup(runId: Id, rel: string): Promise<boolean> {
    if (!isRelativeInside(rel)) throw new StoreError('outside-root', 'Ruta de copia no válida');
    const folder = await this.getWorkFolder();
    if (!folder) throw new StoreError('not-found', 'No hay carpeta de trabajo');
    const from = path.join(this.paths.backupsDir(runId), ...rel.split('/'));
    const to = path.join(folder, ...rel.split('/'));
    try {
      await fs.access(from);
    } catch {
      return false;
    }
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.copyFile(from, to);
    return true;
  }

  async listContexts(): Promise<ContextDefinition[]> {
    const out: ContextDefinition[] = [];
    for (const id of await this.contexts.list()) out.push(await this.contexts.load(id));
    return out;
  }

  /** Guarda un agente tras validarlo; no admite contextos que no existen [R22.1][R22.3][R22.4]. */
  async saveAgent(agent: AgentDefinition): Promise<void> {
    const known = new Set(await this.contexts.list());
    const problems = validateAgent(agent, { contextIds: known, skillIds: new Set(await this.listSkillIds()), mcpIds: new Set((await this.listMcp()).map((m) => m.id)) });
    if (problems.length > 0) throw new StoreError('invalid', problems[0]!.message, problems);
    await this.agents.save({ ...agent, skillIds: agent.skillIds ?? [], schemaVersion: AGENT_SCHEMA_VERSION, name: agent.name.trim() });
  }

  async saveContext(context: ContextDefinition): Promise<void> {
    const problems = validateContext(context);
    if (problems.length > 0) throw new StoreError('invalid', problems[0]!.message, problems);
    await this.contexts.save({ ...context, schemaVersion: CONTEXT_SCHEMA_VERSION, name: context.name.trim() });
  }

  /** Usa la carpeta `mcp/` de la configuración de la app para los servidores de «Todos mis proyectos» [R30.9]. */
  useAppMcp(dir: string | undefined): void {
    this.appMcp = dir === undefined ? undefined : new JsonCollection<McpServerDefinition>(dir, mcpSpec);
  }

  /** Servidores del proyecto y de la app (marcados `scope: 'app'`); si un id está en los dos, gana el del proyecto [R30.9]. */
  async listMcp(): Promise<McpServerDefinition[]> {
    const out: McpServerDefinition[] = [];
    for (const id of await this.mcp.list()) out.push({ ...(await this.mcp.load(id)), scope: 'project' });
    const own = new Set(out.map((m) => m.id));
    for (const id of this.appMcp ? await this.appMcp.list() : []) {
      if (own.has(id)) continue;
      try {
        out.push({ ...(await this.appMcp!.load(id)), scope: 'app' });
      } catch {
        // un archivo de la app dañado no impide abrir el proyecto
      }
    }
    return out;
  }

  /** Ámbito actual de un servidor, o `undefined` si no existe [R30.9]. */
  async scopeOfMcp(id: Id): Promise<McpScope | undefined> {
    if (await this.mcp.exists(id)) return 'project';
    if (this.appMcp && (await this.appMcp.exists(id))) return 'app';
    return undefined;
  }

  /** Guarda un servidor MCP tras validarlo, sin valores secretos, en su ámbito; si cambia de ámbito, se mueve [R30.1][R30.2][R30.9]. */
  async saveMcp(server: McpServerDefinition): Promise<void> {
    const problems = validateMcpServer(server);
    if (problems.length > 0) throw new StoreError('invalid', problems[0]!.message, problems);
    if (containsSecrets([server.name, server.description, server.command ?? '', ...(server.args ?? []), server.url ?? ''])) {
      throw new StoreError('secrets', 'Parece que hay una clave o un token escrito a la vista; guárdalo como secreto');
    }
    const scope = server.scope ?? 'project';
    if (scope === 'app' && !this.appMcp) throw new StoreError('unavailable', 'No se puede guardar para todos los proyectos en este equipo');
    const clean: McpServerDefinition = {
      id: server.id,
      schemaVersion: MCP_SCHEMA_VERSION,
      name: server.name.trim(),
      description: server.description,
      transport: server.transport,
      ...(server.transport === 'stdio' ? { command: (server.command ?? '').trim(), args: server.args ?? [] } : { url: (server.url ?? '').trim() }),
      ...(server.secretNames && server.secretNames.length > 0 ? { secretNames: server.secretNames } : {}),
      enabled: server.enabled,
      ...(server.trusted ? { trusted: true } : {}),
    };
    if (scope === 'app') {
      await this.appMcp!.save(clean);
      await this.mcp.delete(server.id);
    } else {
      await this.mcp.save(clean);
      await this.appMcp?.delete(server.id);
    }
  }

  /** Agentes que usan un servidor MCP [R30.3]. */
  async usageOfMcp(id: Id): Promise<{ agentId: Id; name: string }[]> {
    return (await this.listAgents()).filter((a) => (a.mcpIds ?? []).includes(id)).map((a) => ({ agentId: a.id, name: a.name }));
  }

  /** Borra un servidor MCP y lo quita de los agentes que lo usaban [R30.3]. */
  async deleteMcp(id: Id): Promise<boolean> {
    for (const a of await this.listAgents()) {
      if ((a.mcpIds ?? []).includes(id)) await this.agents.save({ ...a, mcpIds: (a.mcpIds ?? []).filter((x) => x !== id) });
    }
    if (await this.mcp.delete(id)) return true;
    return (await this.appMcp?.delete(id)) ?? false;
  }

  /** Diagramas (y plantillas) donde se usa un agente, en cualquier nivel de bucle [R22.4]. */
  async usageOfAgent(agentId: Id): Promise<{ diagramId: Id; name: string }[]> {
    const out: { diagramId: Id; name: string }[] = [];
    for (const col of [this.diagrams, this.templates]) {
      for (const id of await col.list()) {
        const d = await col.load(id).catch(() => undefined);
        if (d && usesAgent(d, agentId)) out.push({ diagramId: d.id, name: d.name });
      }
    }
    return out;
  }

  /** Agentes que usan un contexto [R22.4]. */
  async usageOfContext(contextId: Id): Promise<{ agentId: Id; name: string }[]> {
    return (await this.listAgents()).filter((a) => a.contextIds.includes(contextId)).map((a) => ({ agentId: a.id, name: a.name }));
  }

  async deleteAgent(id: Id): Promise<boolean> {
    return this.agents.delete(id);
  }

  /** Borra un contexto y lo quita de los agentes que lo usaban [R22.4]; también sus archivos subidos [R22.15]. */
  async deleteContext(id: Id): Promise<boolean> {
    const changed = withoutContext(await this.listAgents(), id);
    for (const a of changed) await this.agents.save(a);
    await fs.rm(this.paths.contextFilesDir(id), { recursive: true, force: true });
    return this.contexts.delete(id);
  }

  /**
   * Copia archivos o una carpeta dentro del proyecto para usarlos como contexto sin escribir rutas [R22.14].
   * Mismos límites y renombrado que las referencias de una skill [R24.10]; devuelve la ruta relativa que
   * debe guardar el contexto: el archivo si hay uno solo, la carpeta si hay varios.
   */
  async addContextFiles(id: Id, incoming: SourceFile[]): Promise<{ value: string; files: number; bytes: number; renamed: number; scripts: string[] }> {
    const dir = this.paths.contextFilesDir(id);
    const existing: { path: string; size: number }[] = [];
    const walk = async (d: string, rel: string): Promise<void> => {
      let entries;
      try {
        entries = await fs.readdir(d, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const r = rel === '' ? e.name : `${rel}/${e.name}`;
        if (e.isDirectory()) await walk(path.join(d, e.name), r);
        else if (e.isFile()) existing.push({ path: r, size: (await fs.stat(path.join(d, e.name))).size });
      }
    };
    await walk(dir, '');
    const plan = planSkillFiles(existing, incoming, 'archivos');
    if (!plan.ok) throw new StoreError('invalid', plan.message);
    for (const f of plan.add) {
      const file = path.join(dir, ...f.path.split('/'));
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, f.data);
    }
    const all = [...existing.map((e) => e.path), ...plan.add.map((f) => f.path)];
    const base = `.orquestador/context-files/${id}`;
    const value = all.length === 1 ? `${base}/${all[0]}` : `${base}/archivos`;
    const bytes = existing.reduce((n, f) => n + f.size, 0) + plan.add.reduce((n, f) => n + f.data.length, 0);
    return { value, files: all.length, bytes, renamed: plan.renamed, scripts: plan.scripts };
  }
}

function usesAgent(d: Diagram, agentId: Id): boolean {
  return d.nodes.some((n) => (n.kind === 'agent' && n.agentId === agentId) || (n.kind === 'loop' && n.loop !== undefined && usesAgent(n.loop.body, agentId)));
}
