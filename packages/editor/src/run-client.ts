import type { RunEvent } from '@orquestador/core';
import type { ProjectApi, RunAction, StartRunRequest } from './api';
import { t } from './i18n';
import { deriveLive, EMPTY_LIVE, type LiveView } from './live';

export interface RunSnapshot {
  version: number;
  runId?: string;
  events: RunEvent[];
  live: LiveView;
  error?: string;
}

/**
 * Cliente de una ejecución: se suscribe, ordena y deduplica los eventos por `seq` (R15.8)
 * y expone el estado derivado. Compatible con `useSyncExternalStore`.
 */
export class RunClient {
  private runId: string | undefined;
  private events: RunEvent[] = [];
  private lastSeq = 0;
  private error: string | undefined;
  private version = 0;
  private cached: RunSnapshot | undefined;
  private attaching = false;
  private buffer: RunEvent[] = [];
  private resyncing = false;
  private readonly listeners = new Set<() => void>();
  private readonly off: () => void;

  constructor(private readonly api: ProjectApi) {
    this.off = api.onRunEvents((runId, events) => this.receive(runId, events));
  }

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => void this.listeners.delete(l);
  };

  getSnapshot = (): RunSnapshot => {
    if (this.cached?.version === this.version) return this.cached;
    this.cached = {
      version: this.version,
      ...(this.runId !== undefined ? { runId: this.runId } : {}),
      events: this.events,
      live: this.events.length > 0 ? deriveLive(this.events) : EMPTY_LIVE,
      ...(this.error !== undefined ? { error: this.error } : {}),
    };
    return this.cached;
  };

  private changed(): void {
    this.version++;
    for (const l of [...this.listeners]) l();
  }

  private fail(message: string | undefined): void {
    this.error = message;
    this.changed();
  }

  private ingest(batch: readonly RunEvent[]): boolean {
    let added = false;
    for (const e of batch) {
      if (e.seq <= this.lastSeq) continue; // duplicado
      if (e.seq !== this.lastSeq + 1) {
        if (added) this.changed(); // lo leído hasta aquí se enseña igual [R2.11]
        return false; // hueco: hay que resincronizar
      }
      this.events = [...this.events, e];
      this.lastSeq = e.seq;
      added = true;
    }
    if (added) this.changed();
    return true;
  }

  private receive(runId: string, batch: RunEvent[]): void {
    if (runId !== this.runId) return;
    if (this.attaching || this.resyncing) {
      this.buffer.push(...batch);
      return;
    }
    if (!this.ingest(batch)) void this.resync(batch);
  }

  private async resync(extra: readonly RunEvent[]): Promise<void> {
    if (this.resyncing || !this.runId) return;
    this.resyncing = true;
    this.buffer.push(...extra);
    try {
      const res = await this.api.subscribeRun({ runId: this.runId, fromSeq: this.lastSeq + 1 });
      if (!res.ok) return this.fail(res.error.message);
      this.ingest(res.value);
      const pending = this.buffer.sort((a, b) => a.seq - b.seq);
      this.buffer = [];
      this.ingest(pending);
    } finally {
      this.resyncing = false;
    }
  }

  /** Empieza a seguir una ejecución (nueva o ya existente) desde cero. */
  async attach(runId: string): Promise<void> {
    this.runId = runId;
    this.events = [];
    this.lastSeq = 0;
    this.error = undefined;
    this.buffer = [];
    this.attaching = true;
    this.changed();
    let complete: boolean;
    try {
      const res = await this.api.subscribeRun({ runId, fromSeq: 1 });
      if (!res.ok) return this.fail(res.error.message);
      complete = this.ingest(res.value);
    } finally {
      this.attaching = false;
    }
    const pending = this.buffer.sort((a, b) => a.seq - b.seq);
    this.buffer = [];
    if (!this.ingest(pending)) await this.resync([]);
    if (!complete) this.fail(t('runs.gap'));
  }

  async start(req: StartRunRequest): Promise<string | undefined> {
    const res = await this.api.startRun(req);
    if (!res.ok) {
      this.fail(res.error.message);
      return undefined;
    }
    // En cola no hay ejecución que seguir todavía [R52.3].
    if (res.value.runId === undefined) return undefined;
    await this.attach(res.value.runId);
    return res.value.runId;
  }

  async control(action: RunAction): Promise<void> {
    if (!this.runId) return;
    const res = await this.api.controlRun({ runId: this.runId, action });
    this.fail(res.ok ? undefined : res.error.message);
  }

  async answer(questionId: string, text: string): Promise<boolean> {
    if (!this.runId) return false;
    const res = await this.api.answerRun({ runId: this.runId, questionId, text });
    if (!res.ok) {
      this.fail(res.error.message);
      return false;
    }
    return res.value;
  }

  async detach(): Promise<void> {
    if (this.runId) await this.api.unsubscribeRun(this.runId);
    this.runId = undefined;
    this.events = [];
    this.lastSeq = 0;
    this.changed();
  }

  dispose(): void {
    this.off();
    this.listeners.clear();
  }
}
