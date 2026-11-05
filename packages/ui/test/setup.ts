import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

class RO {
  private cb: (entries: unknown[], o: unknown) => void;
  constructor(cb: (entries: unknown[], o: unknown) => void = () => {}) {
    this.cb = cb;
  }
  /** Notifica una medida al observar, para que React Flow dibuje las conexiones. */
  observe(target: unknown) {
    this.cb([{ target }], this);
  }
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver = RO;
class DM {
  m22 = 1;
  constructor(_init?: string) {}
}
(globalThis as unknown as { DOMMatrixReadOnly: typeof DM }).DOMMatrixReadOnly = DM;
Object.defineProperties(HTMLElement.prototype, {
  offsetHeight: { get: () => 40 },
  offsetWidth: { get: () => 120 },
});
(SVGElement.prototype as unknown as { getBBox: () => unknown }).getBBox = () => ({ x: 0, y: 0, width: 0, height: 0 });

afterEach(() => {
  cleanup();
  try {
    localStorage.clear();
  } catch {
    /* sin almacenamiento */
  }
});
