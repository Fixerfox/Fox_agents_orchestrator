import { createHash, randomUUID } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { draftWithClaude, runAssistantTurn } from '@orquestador/claude';
import { AgentError } from '@orquestador/core';
import { ASSISTANT_TOOLS, CHANNELS, type AssistantEvent, type AssistantMessage, type DraftRequest } from '@orquestador/editor';
import { StoreError, atomicWrite } from '@orquestador/store';
import { UNHANDLED, projectConfigTrusted, requireStore, scrubPaths, type HandlerState } from './state';

/** Archivo de las pestañas del proyecto abierto en la carpeta de datos de la app; nunca sale hacia la interfaz [R86.11]. */
export function assistantTabsFile(dir: string, root: string, platform: NodeJS.Platform = process.platform): string {
  const resolved = path.resolve(root);
  const key = createHash('sha256').update(platform === 'win32' ? resolved.toLowerCase() : resolved).digest('hex').slice(0, 16);
  return path.join(dir, `${key}.json`);
}

export async function handleAssistant(h: HandlerState, channel: string, arg: unknown): Promise<unknown> {
  switch (channel) {
    case CHANNELS.assistantTabsLoad: {
      if (!h.root || !h.deps.assistantTabsDir) return null;
      try {
        return JSON.parse(await fsp.readFile(assistantTabsFile(h.deps.assistantTabsDir, h.root), 'utf8')) as unknown;
      } catch {
        // Sin archivo o dañado: se empieza con una pestaña vacía.
        return null;
      }
    }
    case CHANNELS.assistantTabsSave: {
      if (!h.root) throw new StoreError('not-found', 'No hay un proyecto abierto');
      if (!h.deps.assistantTabsDir) return null;
      await fsp.mkdir(h.deps.assistantTabsDir, { recursive: true });
      await atomicWrite(assistantTabsFile(h.deps.assistantTabsDir, h.root), JSON.stringify(arg));
      return null;
    }
    case CHANNELS.assistantSend: {
      const { turnId, messages } = arg as { turnId: string; messages: AssistantMessage[] };
      const root = h.root;
      if (!root) throw new StoreError('not-found', 'Abre un proyecto para usar el asistente');
      if (h.turns.has(turnId)) throw new StoreError('exists', 'Ese turno ya está en marcha');
      const push = (event: AssistantEvent) => h.deps.pushAssistant?.(turnId, event);
      if (h.settings.engine !== 'claude' || !h.deps.claudeQuery || !h.deps.createAppServer) {
        // Sin el motor de Claude el asistente no puede trabajar: lo explica y termina [R29.6].
        const text = 'Estoy en modo simulado. Para que pueda crear agentes, skills y diagramas por ti, elige el motor «Claude» en Ajustes.';
        queueMicrotask(() => (push({ type: 'text', text }), push({ type: 'done', text })));
        return null;
      }
      const turn = { controller: new AbortController(), pending: new Map<string, (r: { ok: boolean; result: unknown }) => void>() };
      h.turns.set(turnId, turn);
      const timeout = h.deps.assistantToolTimeoutMs ?? 10 * 60_000;
      void runAssistantTurn({
        query: h.deps.claudeQuery,
        createServer: h.deps.createAppServer,
        tools: ASSISTANT_TOOLS.map((t) => ({ name: t.name, description: t.description, params: t.params })),
        messages,
        settings: h.settings,
        apiKey: await h.deps.vault?.read(),
        cwd: root,
        protectedDirs: h.deps.assistantProtectedDirs ?? [],
        projectTrusted: await projectConfigTrusted(h),
        signal: turn.controller.signal,
        emit: (e) => push(e.type === 'error' ? { ...e, message: scrubPaths(e.message, root) } : e.type === 'read' ? { ...e, target: scrubPaths(e.target, root) } : e),
        newId: () => randomUUID(),
        callTool: (callId) =>
          new Promise((resolve) => {
            const timer = setTimeout(() => (turn.pending.delete(callId), resolve({ ok: false, result: 'La interfaz no respondió a tiempo.' })), timeout);
            turn.pending.set(callId, (r) => (clearTimeout(timer), turn.pending.delete(callId), resolve(r)));
            turn.controller.signal.addEventListener('abort', () => turn.pending.get(callId)?.({ ok: false, result: 'Detenido.' }), { once: true });
          }),
      }).finally(() => h.turns.delete(turnId));
      return null;
    }
    case CHANNELS.assistantToolResult: {
      const { turnId, callId, ok, result } = arg as { turnId: string; callId: string; ok: boolean; result: unknown };
      const resolve = h.turns.get(turnId)?.pending.get(callId);
      if (!resolve) return false;
      resolve({ ok, result });
      return true;
    }
    case CHANNELS.assistantCancel: {
      const turn = h.turns.get(arg as string);
      if (!turn) return false;
      turn.controller.abort();
      return true;
    }
    case CHANNELS.draftWithClaude: {
      const store = requireStore(h);
      const root = h.root;
      if (!root) throw new StoreError('not-found', 'Abre un proyecto para redactar con Claude');
      if (!h.deps.claudeQuery) throw new StoreError('unavailable', 'El motor de Claude no está disponible');
      const req = arg as DraftRequest;
      try {
        return await draftWithClaude({
          query: h.deps.claudeQuery,
          settings: h.settings,
          apiKey: await h.deps.vault?.read(),
          cwd: root,
          kind: req.kind,
          instruction: req.instruction,
          ...(req.current ? { current: req.current } : {}),
          contexts: await store.listContexts(),
          skills: await store.listSkills(),
        });
      } catch (e) {
        if (e instanceof AgentError) throw new StoreError('unavailable', e.message);
        throw e;
      }
    }
    default:
      return UNHANDLED;
  }
}
