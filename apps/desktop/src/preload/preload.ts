import { contextBridge, ipcRenderer } from 'electron';
import { ASSISTANT_EVENTS_CHANNEL, OPEN_RUN_CHANNEL, RUN_EVENTS_CHANNEL, TERMINAL_EVENTS_CHANNEL, TEST_ARG, type OpenRunTarget } from '@orquestador/editor';
import { buildApi, buildTestBridge, watchWindowTone } from './api';

// Solo se expone la API tipada: nunca `ipcRenderer` ni módulos de Node [R19.2].
contextBridge.exposeInMainWorld(
  'orquestador',
  buildApi(
    (channel, payload) => ipcRenderer.invoke(channel, payload),
    (listener) => {
      const handler = (_e: unknown, msg: { runId: string; events: never[] }) => listener(msg.runId, msg.events);
      ipcRenderer.on(RUN_EVENTS_CHANNEL, handler);
      return () => void ipcRenderer.removeListener(RUN_EVENTS_CHANNEL, handler);
    },
    (listener) => {
      const handler = (_e: unknown, msg: { turnId: string; event: never }) => listener(msg.turnId, msg.event);
      ipcRenderer.on(ASSISTANT_EVENTS_CHANNEL, handler);
      return () => void ipcRenderer.removeListener(ASSISTANT_EVENTS_CHANNEL, handler);
    },
    (listener) => {
      const handler = (_e: unknown, msg: { id: string; event: never }) => listener(msg.id, msg.event);
      ipcRenderer.on(TERMINAL_EVENTS_CHANNEL, handler);
      return () => void ipcRenderer.removeListener(TERMINAL_EVENTS_CHANNEL, handler);
    },
    (listener) => {
      const handler = (_e: unknown, target: OpenRunTarget) => listener(target);
      ipcRenderer.on(OPEN_RUN_CHANNEL, handler);
      return () => void ipcRenderer.removeListener(OPEN_RUN_CHANNEL, handler);
    },
  ),
);

// El puente del modo prueba solo existe si el principal lo pide al crear la ventana [R82.7].
if (process.argv.includes(TEST_ARG))
  contextBridge.exposeInMainWorld(
    'orquestadorTest',
    buildTestBridge(
      (channel, payload) => ipcRenderer.send(channel, payload),
      (channel, listener) => {
        const handler = (_e: unknown, payload: unknown) => listener(payload);
        ipcRenderer.on(channel, handler);
        return () => void ipcRenderer.removeListener(channel, handler);
      },
    ),
  );

// Los botones de ventana siguen el tema de la app [R19.8]. Canal de una sola dirección; el principal valida el valor.
window.addEventListener('DOMContentLoaded', () => {
  watchWindowTone(document.documentElement, window.matchMedia('(prefers-color-scheme: dark)'), (tone) => ipcRenderer.send('window:tone', tone));
});
