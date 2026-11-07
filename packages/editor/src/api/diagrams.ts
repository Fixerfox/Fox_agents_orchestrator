import type { Diagram, Id } from '@orquestador/core';
import type { ExampleTemplate } from '../templates';
import { UNHANDLED, isObject, safeId, type RequestCheck } from './check';
import { CHANNELS } from './contract';
import type { ApiResult } from './result';

export interface DiagramSummary {
  id: Id;
  name: string;
}

/** Un diagrama listo para lanzar, para la pantalla Trabajos [R52.4]. */
export interface JobInfo {
  id: Id;
  name: string;
  /** Nodos que no son entrada ni salida, también dentro de bucles. */
  steps: number;
  /** Problemas de validación: con alguno no se puede lanzar. */
  problems: number;
}

/** Diagramas del proyecto, ejemplos y lista de trabajos. */
export interface DiagramsApi {
  listDiagrams(): Promise<ApiResult<DiagramSummary[]>>;
  loadDiagram(id: Id): Promise<ApiResult<Diagram>>;
  saveDiagram(diagram: Diagram): Promise<ApiResult<null>>;
  /** Borra un diagrama del proyecto; `false` si no existía [R32.38]. */
  deleteDiagram(id: Id): Promise<ApiResult<boolean>>;
  listExamples(): Promise<ApiResult<ExampleTemplate[]>>;
  /** Diagramas del proyecto con sus pasos y problemas [R52.4]. */
  listJobs(): Promise<ApiResult<JobInfo[]>>;
}

export function parseDiagramsRequest(channel: string, payload: unknown, { bad }: RequestCheck): unknown {
  switch (channel) {
    case CHANNELS.listDiagrams:
    case CHANNELS.listExamples:
    case CHANNELS.listJobs:
      if (payload !== undefined && payload !== null) throw bad('no admite argumentos');
      return undefined;
    case CHANNELS.loadDiagram:
    case CHANNELS.deleteDiagram:
      if (!safeId(payload)) throw bad('id no válido');
      return payload;
    case CHANNELS.saveDiagram: {
      if (!isObject(payload)) throw bad('se esperaba un diagrama');
      if (!safeId(payload.id)) throw bad('id no válido');
      if (typeof payload.name !== 'string') throw bad('falta el nombre');
      if (typeof payload.schemaVersion !== 'number') throw bad('falta la versión');
      if (!Array.isArray(payload.nodes) || !Array.isArray(payload.edges)) throw bad('faltan nodos o aristas');
      return payload as unknown as Diagram;
    }
    default:
      return UNHANDLED;
  }
}
