import path from 'node:path';
import { StoreError } from './errors';

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function assertSafeId(id: string, what = 'id'): string {
  if (!SAFE_ID.test(id) || id.includes('..')) {
    throw new StoreError('invalid-id', `${what} no válido para un nombre de archivo: ${JSON.stringify(id)}`);
  }
  return id;
}

type PathModule = typeof path.posix;

const escapes = (p: PathModule, rel: string) =>
  p.isAbsolute(rel) || rel === '..' || rel.startsWith(`..${p.sep}`);

/** Ruta absoluta → ruta relativa a la raíz con `/` como separador (igual en Windows y Linux). */
export function toPosixRelative(root: string, abs: string, p: PathModule = path): string {
  const rel = p.relative(root, abs);
  if (escapes(p, rel)) throw new StoreError('outside-root', `La ruta sale de la raíz del proyecto: ${abs}`);
  return rel.split(p.sep).join('/');
}

/** Ruta relativa con `/` → ruta absoluta dentro de la raíz; rechaza rutas absolutas o que escapan. */
export function resolveInside(root: string, rel: string, p: PathModule = path): string {
  if (p.isAbsolute(rel) || /^[A-Za-z]:/.test(rel) || rel.startsWith('/') || rel.startsWith('\\')) {
    throw new StoreError('outside-root', `Se esperaba una ruta relativa: ${rel}`);
  }
  const abs = p.resolve(root, ...rel.split('/'));
  if (escapes(p, p.relative(root, abs))) {
    throw new StoreError('outside-root', `La ruta sale de la raíz del proyecto: ${rel}`);
  }
  return abs;
}

/** ¿Son la misma carpeta? En Windows no distingue mayúsculas. */
export function samePath(a: string, b: string): boolean {
  const [x, y] = [path.resolve(a), path.resolve(b)];
  return process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y;
}

export class ProjectPaths {
  readonly orq: string;
  constructor(readonly root: string) {
    this.orq = path.join(root, '.orquestador');
  }
  get projectFile(): string {
    return path.join(this.orq, 'project.json');
  }
  get diagramsDir(): string {
    return path.join(this.orq, 'diagrams');
  }
  get skillsDir(): string {
    return path.join(this.orq, 'skills');
  }
  skillDir(id: string): string {
    return path.join(this.skillsDir, assertSafeId(id, 'skillId'));
  }
  get agentsDir(): string {
    return path.join(this.orq, 'agents');
  }
  get contextsDir(): string {
    return path.join(this.orq, 'contexts');
  }
  /** Servidores MCP del proyecto, sin sus secretos [R30.1]. */
  get mcpDir(): string {
    return path.join(this.orq, 'mcp');
  }
  /** Archivos subidos a un contexto; fuera de `contexts/` para no mezclarlos con sus JSON. */
  contextFilesDir(id: string): string {
    return path.join(this.orq, 'context-files', assertSafeId(id, 'contextId'));
  }
  /** Carpetas de la biblioteca (agentes, skills, contextos y MCP) [R38.13]. */
  get libraryFile(): string {
    return path.join(this.orq, 'library.json');
  }
  /** Archivos adjuntos a la entrada de una ejecución [R48.4]. */
  attachmentDir(id: string): string {
    return path.join(this.orq, 'attachments', assertSafeId(id, 'attachmentId'));
  }
  /** Carpeta de trabajo aparte de los proyectos antiguos; ya no se escribe [R96.4]. */
  get workFolderFile(): string {
    return path.join(this.orq, 'work-folder.json');
  }
  /** Copias de los archivos modificados por los agentes en una ejecución [R31.6]. */
  backupsDir(runId: string): string {
    return path.join(this.orq, 'copias', assertSafeId(runId, 'runId'));
  }
  get templatesDir(): string {
    return path.join(this.orq, 'templates');
  }
  get runsDir(): string {
    return path.join(this.orq, 'runs');
  }
  runDir(runId: string): string {
    return path.join(this.runsDir, assertSafeId(runId, 'runId'));
  }
  /** Comandos de comprobación aprobados en el proyecto, por su hash [R75.6]. */
  get approvedChecksFile(): string {
    return path.join(this.orq, 'approved-checks.json');
  }
  /** Casos de referencia del Supervisor [R75.23]. */
  get supervisorCasesFile(): string {
    return path.join(this.orq, 'supervisor', 'cases.jsonl');
  }
  /** Subcarpetas que se crean con el proyecto. */
  get all(): string[] {
    return ['diagrams', 'templates', 'agents', 'skills', 'contexts', 'runs'].map((d) => path.join(this.orq, d));
  }
}
