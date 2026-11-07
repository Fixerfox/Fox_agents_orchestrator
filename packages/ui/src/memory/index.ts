import type { Diagram } from '@orquestador/core';
import { CHANNELS, ContractError, createDiagram, fail, parseRequest } from '@orquestador/editor';
import { memoryAssistant } from './assistant';
import { memoryDiagrams } from './diagrams';
import { memoryKnowledge } from './knowledge';
import { memoryProject } from './project';
import { memoryRuns } from './runs';
import { memorySettings } from './settings';
import { createMemoryState } from './state';
import type { MemoryApi, MemoryApiOptions } from './types';

export type { AssistantStep, MemoryApi, MemoryApiOptions } from './types';

/** Implementación en memoria de `ProjectApi`: para tests y para desarrollar la interfaz sin Electron. */
export function createMemoryApi(
  initial: Diagram[] = [createDiagram('principal', 'Principal')],
  options: MemoryApiOptions = {},
): MemoryApi {
  const s = createMemoryState(initial, options);
  const impl: MemoryApi = {
    saved: s.saved,
    runs: s.runs,
    agents: s.agents,
    contexts: s.contexts,
    mcp: s.mcp,
    mcpSecrets: s.mcpSecrets,
    skills: s.skills,
    ...memoryProject(s, options),
    ...memoryDiagrams(s),
    ...memoryRuns(s, options),
    ...memoryKnowledge(s, options),
    ...memorySettings(s, options),
    ...memoryAssistant(s, options),
  };
  // Cada llamada pasa por el mismo contrato que el IPC real: lo que el renderer no podría enviar en la app tampoco funciona aquí.
  const checked: Record<string, unknown> = { ...impl };
  for (const [name, channel] of Object.entries(CHANNELS)) {
    const fn = (impl as unknown as Record<string, unknown>)[name];
    if (typeof fn !== 'function') continue;
    checked[name] = (arg: unknown) => {
      try {
        parseRequest(channel, arg);
      } catch (e) {
        if (e instanceof ContractError) return Promise.resolve(fail('invalid', e.message));
        throw e;
      }
      return (fn as (a: unknown) => unknown)(arg);
    };
  }
  return checked as unknown as MemoryApi;
}
