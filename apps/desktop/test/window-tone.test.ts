// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { watchWindowTone } from '../src/preload/api';

function fakeMedia(matches: boolean) {
  const listeners: (() => void)[] = [];
  return {
    matches,
    addEventListener: (_: string, l: () => void) => void listeners.push(l),
    removeEventListener: () => {},
    fire(m: boolean) {
      this.matches = m;
      for (const l of listeners) l();
    },
  };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('tono de la ventana [R19.8]', () => {
  it('[R19.8] sigue el tema elegido y, en automático, el del sistema; solo avisa al cambiar', async () => {
    const root = document.createElement('html');
    const media = fakeMedia(true);
    const sent: string[] = [];
    const stop = watchWindowTone(root, media as never, (t) => sent.push(t));
    expect(sent).toEqual(['dark']);
    root.setAttribute('data-theme', 'light');
    await tick();
    expect(sent).toEqual(['dark', 'light']);
    root.removeAttribute('data-theme');
    await tick();
    media.fire(false);
    media.fire(false);
    expect(sent).toEqual(['dark', 'light', 'dark', 'light']);
    stop();
  });
});
