import { contextBridge, ipcRenderer } from 'electron';
import { ASSISTANT_EVENTS_CHANNEL, RUN_EVENTS_CHANNEL, TERMINAL_EVENTS_CHANNEL } from '@orquestador/editor';
import { buildApi, watchWindowTone } from './api';

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
  ),
);

// Los botones de ventana siguen el tema de la app [R19.8]. Canal de una sola dirección; el principal valida el valor.
window.addEventListener('DOMContentLoaded', () => {
  watchWindowTone(document.documentElement, window.matchMedia('(prefers-color-scheme: dark)'), (tone) => ipcRenderer.send('window:tone', tone));
});
