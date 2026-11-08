import { describe, expect, it, vi } from 'vitest';
import type { MemoryEntry } from '@orquestador/core';
import { Background, memoryNoticeTitle, type BackgroundDeps, type BackgroundWindow } from '../src/main/background';
import { memoryTools } from '../src/main/composition';

const T = '2026-11-08T10:00:00.000Z';
const entry = (id: string, o: Partial<MemoryEntry> = {}): MemoryEntry => ({ id, kind: 'convention', scope: 'project', title: `Título ${id}`, text: `Texto ${id}`, status: 'active', source: { origin: 'manual' }, createdAt: T, updatedAt: T, uses: 0, history: [], ...o });
const textOf = (r: { content: { text: string }[] }) => r.content.map((c) => c.text).join('');

describe('SPEC-076 · en la app de escritorio', () => {
  const all = [entry('a', { title: 'Gestor', text: 'Usa pnpm' }), entry('b', { scope: 'agent:otro', text: 'pnpm de otro' }), entry('c', { status: 'archived', text: 'pnpm viejo' }), entry('f', { kind: 'false-alarm', text: 'pnpm aviso' })];

  it('[R76.15] memoria_proyecto: buscar y leer, solo en los ámbitos del paso y sin forma de escribir', async () => {
    const tools = memoryTools(async () => all, ['project']);
    expect(tools.map((t) => t.name)).toEqual(['buscar', 'leer']);
    const found = textOf(await tools[0]!.handler({ texto: 'pnpm' }));
    expect(found).toContain('a · Gestor');
    expect(found).not.toContain('de otro');
    expect(found).not.toContain('viejo');
    expect(found).not.toContain('aviso');
    expect(textOf(await tools[0]!.handler({ texto: 'nada' }))).toContain('No hay nada');
    expect(textOf(await tools[1]!.handler({ id: 'a' }))).toContain('Usa pnpm');
    for (const id of ['b', 'c', 'f', 'zz']) expect((await tools[1]!.handler({ id })).isError).toBe(true);
  });

  it('[R76.10] la bandeja avisa de las cosas para recordar y abre su Resumen', () => {
    expect(memoryNoticeTitle(3, 'Web')).toBe('3 cosas para recordar de Web');
    expect(memoryNoticeTitle(1, 'Web')).toBe('1 cosa para recordar de Web');
    const clicks: (() => void)[] = [];
    const win: BackgroundWindow = { isDestroyed: () => false, isVisible: () => false, isMinimized: () => false, isFocused: () => false, hide: vi.fn(), show: vi.fn(), restore: vi.fn(), focus: vi.fn() };
    const deps = {
      window: () => win,
      createWindow: vi.fn(),
      createTray: vi.fn(),
      notify: vi.fn((_n: { title: string; body: string }, onClick: () => void) => void clicks.push(onClick)),
      openRun: vi.fn(),
      activeRuns: vi.fn(() => 0),
      confirmQuit: vi.fn(async () => true),
      quit: vi.fn(),
    } as unknown as BackgroundDeps;
    const bg = new Background(deps);
    bg.memoryProposals({ runId: 'r1', diagramName: 'Web', count: 0 });
    expect(deps.notify).not.toHaveBeenCalled();
    bg.memoryProposals({ runId: 'r1', diagramName: 'Web', count: 3 });
    expect(deps.notify).toHaveBeenCalledWith(expect.objectContaining({ title: '3 cosas para recordar de Web' }), expect.any(Function));
    clicks[0]!();
    expect(deps.openRun).toHaveBeenCalledWith({ runId: 'r1', live: false });
  });
});
