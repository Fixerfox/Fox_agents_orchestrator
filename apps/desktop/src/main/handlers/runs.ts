import { promises as fsp } from 'node:fs';
import { basename, isAbsolute, relative, sep } from 'node:path';
import { isSensitivePath } from '@orquestador/claude';
import { CHECK_TIMEOUT_SEC, clipMiddle, redactString, type CheckResult, type GitAction, type ReviewDraft, type RunEvent, type StepCheck } from '@orquestador/core';
import { checkRunnerFor } from '../checks';
import type { ProjectStore } from '@orquestador/store';
import { CHANNELS, type RunAction, type StartRunRequest } from '@orquestador/editor';
import { Batcher, type GitService, type RunService } from '@orquestador/runtime';
import { reviewTokenKey } from '../composition';
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

/** El git del proyecto abierto, para el visor [R98.1]. */
function requireGit(h: HandlerState): GitService {
  const git = requireRuns(h).git;
  if (!git) throw new StoreError('unavailable', 'Este proyecto no tiene control de versiones');
  return git;
}

export async function handleRuns(h: HandlerState, channel: string, arg: unknown): Promise<unknown> {
  switch (channel) {
    case CHANNELS.startRun:
      return requireRuns(h).submit(arg as StartRunRequest);
    case CHANNELS.gitOverview:
      return (await requireRuns(h).git?.overview()) ?? null;
    case CHANNELS.gitHistory:
      return requireGit(h).history((arg as { limit?: number }).limit ?? 200);
    case CHANNELS.gitDiff:
      // Lo que puede llevar secretos no llega a la interfaz, como en el visor de ficheros [R98.3].
      if (isSensitivePath((arg as { path: string }).path)) return 'Este archivo puede contener secretos: no se enseña.';
      return requireGit(h).diff((arg as { path: string }).path);
    case CHANNELS.gitAct: {
      const git = requireGit(h);
      const action = arg as GitAction;
      // Un commit se lleva todo lo que haya: si hay algo nuevo que puede llevar secretos, no se hace desde aquí [R98.10].
      if (action.kind === 'commit') {
        const risky = ((await git.overview())?.changes ?? []).filter((c) => (c.status === 'untracked' || c.status === 'added') && isSensitivePath(c.path)).map((c) => c.path);
        if (risky.length > 0) throw new StoreError('invalid', `No se hace el commit: ${risky.slice(0, 3).join(', ')} puede llevar secretos y entraría en él. Añádelo a .gitignore, o haz el commit en la terminal.`);
      }
      return git.act(action);
    }
    case CHANNELS.gitReviews:
      return (await requireRuns(h).git?.reviews()) ?? null;
    case CHANNELS.gitCreateReview:
      return requireGit(h).createReview(arg as ReviewDraft);
    case CHANNELS.setReviewToken:
    case CHANNELS.clearReviewToken: {
      // El token es del servidor de `origin` de ahora: se guarda cifrado y no vuelve a la interfaz [R99.8].
      const remote = await requireGit(h).remote();
      if (!remote) throw new StoreError('invalid', 'Este repositorio no tiene un origin de GitHub ni de GitLab');
      if (!h.deps.mcpVault) throw new StoreError('unavailable', 'No hay almacén seguro para guardar el token');
      if (channel === CHANNELS.setReviewToken) await h.deps.mcpVault.set(reviewTokenKey(remote.host), 'token', (arg as { token: string }).token);
      else await h.deps.mcpVault.remove(reviewTokenKey(remote.host));
      return null;
    }
    case CHANNELS.gitGuard:
      return requireRuns(h).gitGuard((arg as { diagramId: string }).diagramId);
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
    case CHANNELS.supervisorFeedback: {
      const { runId, ...req } = arg as { runId: string; alertSeq: number; verdict: 'false-alarm' | 'confirmed'; note?: string };
      return requireRuns(h).supervisorFeedback(runId, req);
    }
    case CHANNELS.supervisorStats:
      return requireRuns(h).supervisorStats(arg as string);
    case CHANNELS.decideMemory: {
      const { runId, ...req } = arg as { runId: string; proposalId: string; decision: 'save' | 'discard'; edited?: { title?: string; text?: string } };
      return requireRuns(h).decideMemory(runId, req);
    }
    case CHANNELS.projectMemory:
      return requireRuns(h).projectMemory();
    case CHANNELS.saveMemoryEntry: {
      // Lo que guarda el asistente queda como suyo [R76.12].
      const { by, ...entry } = arg as Parameters<RunService['saveMemoryEntry']>[0] & { by?: 'user' | 'assistant' };
      return requireRuns(h).saveMemoryEntry(entry, by ?? 'user');
    }
    case CHANNELS.tryCheck:
      return tryCheck(requireStore(h), arg as StepCheck);
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

/**
 * «Ejecutar ahora» desde el lateral [R75.24]: la persona escribe y lanza el comando, así que queda aprobado. Las que
 * miran la salida del paso solo se pueden probar al ejecutarlo.
 */
export async function tryCheck(store: ProjectStore, check: StepCheck): Promise<CheckResult> {
  const runner = checkRunnerFor(store);
  const started = Date.now();
  const base = { checkId: check.id, label: check.label, kind: check.kind };
  if (check.kind === 'command') {
    await runner.approve(check.run);
    const r = await runner.command({ run: check.run, timeoutSec: check.timeoutSec ?? CHECK_TIMEOUT_SEC }, new AbortController().signal);
    const ok = !r.timedOut && r.exitCode === (check.expectExit ?? 0);
    return { ...base, ok, detail: redactString(clipMiddle(r.output, 2000)), durationMs: r.durationMs };
  }
  if (check.kind === 'files') {
    const missing = await runner.missing(check.mustExist ?? []);
    return { ...base, ok: missing.length === 0, detail: missing.length === 0 ? 'Todo en su sitio' : `No existe: ${missing.join(', ')}`, durationMs: Date.now() - started };
  }
  return { ...base, ok: false, detail: 'Esta comprobación mira la salida del paso: se prueba al ejecutarlo.', durationMs: 0 };
}
