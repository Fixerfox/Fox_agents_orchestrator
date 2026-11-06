import { exampleTemplates, fail, ok, type DiagramSummary } from '@orquestador/editor';
import { stepCount, validateDiagram } from '@orquestador/core';
import { res } from './state';
import type { MemoryApi, MemoryState } from './types';

/** Diagramas del proyecto, ejemplos y lista de trabajos. */
export function memoryDiagrams(s: MemoryState) {
  const { saved } = s;
  return {
    async listDiagrams() {
      if (!s.open) return fail('no-project', 'No hay proyecto abierto');
      const list: DiagramSummary[] = [...saved.values()].map((d) => ({ id: d.id, name: d.name }));
      return ok(list);
    },
    async loadDiagram(id) {
      const d = saved.get(id);
      return d ? ok(structuredClone(d)) : fail('not-found', 'No existe ese diagrama');
    },
    async saveDiagram(diagram) {
      saved.set(diagram.id, structuredClone(diagram));
      return ok(null);
    },
    async deleteDiagram(id) {
      if (!s.open) return fail('no-project', 'No hay proyecto abierto');
      return ok(saved.delete(id));
    },
    listExamples: () => res(exampleTemplates()),
    async listJobs() {
      return ok([...saved.values()].map((d) => ({ id: d.id, name: d.name, steps: stepCount(d), problems: validateDiagram(d).length })));
    },
  } satisfies Partial<MemoryApi>;
}
