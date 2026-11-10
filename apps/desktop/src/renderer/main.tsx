import '@xyflow/react/dist/style.css';
import '@fontsource-variable/geist/index.css';
import '@fontsource-variable/geist-mono/index.css';
import '@xterm/xterm/css/xterm.css';
import '../../../../packages/ui/src/styles.css';
import { createRoot } from 'react-dom/client';
import type { ProjectApi, TestBridgeApi } from '@orquestador/editor';
import { App } from '@orquestador/ui';

declare global {
  interface Window {
    orquestador: ProjectApi;
    /** Solo en modo prueba [R82.7]. */
    orquestadorTest?: TestBridgeApi;
  }
}

// Hasta M5 (registro de agentes) se ofrece una lista fija para poder montar diagramas.
const AGENTS = [
  { id: 'sprites', name: 'Sprites' },
  { id: 'gameplay', name: 'Gameplay' },
  { id: 'sonido', name: 'Sonido' },
  { id: 'creador', name: 'Creador' },
  { id: 'revisor', name: 'Revisor' },
];

createRoot(document.getElementById('root')!).render(<App api={window.orquestador} agents={AGENTS} {...(window.orquestadorTest ? { test: window.orquestadorTest } : {})} />);
