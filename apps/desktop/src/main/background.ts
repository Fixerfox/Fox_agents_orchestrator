import type { Diagram, RunEvent } from '@orquestador/core';
import type { OpenRunTarget } from '@orquestador/editor';
import { noticeFor } from './notices';

/** Lo que hace falta de la ventana; se inyecta para probar sin Electron. */
export interface BackgroundWindow {
  isDestroyed(): boolean;
  isVisible(): boolean;
  isMinimized(): boolean;
  isFocused(): boolean;
  hide(): void;
  show(): void;
  restore(): void;
  focus(): void;
}

export interface BackgroundDeps {
  window(): BackgroundWindow | undefined;
  createWindow(): void;
  /** Crea el icono de la bandeja; lanza un error si el sistema no puede [R61.5]. */
  createTray(actions: { open(): void; quit(): void }): void;
  /** Entradas de la bandeja con las ejecuciones interrumpidas y qué hacer con cada una [R74.12]. */
  setTrayRuns?(items: InterruptedItem[]): void;
  notify(notice: { title: string; body: string }, onClick: () => void): void;
  openRun(target: OpenRunTarget): void;
  /** Ejecuciones en marcha o en cola [R61.3]. */
  activeRuns(): number;
  confirmQuit(active: number): Promise<boolean>;
  quit(): void;
}

/** Una ejecución interrumpida en la bandeja: «Reanudar» y «Descartar» [R74.12]. */
export interface InterruptedItem {
  label: string;
  resume(): void;
  dismiss(): void;
}

/** Texto de una ejecución interrumpida en la bandeja [R74.12]. */
export const interruptedLabel = (r: { diagramName: string; lastStep?: string }): string => (r.lastStep ? `${r.diagramName}: interrumpida tras «${r.lastStep}»` : `${r.diagramName}: interrumpida al empezar`);

export const HIDDEN_NOTICE = {
  title: 'Orquestador sigue abierto',
  body: 'Las ejecuciones continúan. Vuelve desde el icono junto a la hora o abriendo la app otra vez.',
};

/** Vida de la app con la ventana cerrada: bandeja, salida y avisos [R61.1][R61.10]. */
export class Background {
  private hasTray = false;
  private quitting = false;
  private hintShown = false;

  constructor(private readonly deps: BackgroundDeps) {}

  /** Sin icono no habría forma de volver: entonces cerrar sale, como antes [R61.5]. */
  start(): void {
    try {
      this.deps.createTray({ open: () => this.open(), quit: () => void this.requestQuit() });
      this.hasTray = true;
    } catch {
      this.hasTray = false;
    }
  }

  /** La ventana va a cerrarse: se oculta salvo que la app esté saliendo [R61.1]. */
  onClose(event: { preventDefault(): void }): void {
    const win = this.deps.window();
    if (this.quitting || !this.hasTray || !win) return;
    event.preventDefault();
    win.hide();
    if (this.hintShown) return;
    this.hintShown = true;
    this.deps.notify(HIDDEN_NOTICE, () => this.open());
  }

  /** La app sale, o el sistema se apaga: la ventana ya no puede retenerla [R61.5]. */
  onQuitting(): void {
    this.quitting = true;
  }

  /** Muestra la ventana esté como esté [R61.2][R61.6]. */
  open(): void {
    const win = this.deps.window();
    if (!win || win.isDestroyed()) return this.deps.createWindow();
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }

  /** «Salir» de la bandeja; con trabajo en curso hay que confirmarlo [R61.3]. */
  async requestQuit(): Promise<void> {
    const active = this.deps.activeRuns();
    if (active > 0 && !(await this.deps.confirmQuit(active))) return;
    this.deps.quit();
  }

  /** ¿La persona tiene la app delante? Entonces el aviso sobra [R61.10]. */
  private attended(): boolean {
    const win = this.deps.window();
    return !!win && !win.isDestroyed() && win.isVisible() && !win.isMinimized() && win.isFocused();
  }

  /**
   * Al abrir un proyecto: sus ejecuciones interrumpidas salen en la bandeja con «Reanudar» y «Descartar», y un aviso
   * lo dice. No se reanuda nada solo [R74.12].
   */
  offerInterrupted(runs: readonly { runId: string; diagramName: string; lastStep?: string }[], act: { resume(runId: string): Promise<unknown>; dismiss(runId: string): Promise<unknown> }): void {
    const pending = [...runs];
    const refresh = () =>
      this.deps.setTrayRuns?.(
        pending.map((r) => ({
          label: interruptedLabel(r),
          resume: () => void this.settle(pending, r.runId, refresh, act.resume(r.runId), true),
          dismiss: () => void this.settle(pending, r.runId, refresh, act.dismiss(r.runId), false),
        })),
      );
    refresh();
    if (pending.length === 0) return;
    const title = pending.length === 1 ? 'Hay una ejecución interrumpida' : `Hay ${pending.length} ejecuciones interrumpidas`;
    this.deps.notify({ title, body: pending.map(interruptedLabel).join(' · ').slice(0, 160) }, () => {
      this.open();
      this.deps.openRun({ runId: pending[0]!.runId, live: false });
    });
  }

  private async settle(pending: { runId: string }[], runId: string, refresh: () => void, done: Promise<unknown>, open: boolean): Promise<void> {
    try {
      const r = await done;
      const i = pending.findIndex((p) => p.runId === runId);
      if (i >= 0) pending.splice(i, 1);
      refresh();
      const next = r && typeof r === 'object' && 'runId' in r ? (r as { runId: string }).runId : undefined;
      if (open && next) {
        this.open();
        this.deps.openRun({ runId: next, live: true });
      }
    } catch {
      /* lo dice la app al abrir la ejecución */
    }
  }

  /** Evento de cualquier ejecución [R61.7][R61.8]. */
  onRunEvent(event: RunEvent, diagram: Diagram): void {
    const notice = noticeFor(event, diagram);
    if (!notice || this.attended()) return;
    const { title, body, runId, live } = notice;
    this.deps.notify({ title, body }, () => {
      this.open();
      this.deps.openRun({ runId, live });
    });
  }
}
