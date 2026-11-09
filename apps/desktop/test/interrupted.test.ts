import { describe, expect, it, vi } from 'vitest';
import { Background, interruptedLabel, type BackgroundDeps, type InterruptedItem } from '../src/main/background';

function setup() {
  let tray: InterruptedItem[] = [];
  const clicks: (() => void)[] = [];
  const deps: BackgroundDeps = {
    window: () => undefined,
    createWindow: vi.fn(),
    createTray: vi.fn(),
    setTrayRuns: (items) => void (tray = items),
    notify: vi.fn((_n: { title: string; body: string }, onClick: () => void) => void clicks.push(onClick)),
    openRun: vi.fn(),
    activeRuns: () => 0,
    confirmQuit: async () => true,
    quit: vi.fn(),
  };
  const bg = new Background(deps);
  bg.start();
  return { bg, deps, tray: () => tray, clicks };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('SPEC-074 · interrumpidas al abrir', () => {
  it('[R74.12] salen en la bandeja con «Reanudar» y «Descartar», y un aviso lo dice; nada se reanuda solo', async () => {
    const { bg, deps, tray, clicks } = setup();
    const resume = vi.fn(async (id: string) => ({ runId: `${id}-nueva` }));
    const dismiss = vi.fn(async () => true);
    bg.offerInterrupted([{ runId: 'r1', diagramName: 'Web', lastStep: 'Plan' }, { runId: 'r2', diagramName: 'Api' }], { resume, dismiss });
    expect(tray().map((i) => i.label)).toEqual(['Web: interrumpida tras «Plan»', 'Api: interrumpida al empezar']);
    expect(deps.notify).toHaveBeenCalledWith({ title: 'Hay 2 ejecuciones interrumpidas', body: 'Web: interrumpida tras «Plan» · Api: interrumpida al empezar' }, expect.any(Function));
    expect(resume).not.toHaveBeenCalled();
    clicks[0]!();
    expect(deps.openRun).toHaveBeenCalledWith({ runId: 'r1', live: false });

    tray()[0]!.resume();
    await flush();
    expect(resume).toHaveBeenCalledWith('r1');
    expect(deps.openRun).toHaveBeenLastCalledWith({ runId: 'r1-nueva', live: true });
    expect(tray().map((i) => i.label)).toEqual(['Api: interrumpida al empezar']);
    tray()[0]!.dismiss();
    await flush();
    expect(dismiss).toHaveBeenCalledWith('r2');
    expect(tray()).toEqual([]);
  });

  it('[R74.12] sin interrumpidas no hay aviso', () => {
    const { bg, deps } = setup();
    bg.offerInterrupted([], { resume: vi.fn(), dismiss: vi.fn() });
    expect(deps.notify).not.toHaveBeenCalled();
    expect(interruptedLabel({ diagramName: 'X', lastStep: 'Y' })).toBe('X: interrumpida tras «Y»');
  });
});
