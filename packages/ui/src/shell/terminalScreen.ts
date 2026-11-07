import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';

/** Lo que el panel necesita de una pantalla de terminal (xterm.js en la app; falsa en los tests) [R30.13]. */
export interface TerminalScreen {
  write(data: string): void;
  onInput(cb: (data: string) => void): void;
  /** Ajusta al tamaño del contenedor y devuelve columnas y filas. */
  fit(): { cols: number; rows: number };
  focus(): void;
  dispose(): void;
}

/** Pantalla de terminal con xterm.js; siempre oscura, como espera Claude Code. */
export function createTerminalScreen(el: HTMLElement): TerminalScreen {
  const term = new Terminal({
    fontFamily: '"Geist Mono Variable", ui-monospace, Consolas, monospace',
    fontSize: 13,
    cursorBlink: true,
    convertEol: false,
    scrollback: 5000,
    theme: { background: '#07080d', foreground: '#eef0f5', cursor: '#f2a93b', selectionBackground: '#f2a93b55' },
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(el);
  return {
    write: (d) => term.write(d),
    onInput: (cb) => void term.onData(cb),
    fit: () => {
      try {
        fit.fit();
      } catch {
        // contenedor oculto: se queda con el tamaño anterior
      }
      return { cols: Math.max(2, term.cols), rows: Math.max(2, term.rows) };
    },
    focus: () => term.focus(),
    dispose: () => term.dispose(),
  };
}
