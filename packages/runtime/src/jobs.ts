import { stepCount, validateDiagram, type LibraryReader } from '@orquestador/core';

/** Un diagrama listo para lanzar [R52.4]. */
export interface JobSummary {
  id: string;
  name: string;
  steps: number;
  problems: number;
}

/** Todos los diagramas del proyecto con sus pasos y sus problemas [R52.4]. Uno que no se puede leer cuenta como un problema. */
export async function jobsOf(library: LibraryReader): Promise<JobSummary[]> {
  const out: JobSummary[] = [];
  for (const id of await library.diagramIds()) {
    try {
      const d = await library.diagram(id);
      out.push({ id: d.id, name: d.name, steps: stepCount(d), problems: validateDiagram(d).length });
    } catch {
      out.push({ id, name: id, steps: 0, problems: 1 });
    }
  }
  return out;
}
