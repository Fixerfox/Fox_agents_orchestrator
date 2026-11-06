import { deliverableProblems, validateDiagram, type Diagram, type LibraryReader, type Payload, type RunOptions, type RunRepository } from '@orquestador/core';
import { RunError } from './errors';
import { takeSnapshot, type LibrarySnapshot, type RunSnapshots } from './snapshot';
import type { PreparedRun, StartRunInput } from './run-types';

/** Prepara lo que necesita una ejecución antes de arrancar: diagrama, opciones, entrada y copia [R56.16]. */
export class RunLauncher {
  constructor(
    private readonly runs: RunRepository,
    private readonly library: LibraryReader,
    /** Opciones por defecto de cada ejecución (p. ej. agentes en paralelo de los ajustes) [R23.6]. */
    readonly defaults: () => RunOptions,
    private readonly snapshots: RunSnapshots | undefined,
  ) {}

  async prepare(input: StartRunInput): Promise<PreparedRun> {
    const diagram = await this.library.diagram(input.diagramId);
    const issues = validateDiagram(diagram);
    if (issues.length > 0) {
      throw new RunError('invalid-diagram', `El diagrama tiene ${issues.length} problema(s): ${issues[0]!.message}`);
    }
    const options: RunOptions = { ...this.defaults() };
    if (input.deliverable === null) options.deliverable = null;
    else if (input.deliverable !== undefined) {
      const problems = deliverableProblems(input.deliverable);
      if (problems.length > 0) throw new RunError('bad-request', `Entregable no válido: ${problems[0]!.message}`);
      options.deliverable = input.deliverable;
    }
    if (input.maxTokens !== undefined || input.maxCostUsd !== undefined) {
      options.budget = {
        ...(input.maxTokens !== undefined ? { maxTokens: input.maxTokens } : {}),
        ...(input.maxCostUsd !== undefined ? { maxCostUsd: input.maxCostUsd } : {}),
      };
    }
    const order = await this.inputPayload(input);
    const snapshot = await this.snapshotOf(diagram);
    return { diagram, order, options, ...(snapshot ? { snapshot } : {}) };
  }

  /** Copia de la biblioteca para una ejecución, si el servicio las usa [R52.1]. */
  snapshotOf(diagram: Diagram): Promise<LibrarySnapshot | undefined> {
    return this.snapshots ? takeSnapshot(this.library, diagram) : Promise.resolve(undefined);
  }

  /** Entrada del primer paso: el texto y los archivos del proyecto y adjuntos, como rutas relativas [R48.5]. */
  async inputPayload(input: Pick<StartRunInput, 'order' | 'files' | 'attachments'>): Promise<string | Payload> {
    const files = input.files ?? [];
    const attachments = input.attachments ?? [];
    if (files.length + attachments.length === 0) {
      if (!input.order.trim()) throw new RunError('bad-request', 'Escribe la entrada o adjunta algún archivo');
      return input.order;
    }
    if (files.length + attachments.length > this.runs.maxInputFiles) throw new RunError('bad-request', `Como mucho ${this.runs.maxInputFiles} archivos en la entrada`);
    try {
      const own = (await this.runs.inputFiles(files)).map((f) => f.path);
      const att: string[] = [];
      for (const id of attachments) att.push(await this.runs.attachmentInputPath(id));
      return { text: input.order, files: [...new Set([...own, ...att])] };
    } catch (e) {
      throw new RunError('bad-request', e instanceof Error ? e.message : String(e));
    }
  }
}
