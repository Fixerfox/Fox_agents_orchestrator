import { CHANNELS, TEST_CALL_CHANNEL, TEST_READY_CHANNEL, TEST_REPLY_CHANNEL, type AssistantEvent, type OpenRunTarget, type TerminalEvent, type InvokeMethod, type ProjectApi, type TestBridgeApi, type TestCall } from '@orquestador/editor';
import type { RunEvent } from '@orquestador/core';

/**
 * Construye la API tipada que se expone al renderer [R19.2].
 * `invoke` y `subscribe` son las únicas capacidades de IPC que recibe; el renderer no ve `ipcRenderer`.
 */
export function buildApi(
  invoke: (channel: string, payload?: unknown) => Promise<unknown>,
  subscribe: (listener: (runId: string, events: RunEvent[]) => void) => () => void = () => () => {},
  subscribeAssistant: (listener: (turnId: string, event: AssistantEvent) => void) => () => void = () => () => {},
  subscribeTerminal: (listener: (id: string, event: TerminalEvent) => void) => () => void = () => () => {},
  subscribeOpenRun: (listener: (target: OpenRunTarget) => void) => () => void = () => () => {},
): ProjectApi {
  const call =
    <K extends InvokeMethod>(method: K) =>
    (payload?: unknown) =>
      invoke(CHANNELS[method], payload);
  const api = {} as Record<string, unknown>;
  for (const method of Object.keys(CHANNELS) as InvokeMethod[]) api[method] = call(method);
  api.onRunEvents = subscribe;
  api.onAssistantEvents = subscribeAssistant;
  api.onTerminalEvents = subscribeTerminal;
  api.onOpenRun = subscribeOpenRun;
  return api as unknown as ProjectApi;
}

/** Puente del modo prueba: recibe llamadas y responde por canales fijos, sin `ipcRenderer` [R82.7]. */
export function buildTestBridge(send: (channel: string, payload?: unknown) => void, on: (channel: string, listener: (payload: unknown) => void) => () => void): TestBridgeApi {
  return {
    onCall: (listener) => on(TEST_CALL_CHANNEL, (payload) => listener(payload as TestCall)),
    reply: (reply) => send(TEST_REPLY_CHANNEL, reply),
    ready: () => send(TEST_READY_CHANNEL),
  };
}

/**
 * Avisa al proceso principal del tono de la app (claro u oscuro) para pintar los botones de ventana igual [R19.8].
 * Mira `data-theme` en la raíz y, en automático, el tema del sistema. Devuelve la función que deja de mirar.
 */
export function watchWindowTone(
  root: HTMLElement,
  media: Pick<MediaQueryList, 'matches' | 'addEventListener' | 'removeEventListener'>,
  send: (tone: 'light' | 'dark') => void,
): () => void {
  let last: string | undefined;
  const check = () => {
    const theme = root.getAttribute('data-theme');
    const tone = theme === 'dark' || (theme !== 'light' && media.matches) ? 'dark' : 'light';
    if (tone !== last) send(tone);
    last = tone;
  };
  const observer = new MutationObserver(check);
  observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  media.addEventListener('change', check);
  check();
  return () => {
    observer.disconnect();
    media.removeEventListener('change', check);
  };
}
