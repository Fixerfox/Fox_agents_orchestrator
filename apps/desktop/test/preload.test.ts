import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { CHANNELS } from '@orquestador/editor';
import { buildApi } from '../src/preload/api';

describe('preload: API tipada [R19.2]', () => {
  it('[R19.2] cada método invoca su canal con solo los datos necesarios', async () => {
    const invoke = vi.fn(async (_channel: string, _payload?: unknown) => ({ ok: true, value: null }));
    const api = buildApi(invoke);
    await api.createProject();
    await api.openProject();
    await api.listDiagrams();
    await api.loadDiagram('a');
    await api.saveDiagram({ id: 'a', name: 'A', schemaVersion: 1, nodes: [], edges: [] });
    await api.listExamples();
    await api.startRun({ diagramId: 'a', order: 'x' });
    expect(invoke.mock.calls.map((c) => c[0])).toEqual([
      CHANNELS.createProject,
      CHANNELS.openProject,
      CHANNELS.listDiagrams,
      CHANNELS.loadDiagram,
      CHANNELS.saveDiagram,
      CHANNELS.listExamples,
      CHANNELS.startRun,
    ]);
    expect(invoke.mock.calls[3]).toEqual([CHANNELS.loadDiagram, 'a']);
  });

  it('[R19.2][R29.4][R30.13][R61.12] la API expuesta no contiene nada más que los métodos del contrato', () => {
    const api = buildApi(async () => null);
    expect(Object.keys(api).sort()).toEqual([...Object.keys(CHANNELS), 'onRunEvents', 'onAssistantEvents', 'onTerminalEvents', 'onOpenRun'].sort());
    expect(Object.values(api).every((v) => typeof v === 'function')).toBe(true);
  });

  it('[R61.12] abrir una ejecución llega por su canal de una sola dirección', () => {
    const listener = vi.fn();
    const subscribe = vi.fn(() => () => {});
    const api = buildApi(async () => null, undefined, undefined, undefined, subscribe);
    api.onOpenRun(listener);
    expect(subscribe).toHaveBeenCalledWith(listener);
    const src = readFileSync(join(__dirname, '..', 'src', 'preload', 'preload.ts'), 'utf8');
    expect(src).toContain('ipcRenderer.on(OPEN_RUN_CHANNEL, handler)');
    expect(src).not.toContain('ipcRenderer.send(OPEN_RUN_CHANNEL');
  });

  it('[R19.2] el preload solo expone buildApi: no entrega ipcRenderer ni require', () => {
    const src = readFileSync(join(__dirname, '..', 'src', 'preload', 'preload.ts'), 'utf8');
    const exposed = src.match(/exposeInMainWorld\(([\s\S]*?)\n\);/)![1]!;
    expect(exposed).toContain("'orquestador'");
    expect(exposed).toContain('buildApi(');
    expect(exposed).not.toMatch(/exposeInMainWorld\(\s*'[^']+',\s*ipcRenderer/);
    expect(src).not.toMatch(/\brequire\(/);
  });
});
