import { useEffect, useRef } from 'react';
import type { ProjectApi, TestBridgeApi, TestCall } from '@orquestador/editor';
import { runAssistantTool, type AssistantHost } from '../assistant';
import { click, press, snapshot, type as typeInto, waitFor } from './uiDriver';
import type { AppModel } from './useApp';

/** Lo que el puente necesita de la app, para poder probarlo sin montarla entera. */
export interface TestBridgeHost {
  api: ProjectApi;
  /** Sin proyecto abierto no hay host del asistente. */
  assistantHost: AssistantHost | undefined;
  state(): Record<string, unknown>;
  onOpened(name: string): void;
}

/** Ejecuta una llamada del modo prueba en la interfaz [R82.7]–[R82.10]. */
export async function runTestCall(host: TestBridgeHost, call: TestCall): Promise<unknown> {
  const a = call.args;
  const s = (k: string) => (typeof a[k] === 'string' ? (a[k] as string) : '');
  if (call.tool.startsWith('app:')) {
    // Las acciones de la app, sin «Permitir» [R82.7].
    if (!host.assistantHost) throw new Error('Abre un proyecto primero (open_project).');
    const out = await runAssistantTool(host.assistantHost, call.tool.slice(4), a);
    if (!out.ok) throw new Error(typeof out.result === 'string' ? out.result : out.summary || JSON.stringify(out.result));
    return out.result;
  }
  switch (call.tool) {
    case 'app_state':
      return host.state();
    case 'ui_snapshot':
      return snapshot();
    case 'ui_click':
      return click(s('name'), { ...(a['role'] ? { role: s('role') } : {}), ...(typeof a['index'] === 'number' ? { index: a['index'] } : {}) });
    case 'ui_type':
      return typeInto(s('label'), s('text'), a['submit'] === true);
    case 'ui_press':
      return press(s('key'));
    case 'ui_wait':
      return waitFor(s('text'), { gone: a['gone'] === true, ...(typeof a['timeoutMs'] === 'number' ? { timeoutMs: a['timeoutMs'] } : {}) });
    case 'open_project': {
      // El diálogo de carpeta lo responde el principal con la ruta [R82.10].
      const res = await (a['create'] === true ? host.api.createProject() : host.api.openProject());
      if (!res.ok) throw new Error(res.error.message);
      if (!res.value) throw new Error('No se abrió ningún proyecto.');
      host.onOpened(res.value.name);
      return { opened: res.value.name };
    }
    default:
      throw new Error(`Herramienta de interfaz desconocida: ${call.tool}`);
  }
}

/** Escucha las llamadas del modo prueba mientras la app está montada [R82.16]. */
export function TestBridge({ bridge, host }: { bridge: TestBridgeApi; host: TestBridgeHost }) {
  const ref = useRef(host);
  ref.current = host;
  useEffect(() => {
    const off = bridge.onCall((call) => {
      void runTestCall(ref.current, call).then(
        (result) => bridge.reply({ id: call.id, ok: true, result }),
        (e: unknown) => bridge.reply({ id: call.id, ok: false, result: e instanceof Error ? e.message : String(e) }),
      );
    });
    bridge.ready();
    return off;
  }, [bridge]);
  return null;
}

/** Lo que el modo prueba ve de la app [R82.9]. */
export function testHost(app: AppModel): TestBridgeHost {
  return {
    api: app.api,
    assistantHost: app.project === undefined ? undefined : app.assistantHost,
    onOpened: (name) => app.onOpened(name),
    state: () => ({
      screen: app.project === undefined ? 'start' : app.section,
      project: app.project ?? null,
      diagram: app.project === undefined ? null : { id: app.snap.diagram.id, name: app.snap.diagram.name, level: app.snap.path },
      assistantOpen: app.layout.assistOpen,
      runningDiagrams: app.runningIds,
    }),
  };
}

/** El puente, solo en modo prueba [R82.7]. */
export function AppTestBridge({ app, test }: { app: AppModel; test: TestBridgeApi | undefined }) {
  return test ? <TestBridge bridge={test} host={testHost(app)} /> : null;
}
