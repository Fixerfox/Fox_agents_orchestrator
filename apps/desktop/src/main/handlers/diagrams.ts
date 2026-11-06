import type { Diagram } from '@orquestador/core';
import { CHANNELS, exampleTemplates, type DiagramSummary } from '@orquestador/editor';
import { jobsOf } from '@orquestador/runtime';
import { composeLibrary } from '../composition';
import { UNHANDLED, requireStore, type HandlerState } from './state';

export async function handleDiagrams(h: HandlerState, channel: string, arg: unknown): Promise<unknown> {
  switch (channel) {
    case CHANNELS.listDiagrams: {
      const store = requireStore(h);
      const list: DiagramSummary[] = [];
      for (const id of await store.diagrams.list()) {
        try {
          list.push({ id, name: (await store.diagrams.load(id)).name });
        } catch {
          list.push({ id, name: id });
        }
      }
      return list;
    }
    case CHANNELS.loadDiagram:
      return requireStore(h).diagrams.load(arg as string);
    case CHANNELS.saveDiagram:
      await requireStore(h).diagrams.save(arg as Diagram);
      return null;
    case CHANNELS.deleteDiagram:
      return requireStore(h).diagrams.delete(arg as string);
    case CHANNELS.listExamples:
      return exampleTemplates();
    case CHANNELS.listJobs:
      return jobsOf(composeLibrary(requireStore(h)));
    default:
      return UNHANDLED;
  }
}
