/** Puente del modo prueba entre el proceso principal y la interfaz [R82.7]–[R82.10]. Solo existe en modo prueba. */

/** El principal pide algo a la interfaz. */
export const TEST_CALL_CHANNEL = 'test:call';
/** La interfaz responde (canal de una sola dirección). */
export const TEST_REPLY_CHANNEL = 'test:reply';
/** La interfaz avisa de que está lista para recibir llamadas (al arrancar y tras recargar) [R82.16]. */
export const TEST_READY_CHANNEL = 'test:ready';
/** Argumento que el principal añade a la ventana en modo prueba, para que el preload exponga el puente. */
export const TEST_ARG = '--orq-test-mode';

export interface TestCall {
  id: string;
  /** Herramienta de interfaz (`ui_click`…) o acción de la app con el prefijo `app:` [R82.7]. */
  tool: string;
  args: Record<string, unknown>;
}

export interface TestReply {
  id: string;
  ok: boolean;
  result: unknown;
}

/** Lo que ve la interfaz del puente: `window.orquestadorTest`, solo en modo prueba. */
export interface TestBridgeApi {
  onCall(listener: (call: TestCall) => void): () => void;
  reply(reply: TestReply): void;
  ready(): void;
}

/** ¿Es una respuesta válida de la interfaz? El principal no se fía de lo que llega por IPC. */
export function parseTestReply(value: unknown): TestReply | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const v = value as Record<string, unknown>;
  if (typeof v['id'] !== 'string' || typeof v['ok'] !== 'boolean') return undefined;
  return { id: v['id'], ok: v['ok'], result: v['result'] };
}
