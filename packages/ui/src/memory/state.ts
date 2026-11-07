import { defaultSettings, type Diagram } from '@orquestador/core';
import { fail, ok, type ApiResult } from '@orquestador/editor';
import type { MemoryApiOptions, MemoryState } from './types';

export function createMemoryState(initial: Diagram[], options: MemoryApiOptions): MemoryState {
  return {
    saved: new Map(initial.map((d) => [d.id, structuredClone(d)])),
    runs: new Map(),
    agents: new Map((options.agents ?? []).map((a) => [a.id, structuredClone(a)])),
    contexts: new Map((options.contexts ?? []).map((c) => [c.id, structuredClone(c)])),
    mcp: new Map((options.mcp ?? []).map((m) => [m.id, structuredClone(m)])),
    mcpSecrets: new Map(Object.entries(options.mcpSecrets ?? {}).map(([k, v]) => [k, { ...v }])),
    skills: new Map((options.skills ?? []).map((k) => [k.id, structuredClone(k)])),
    open: false,
    pending: undefined,
    importCount: 0,
    settings: defaultSettings(),
  };
}

export const invalid = (problems: { field: string; message: string }[]) => fail('invalid', problems[0]!.message, problems);
export const res = async <T,>(v: T): Promise<ApiResult<T>> => ok(v);
