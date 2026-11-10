// @vitest-environment jsdom
import './setup';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import type { RunEvent } from '@orquestador/core';
import { summarizeRun, supervisorAlerts } from '@orquestador/editor';
import { SupervisorPanel } from '../src/runs/SupervisorTab';

const SRC = join(__dirname, '..', 'src');
const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? files(join(dir, n)) : /\.tsx?$/.test(n) ? [join(dir, n)] : []));

/**
 * Un efecto cuyo cuerpo es una expresión devuelve lo que devuelva esa expresión; si no es `undefined`, React lo llama
 * al desmontar. Valen un bloque, una función de limpieza, `void …` o una suscripción (`x.onAlgo(…)`, que devuelve la
 * función para darse de baja).
 */
const RISKY = /use(?:Layout)?Effect\(\s*(?:async\s*)?\(\)\s*=>(?!\s*(?:\{|\(\)\s*=>|void\b|[\w.]+\.on[A-Z]\w*\())/g;

describe('SPEC-095 · los efectos no devuelven nada por accidente', () => {
  it('[R95.1][R95.2] ningún efecto de la interfaz tiene como cuerpo una expresión que pueda devolver un valor', () => {
    const found: string[] = [];
    for (const f of files(SRC)) {
      const text = readFileSync(f, 'utf8');
      for (const m of text.matchAll(RISKY)) found.push(`${relative(SRC, f)}:${text.slice(0, m.index).split('\n').length}`);
    }
    expect(found).toEqual([]);
  });

  it('[R95.2] la comprobación detecta los casos peligrosos y deja pasar los buenos', () => {
    const risky = (code: string) => [...code.matchAll(RISKY)].length > 0;
    expect(risky('useEffect(() => el.current?.scrollIntoView?.({ block: "nearest" }), [x]);')).toBe(true);
    expect(risky('useEffect(() => applyTheme(theme), [theme]);')).toBe(true);
    expect(risky('useLayoutEffect(() =>\n  measure(), []);')).toBe(true);
    expect(risky('useEffect(() => {\n  el.current?.focus();\n}, []);')).toBe(false);
    expect(risky('useEffect(() => () => client.dispose(), [client]);')).toBe(false);
    expect(risky('useEffect(() => void load(), [api]);')).toBe(false);
    expect(risky('useEffect(() => api.onOpenRun((r) => go(r)), [api]);')).toBe(false);
  });
});

describe('SPEC-095 · panel del Supervisor en Chromium', () => {
  const original = HTMLElement.prototype.scrollIntoView;
  afterEach(() => {
    HTMLElement.prototype.scrollIntoView = original;
  });

  it('[R95.3] con un scrollIntoView que devuelve una promesa, el panel se monta y se desmonta sin error', () => {
    // Como en Chromium reciente (Electron 45): scrollIntoView devuelve una promesa.
    HTMLElement.prototype.scrollIntoView = function () {
      return Promise.resolve();
    } as unknown as typeof HTMLElement.prototype.scrollIntoView;
    let seq = 0;
    const ev = (b: Record<string, unknown>) => ({ runId: 'r', seq: ++seq, ts: '2026-11-10T10:00:00.000Z', ...b }) as unknown as RunEvent;
    const events = [ev({ type: 'supervisor.started', review: true, model: 'claude-haiku-5-5' }), ev({ type: 'supervisor.alert', nodeId: 'a', rule: 'empty-output', severity: 'warning', detail: 'Sin salida' })];
    const alerts = supervisorAlerts(events, (id) => id);
    const view = render(<SupervisorPanel watch={summarizeRun(events, (id) => id).supervisor!} alerts={alerts} focus={alerts[0]!.key} onPick={() => undefined} />);
    expect(() => view.unmount()).not.toThrow();
  });
});
