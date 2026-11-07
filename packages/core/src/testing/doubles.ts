import type { Diagram } from '../diagrams';
import { type AgentAdapter, type Decider, Orchestrator, type RunEvent, type RunOptions } from '../execution';
import type { AgentDefinition, ContextDefinition, McpServerDefinition, SkillDefinition } from '../knowledge';
import type { AgentEngine, InputFile, LibraryReader, LoggedRun, PathPolicy, RunAcceptance, RunMeta, RunRepository, WorkspaceFiles } from '../ports';
import { type Id, type Payload, safePreviewPath } from '../shared';
import { MockAgent, MockDecider } from './mock';

/** Motor simulado con el `id` pedido [R56.3]. */
export function memoryEngine(id = 'memoria', parts: { adapter?: AgentAdapter; decider?: Decider } = {}): AgentEngine {
  return { id, adapter: parts.adapter ?? new MockAgent(), decider: parts.decider ?? new MockDecider() };
}

/** Biblioteca en memoria [R56.3]. */
export class MemoryLibrary implements LibraryReader {
  agentList: AgentDefinition[] = [];
  contextList: ContextDefinition[] = [];
  skillList: SkillDefinition[] = [];
  mcpList: McpServerDefinition[] = [];
  readonly diagrams = new Map<Id, Diagram>();

  async agents(): Promise<AgentDefinition[]> {
    return this.agentList;
  }
  async contexts(): Promise<ContextDefinition[]> {
    return this.contextList;
  }
  async skills(): Promise<SkillDefinition[]> {
    return this.skillList;
  }
  async mcp(): Promise<McpServerDefinition[]> {
    return this.mcpList;
  }
  async diagram(id: Id): Promise<Diagram> {
    const d = this.diagrams.get(id);
    if (!d) throw new Error(`No existe el diagrama ${id}`);
    return d;
  }
  async diagramIds(): Promise<Id[]> {
    return [...this.diagrams.keys()];
  }
}

interface StoredRun {
  meta: RunMeta;
  events: RunEvent[];
  diagram: Diagram;
}

/** Registro de ejecuciones en memoria [R56.3]. Las vistas previas se guardan como `runId|key|rel`. */
export class MemoryRunRepository implements RunRepository {
  readonly maxInputFiles = 20;
  readonly runs = new Map<string, StoredRun>();
  readonly previews = new Map<string, string>();
  readonly attachments = new Map<string, string>();
  /** Archivos del proyecto que se admiten como entrada: ruta y tamaño. */
  readonly projectFiles = new Map<string, number>();
  root = '/trabajo';

  start(orchestrator: Orchestrator, diagram: Diagram, order: string | Payload, options: RunOptions): LoggedRun {
    const handle = orchestrator.start(diagram, order, options);
    const run: StoredRun = {
      diagram,
      events: [],
      meta: {
        schemaVersion: 1,
        runId: handle.runId,
        diagramId: diagram.id,
        startedAt: new Date(0).toISOString(),
        status: 'running',
        usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
        eventCount: 0,
        order: typeof order === 'string' ? order : order.text,
        diagramName: diagram.name,
      },
    };
    this.runs.set(handle.runId, run);
    handle.bus.subscribe(
      (e) => {
        run.events.push(e);
        run.meta.eventCount++;
        if (e.type === 'run.started') {
          if (e.resumedFrom) run.meta.resumedFrom = e.resumedFrom;
          if (e.correctedFrom) run.meta.correctedFrom = e.correctedFrom;
        }
        if (e.type === 'run.finished') run.meta.status = e.status;
      },
      { fromSeq: 1 },
    );
    return { handle, logged: handle.result };
  }

  async list(opts: { live: ReadonlySet<string> }): Promise<RunMeta[]> {
    return [...this.runs.values()].map(({ meta }) => ({ ...meta, status: meta.status === 'running' && !opts.live.has(meta.runId) ? 'interrupted' : meta.status }));
  }

  private get(runId: string): StoredRun {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`No existe la ejecución ${runId}`);
    return run;
  }

  async readEvents(runId: string): Promise<RunEvent[]> {
    return [...this.get(runId).events];
  }
  async readDiagram(runId: string): Promise<Diagram | null> {
    return this.runs.get(runId)?.diagram ?? null;
  }
  async markResumedBy(runId: string, by: string): Promise<void> {
    this.get(runId).meta.resumedBy = by;
  }
  async markCorrectedBy(runId: string, by: string): Promise<void> {
    const { meta } = this.get(runId);
    meta.correctedBy = [...(meta.correctedBy ?? []).filter((id) => id !== by), by];
  }
  async acceptRun(runId: string, acceptance: RunAcceptance): Promise<boolean> {
    const run = this.get(runId);
    if (run.meta.status !== 'failed') return false;
    const previousReason = run.meta.reason;
    run.meta.status = 'succeeded';
    run.meta.accepted = { ...acceptance, at: new Date().toISOString(), ...(previousReason !== undefined ? { previousReason } : {}) };
    return true;
  }
  async dismissInterrupted(runId: string): Promise<boolean> {
    const { meta } = this.get(runId);
    if (meta.status !== 'running') return false;
    meta.status = 'cancelled';
    return true;
  }
  async snapshotStep(args: { runId: string; workRoot: string; key: string; files: readonly string[]; blocked: (rel: string) => boolean }): Promise<unknown> {
    for (const f of args.files) if (!args.blocked(f)) this.previews.set(`${args.runId}|${args.key}|${f}`, `/copias/${args.runId}/${f}`);
    return undefined;
  }
  async findPreview(runId: string, key: string, rel: string): Promise<string | undefined> {
    return this.previews.get(`${runId}|${key}|${rel}`);
  }
  outputFolder(runId: string): string {
    return `/salida/${runId}`;
  }
  async workRoot(): Promise<string> {
    return this.root;
  }
  async inputFiles(rels: string[]): Promise<InputFile[]> {
    return rels.map((path) => {
      const size = this.projectFiles.get(path);
      if (size === undefined) throw new Error(`No existe ${path}`);
      return { path, size, image: false };
    });
  }
  async attachmentInputPath(id: string): Promise<string> {
    const path = this.attachments.get(id);
    if (path === undefined) throw new Error(`No existe el adjunto ${id}`);
    return path;
  }
}

/** Política sencilla: `.env` es secreto y lo demás se enseña si la ruta es válida [R56.3]. */
export const memoryPathPolicy: PathPolicy = {
  isSensitive: (rel) => rel.split('/').includes('.env'),
  isPreviewable: (rel) => safePreviewPath(rel) && !rel.split('/').includes('.env'),
};

/** Archivos de trabajo en memoria: rutas relativas y tamaño, por carpeta raíz [R56.3]. */
export class MemoryWorkspaceFiles implements WorkspaceFiles {
  readonly folders = new Map<string, Map<string, { size: number }>>();
  async manifestOf(root: string): Promise<ReadonlyMap<string, { size: number }>> {
    return this.folders.get(root) ?? new Map();
  }
  resolveInside(root: string, rel: string): string {
    if (!safePreviewPath(rel)) throw new Error(`Ruta fuera del espacio permitido: ${rel}`);
    return `${root}/${rel}`;
  }
}
