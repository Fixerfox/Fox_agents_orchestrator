import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { Diagram, RunEvent } from '@orquestador/core';
import { Background, HIDDEN_NOTICE, type BackgroundDeps, type BackgroundWindow } from '../src/main/background';
import { noticeFor } from '../src/main/notices';
import { windowOptions } from '../src/main/window';
import { APP_USER_MODEL_ID, appIdRegistration } from '../src/main/windows-app-id';

const DIAGRAM: Diagram = {
  id: 'd',
  name: 'Web de la tienda',
  schemaVersion: 1,
  nodes: [
    { id: 'a', kind: 'agent', agentId: 'auditor', label: 'Auditor' },
    { id: 'b', kind: 'agent', agentId: 'redactor' },
    { id: 's', kind: 'subdiagram', label: 'Publicar', subdiagram: { templateId: 't', version: 'latest' } },
  ],
  edges: [],
} as unknown as Diagram;

const event = (body: Record<string, unknown>) => ({ runId: 'r1', seq: 1, ts: '2026-11-06T10:00:00.000Z', ...body }) as unknown as RunEvent;
const question = (extra: Record<string, unknown> = {}) => event({ type: 'agent.question', nodeId: 'a', questionId: 'q1', text: '¿Pixel art o vectorial?', ...extra });
const finished = (status: string, reason?: string) => event({ type: 'run.finished', status, ...(reason ? { reason } : {}) });

function fakeWindow(state: Partial<Record<'visible' | 'minimized' | 'focused' | 'destroyed', boolean>> = {}) {
  const s = { visible: true, minimized: false, focused: false, destroyed: false, ...state };
  const win: BackgroundWindow = {
    isDestroyed: () => s.destroyed,
    isVisible: () => s.visible,
    isMinimized: () => s.minimized,
    isFocused: () => s.focused,
    hide: vi.fn(() => void (s.visible = false)),
    show: vi.fn(() => void (s.visible = true)),
    restore: vi.fn(() => void (s.minimized = false)),
    focus: vi.fn(() => void (s.focused = true)),
  };
  return win;
}

function setup(win: BackgroundWindow | undefined = fakeWindow(), over: Partial<BackgroundDeps> = {}) {
  const clicks: (() => void)[] = [];
  const deps = {
    window: () => win,
    createWindow: vi.fn(),
    createTray: vi.fn(),
    notify: vi.fn((_n: { title: string; body: string }, onClick: () => void) => void clicks.push(onClick)),
    openRun: vi.fn(),
    activeRuns: vi.fn(() => 0),
    confirmQuit: vi.fn(async () => true),
    quit: vi.fn(),
    ...over,
  };
  const bg = new Background(deps);
  bg.start();
  return { bg, deps, win: win!, clicks };
}
const closing = () => ({ preventDefault: vi.fn() });

describe('bandeja del sistema [R61.1]', () => {
  it('[R61.1] cerrar oculta la ventana y la app sigue viva', () => {
    const { bg, deps, win } = setup();
    const e = closing();
    bg.onClose(e);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(win.hide).toHaveBeenCalled();
    expect(deps.quit).not.toHaveBeenCalled();
  });

  it('[R61.2] las acciones del icono abren la ventana y salen', async () => {
    const { deps, win } = setup(fakeWindow({ visible: false }));
    const { open, quit } = vi.mocked(deps.createTray).mock.calls[0]![0];
    open();
    expect(win.show).toHaveBeenCalled();
    expect(win.focus).toHaveBeenCalled();
    quit();
    await vi.waitFor(() => expect(deps.quit).toHaveBeenCalled());
  });

  it('[R61.3] sin nada en marcha sale sin preguntar', async () => {
    const { bg, deps } = setup();
    await bg.requestQuit();
    expect(deps.confirmQuit).not.toHaveBeenCalled();
    expect(deps.quit).toHaveBeenCalled();
  });

  it('[R61.3] con ejecuciones en marcha pide confirmación con cuántas son', async () => {
    const { bg, deps } = setup(fakeWindow(), { activeRuns: () => 3 });
    await bg.requestQuit();
    expect(deps.confirmQuit).toHaveBeenCalledWith(3);
    expect(deps.quit).toHaveBeenCalled();
  });

  it('[R61.3] si se rechaza no pasa nada', async () => {
    const { bg, deps } = setup(fakeWindow(), { activeRuns: () => 1, confirmQuit: async () => false });
    await bg.requestQuit();
    expect(deps.quit).not.toHaveBeenCalled();
    const e = closing();
    bg.onClose(e);
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it('[R61.4] solo el primer cierre avisa, y el aviso devuelve la ventana', () => {
    const { bg, deps, win, clicks } = setup();
    bg.onClose(closing());
    bg.onClose(closing());
    expect(deps.notify).toHaveBeenCalledTimes(1);
    expect(vi.mocked(deps.notify).mock.calls[0]![0]).toEqual(HIDDEN_NOTICE);
    clicks[0]!();
    expect(win.show).toHaveBeenCalled();
  });

  it('[R61.5] sin icono, cerrar termina la app como antes', () => {
    const { bg, win } = setup(fakeWindow(), {
      createTray: () => {
        throw new Error('sin bandeja');
      },
    });
    const e = closing();
    bg.onClose(e);
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(win.hide).not.toHaveBeenCalled();
  });

  it('[R61.5] al salir o apagar el sistema la ventana ya no retiene el cierre', () => {
    const { bg, win } = setup();
    bg.onQuitting();
    const e = closing();
    bg.onClose(e);
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(win.hide).not.toHaveBeenCalled();
  });

  it('[R61.5] el proceso principal engancha la salida y el fin de sesión', () => {
    const main = readFileSync(join(__dirname, '..', 'src', 'main', 'main.ts'), 'utf8');
    expect(main).toMatch(/app\.on\('before-quit', \(\) => background\.onQuitting\(\)\)/);
    expect(main).toMatch(/win\.on\('session-end', \(\) => background\.onQuitting\(\)\)/);
  });

  it('[R61.6] abrir de nuevo restaura una ventana minimizada u oculta', () => {
    const { bg, win } = setup(fakeWindow({ visible: false, minimized: true }));
    bg.open();
    expect(win.restore).toHaveBeenCalled();
    expect(win.show).toHaveBeenCalled();
    expect(win.focus).toHaveBeenCalled();
  });

  it('[R61.6] si la ventana ya no existe, crea otra', () => {
    const { bg, deps } = setup(fakeWindow({ destroyed: true }));
    bg.open();
    expect(deps.createWindow).toHaveBeenCalled();
  });

  it('[R61.6] la segunda instancia termina y la primera enseña su ventana', () => {
    const main = readFileSync(join(__dirname, '..', 'src', 'main', 'main.ts'), 'utf8');
    expect(main).toMatch(/if \((?:!smoke && )?!app\.requestSingleInstanceLock\(\)\) app\.exit\(0\)/);
    expect(main).toMatch(/app\.on\('second-instance', \(\) => background\.open\(\)\)/);
  });
});

describe('avisos de escritorio [R61.7]', () => {
  it('[R18.17][R61.7] una pregunta dice quién la hace y qué pregunta', () => {
    expect(noticeFor(question(), DIAGRAM)).toEqual({ title: 'Auditor te pregunta', body: '¿Pixel art o vectorial?', runId: 'r1', live: true });
  });

  it('[R61.7] el título cambia según lo que espera', () => {
    const title = (extra: Record<string, unknown>) => noticeFor(question(extra), DIAGRAM)!.title;
    expect(title({ kind: 'permission' })).toBe('Auditor pide permiso');
    expect(title({ kind: 'gate' })).toBe('Auditor espera tu visto bueno');
    expect(title({ confirm: { round: 1 } })).toBe('Auditor espera tu confirmación');
    expect(title({ review: { round: 1, max: 2, phase: 'feedback' } })).toBe('Auditor espera tu revisión');
  });

  it('[R61.7] sin nombre usa el agente, y dentro de un subdiagrama nombra el subdiagrama', () => {
    expect(noticeFor(question({ nodeId: 'b' }), DIAGRAM)!.title).toBe('redactor te pregunta');
    expect(noticeFor(question({ nodeId: 'interno', nodePath: ['s'] }), DIAGRAM)!.title).toBe('Publicar te pregunta');
    expect(noticeFor(question({ nodeId: 'perdido' }), DIAGRAM)!.title).toBe('Un agente te pregunta');
  });

  it('[R61.7] el texto va en una línea, recortado, y nunca vacío', () => {
    const body = noticeFor(question({ text: `  una\n\nlínea ${'x'.repeat(400)}` }), DIAGRAM)!.body;
    expect(body.startsWith('una línea x')).toBe(true);
    expect(body.length).toBeLessThanOrEqual(160);
    expect(body.endsWith('…')).toBe(true);
    expect(noticeFor(question({ text: '   ' }), DIAGRAM)!.body).toBe('Abre la ejecución para responder');
  });

  it('[R61.8] el final avisa con el diagrama y si acabó bien, mal o sin presupuesto', () => {
    expect(noticeFor(finished('succeeded'), DIAGRAM)).toEqual({ title: 'Ejecución terminada', body: 'Web de la tienda', runId: 'r1', live: false });
    expect(noticeFor(finished('failed', 'algo /ruta/secreta'), DIAGRAM)).toEqual({ title: 'La ejecución ha fallado', body: 'Web de la tienda', runId: 'r1', live: false });
    expect(noticeFor(finished('failed', 'budget_exceeded'), DIAGRAM)!.title).toBe('Ejecución sin presupuesto');
  });

  it('[R62.14] un paso sin terminar y una ejecución incompleta avisan como tales', () => {
    expect(noticeFor(question({ kind: 'unfinished' }), DIAGRAM)!.title).toBe('Auditor no ha terminado lo pedido');
    expect(noticeFor(finished('failed', 'No cumple lo pedido: faltan los diagramas'), DIAGRAM)!.title).toBe('Ejecución incompleta');
  });

  it('[R61.8] cancelar y los pasos que terminan no avisan', () => {
    expect(noticeFor(finished('cancelled'), DIAGRAM)).toBeUndefined();
    expect(noticeFor(event({ type: 'node.finished', nodeId: 'a', status: 'succeeded' }), DIAGRAM)).toBeUndefined();
  });

  it.each([
    ['oculta', { visible: false, focused: true }],
    ['minimizada', { minimized: true, focused: true }],
    ['con otra app delante', { focused: false }],
  ])('[R61.10] avisa si la ventana está %s', (_name, state) => {
    const { bg, deps } = setup(fakeWindow(state));
    bg.onRunEvent(question(), DIAGRAM);
    expect(deps.notify).toHaveBeenCalledTimes(1);
  });

  it('[R61.10] con la app delante no avisa', () => {
    const { bg, deps } = setup(fakeWindow({ focused: true }));
    bg.onRunEvent(question(), DIAGRAM);
    bg.onRunEvent(finished('succeeded'), DIAGRAM);
    expect(deps.notify).not.toHaveBeenCalled();
  });

  it('[R61.11] pulsar el aviso abre la ventana en esa ejecución', () => {
    const { bg, deps, win, clicks } = setup(fakeWindow({ visible: false }));
    bg.onRunEvent(question(), DIAGRAM);
    bg.onRunEvent(finished('succeeded'), DIAGRAM);
    clicks[0]!();
    expect(win.show).toHaveBeenCalled();
    expect(deps.openRun).toHaveBeenLastCalledWith({ runId: 'r1', live: true });
    clicks[1]!();
    expect(deps.openRun).toHaveBeenLastCalledWith({ runId: 'r1', live: false });
  });
});

describe('si se cae la interfaz [R19.11]', () => {
  it('[R19.11] se recarga sola y lo anota, igual que si deja de responder', () => {
    const main = readFileSync(join(__dirname, '..', 'src', 'main', 'main.ts'), 'utf8');
    expect(main).toContain("win.webContents.on('render-process-gone'");
    expect(main).toContain('win.reload()');
    expect(main).toContain("win.on('unresponsive'");
    expect(main).toContain("'crash.log'");
  });
});

describe('identidad en Windows [R61.14]', () => {
  it('[R61.14] registra nombre e icono en el usuario actual, nunca en la máquina', () => {
    const [name, icon] = appIdRegistration('C:\\app\\icon.png');
    const key = `HKCU\\Software\\Classes\\AppUserModelId\\${APP_USER_MODEL_ID}`;
    expect(name).toEqual(['add', key, '/v', 'DisplayName', '/t', 'REG_EXPAND_SZ', '/d', 'Orquestador', '/f']);
    expect(icon).toEqual(['add', key, '/v', 'IconUri', '/t', 'REG_EXPAND_SZ', '/d', 'C:\\app\\icon.png', '/f']);
  });

  it('[R61.14] la app usa esa identidad y la registra solo en Windows', () => {
    const main = readFileSync(join(__dirname, '..', 'src', 'main', 'main.ts'), 'utf8');
    expect(main).toMatch(/process\.platform === 'win32'\) \{\n\s+app\.setAppUserModelId\(APP_USER_MODEL_ID\);\n\s+for \(const args of appIdRegistration\(ICON\)\) execFile\('reg', args/);
  });
});

describe('icono de la app [R61.13]', () => {
  it('[R61.13] la ventana usa el icono y la compilación lo copia junto al programa', () => {
    expect(windowOptions('/p.cjs', 'win32', '/x/icon.png')).toMatchObject({ icon: '/x/icon.png' });
    expect(windowOptions('/p.cjs', 'win32')).not.toHaveProperty('icon');
    const root = join(__dirname, '..', '..', '..');
    expect(existsSync(join(root, 'apps', 'desktop', 'assets', 'icon.png'))).toBe(true);
    expect(readFileSync(join(root, 'scripts', 'build-desktop.mjs'), 'utf8')).toContain("join(app, 'assets/icon.png'), join(out, 'icon.png')");
  });
});

describe('SPEC-070 · recordatorio de preguntas', () => {
  it('[R70.16] una pregunta sin respuesta da un aviso de recordatorio con el paso y la pregunta', () => {
    const reminder = { ...question(), type: 'question.reminder', minutes: 15 } as unknown as RunEvent;
    expect(noticeFor(reminder, DIAGRAM)).toEqual({ title: 'Auditor sigue esperando tu respuesta (15 min)', body: '¿Pixel art o vectorial?', runId: 'r1', live: true });
  });
});
