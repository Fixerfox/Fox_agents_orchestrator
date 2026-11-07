import { promises as fsp } from 'node:fs';
import { basename, isAbsolute, relative, sep } from 'node:path';
import { isSensitivePath } from '@orquestador/claude';
import type { RunEvent } from '@orquestador/core';
import { CHANNELS, type RunAction, type StartRunRequest } from '@orquestador/editor';
import { Batcher } from '@orquestador/runtime';
import { MAX_ATTACHMENT_BYTES, MAX_INPUT_FILES, StoreError } from '@orquestador/store';
import { UNHANDLED, requireRuns, requireStore, type HandlerState } from './state';

function unsubscribeRun(h: HandlerState, runId: string): void {
  const sub = h.subs.get(runId);
  if (!sub) return;
  h.subs.delete(runId);
  sub.unsubscribe();
  sub.batcher.dispose();
}

/** Historial desde `fromSeq` y, a partir de ahí, envío en vivo por lotes (sin huecos ni duplicados). */
async function subscribe(h: HandlerState, runId: string, fromSeq: number): Promise<RunEvent[]> {
  unsubscribeRun(h, runId);
  const batcher = new Batcher<RunEvent>((batch) => h.deps.push?.(runId, batch), h.deps.batchMs ?? 50);
  const { backlog, unsubscribe } = await requireRuns(h).subscribe(runId, fromSeq, (e) => {
    batcher.push(e);
    if (e.type === 'run.finished') batcher.flush();
  });
  h.subs.set(runId, { batcher, unsubscribe });
  return backlog;
}

export async function handleRuns(h: HandlerState, channel: string, arg: unknown): Promise<unknown> {
  switch (channel) {
    case CHANNELS.startRun:
      return requireRuns(h).submit(arg as StartRunRequest);
    case CHANNELS.listQueue:
      return requireRuns(h).queued();
    case CHANNELS.unqueue:
      return requireRuns(h).unqueue(arg as string);
    case CHANNELS.resumeRun:
      return requireRuns(h).resumeRun(arg as string);
    case CHANNELS.proposeCorrection: {
      const { runId, text, prefer } = arg as { runId: string; text: string; prefer?: string };
      return requireRuns(h).proposeCorrection(runId, text, prefer);
    }
    case CHANNELS.previewFile: {
      const { runId, key, path } = arg as { runId: string; key: string; path: string };
      return requireRuns(h).previewFile(runId, key, path);
    }
    case CHANNELS.openPreview: {
      const { runId, key, path } = arg as { runId: string; key: string; path: string };
      const loc = await requireRuns(h).locatePreview(runId, key, path);
      if (!loc || !h.deps.openFile) return false;
      await h.deps.openFile(loc.abs);
      return true;
    }
    case CHANNELS.correctRun: {
      const { runId, ...req } = arg as { runId: string; text: string; nodeId: string; files?: string[]; attachments?: string[] };
      return requireRuns(h).correctRun(runId, req);
    }
    case CHANNELS.dismissRun:
      return requireRuns(h).dismiss(arg as string);
    case CHANNELS.acceptRun: {
      const { runId, by, reason } = arg as { runId: string; by: 'user' | 'assistant'; reason: string };
      return requireRuns(h).accept(runId, { by, reason });
    }
    case CHANNELS.controlRun: {
      const { runId, action } = arg as { runId: string; action: RunAction };
      const runs = requireRuns(h);
      if (action === 'pause') runs.pause(runId);
      else if (action === 'resume') runs.resume(runId);
      else runs.cancel(runId);
      return null;
    }
    case CHANNELS.answerRun: {
      const { runId, questionId, text } = arg as { runId: string; questionId: string; text: string };
      return requireRuns(h).answer(runId, questionId, text);
    }
    case CHANNELS.subscribeRun: {
      const { runId, fromSeq } = arg as { runId: string; fromSeq: number };
      return subscribe(h, runId, fromSeq);
    }
    case CHANNELS.unsubscribeRun: {
      unsubscribeRun(h, arg as string);
      return null;
    }
    case CHANNELS.listRuns:
      return requireRuns(h).list();
    case CHANNELS.pendingQuestions:
      return requireRuns(h).pending(arg as string);
    case CHANNELS.runDiagram:
      return requireRuns(h).runDiagram(arg as string);
    case CHANNELS.listOutput:
      return requireRuns(h).listOutput(arg as string);
    case CHANNELS.readOutput: {
      const { runId, path } = arg as { runId: string; path: string };
      return requireRuns(h).readOutput(runId, path);
    }
    case CHANNELS.stageAttachment: {
      const { name, data } = arg as { name: string; data: Uint8Array };
      return requireStore(h).stageAttachment(name, data);
    }
    case CHANNELS.pickAttachments: {
      // El diálogo lo abre el proceso principal: el renderer solo recibe nombre, tamaño e id [R48.6].
      const store = requireStore(h);
      const picked = await h.deps.pickInputFiles?.();
      if (!picked || picked.length === 0) return null;
      if (picked.length > MAX_INPUT_FILES) throw new StoreError('invalid', `Como mucho ${MAX_INPUT_FILES} archivos en la entrada`);
      const out = [];
      for (const abs of picked) {
        const st = await fsp.stat(abs);
        if (st.size > MAX_ATTACHMENT_BYTES) throw new StoreError('invalid', `«${basename(abs)}» supera los 20 MB`);
        out.push(await store.stageAttachment(basename(abs), new Uint8Array(await fsp.readFile(abs))));
      }
      return out;
    }
    case CHANNELS.pickProjectFiles: {
      const store = requireStore(h);
      const base = await store.inputBase();
      const picked = await h.deps.pickInputFiles?.(base);
      if (!picked || picked.length === 0) return null;
      const rels = picked.map((abs) => {
        const rel = relative(base, abs);
        if (rel.startsWith('..') || isAbsolute(rel)) throw new StoreError('outside-root', `«${basename(abs)}» no está en la carpeta de trabajo; para archivos de fuera usa «Adjuntar»`);
        return rel.split(sep).join('/');
      });
      return store.inputFiles(rels);
    }
    case CHANNELS.listBackups:
      return requireStore(h).listBackups(arg as string);
    case CHANNELS.restoreBackup: {
      const r = arg as { runId: string; path: string };
      return requireStore(h).restoreBackup(r.runId, r.path);
    }
    case CHANNELS.readRunFile: {
      const r = arg as { runId: string; path: string };
      // Nunca un secreto, aunque un agente lo escribiera [R45.11].
      return requireStore(h).readRunFile(r.runId, r.path, { blocked: (rel) => isSensitivePath(rel) });
    }
    default:
      return UNHANDLED;
  }
}
