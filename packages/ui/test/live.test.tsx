// @vitest-environment jsdom
import './setup';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MockAgent, MockDecider, Orchestrator, type RunEvent } from '@orquestador/core';
import { EMPTY_LIVE, deriveLive, type LiveView } from '@orquestador/editor';
import { App } from '../src/App';
import { buildFlowEdges, buildFlowNodes } from '../src/diagrams/Canvas';
import { NodePanel } from '../src/runs/NodePanel';
import { ResultsPanel } from '../src/runs/ResultsPanel';
import { RunDialog } from '../src/runs/RunDialog';
import { Toolbar } from '../src/shell/Toolbar';
import { showConversation } from './nav';
import { createMemoryApi } from '../src/memoryApi';

const AGENTS = [{ id: 'creador', name: 'Creador' }, { id: 'revisor', name: 'Revisor' }];
const live = (over: Partial<LiveView>): LiveView => ({ ...EMPTY_LIVE, edges: new Set(), ...over });

/** Abre el modal de la ejecución con «Ver resumen» (las pestañas viven ahí) [R44.5]. */
async function openDetail() {
  await userEvent.click(await screen.findByRole('button', { name: 'Ver resumen' }, { timeout: 4000 }));
  return within(await screen.findByRole('dialog', { name: /^Resultado de «/ }));
}

describe('barra superior y diálogo Ejecutar [R15.3][R15.9][R18.13][R32.19]', () => {
  const bar = (l: LiveView, o: Partial<Parameters<typeof Toolbar>[0]> = {}) => {
    const onControl = vi.fn();
    const onRun = vi.fn();
    render(<Toolbar canUndo={false} canRedo={false} dirty={false} projectOpen onUndo={() => {}} onRedo={() => {}} onSave={() => {}} onNew={() => {}} onOpenProject={() => {}} onCreateProject={() => {}} live={l} onRun={onRun} onControl={onControl} {...o} />);
    return { onControl, onRun };
  };
  const dialog = (o: Partial<Parameters<typeof RunDialog>[0]> = {}) => {
    const onStart = vi.fn();
    const onEngine = vi.fn();
    render(<RunDialog diagramName="Flujo" engine="simulated" runnable onEngine={onEngine} onStart={onStart} onClose={() => {}} {...o} />);
    return { onStart, onEngine };
  };
  const btn = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;

  it('[R15.3][R32.19] ejecutar exige una entrada y un diagrama sin problemas, y envía entrada y presupuesto', async () => {
    const { onStart } = dialog();
    const d = within(screen.getByRole('dialog', { name: 'Ejecutar «Flujo»' }));
    expect((d.getByRole('button', { name: 'Ejecutar' }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.type(d.getByLabelText('Entrada'), 'haz un juego');
    await userEvent.type(d.getByLabelText('Presupuesto (tokens)'), '500');
    await userEvent.click(d.getByRole('button', { name: 'Ejecutar' }));
    expect(onStart).toHaveBeenCalledWith('haz un juego', 500);
  });

  it('[R15.3][R32.19] con problemas en el diagrama no se puede ejecutar y se explica', async () => {
    dialog({ runnable: false });
    await userEvent.type(screen.getByLabelText('Entrada'), 'x');
    expect(btn('Ejecutar').disabled).toBe(true);
    expect(screen.getByRole('alert').textContent).toMatch(/Corrige los problemas/);
  });

  it('[R32.19] el motor se elige en el diálogo y se recuerda la última entrada', async () => {
    const { onEngine } = dialog({ lastInput: 'otra vez' });
    expect((screen.getByLabelText('Entrada') as HTMLTextAreaElement).value).toBe('otra vez');
    await userEvent.click(screen.getByRole('radio', { name: /Claude/ }));
    expect(onEngine).toHaveBeenCalledWith('claude');
  });

  it('[R15.3][R52.2] pausar y cancelar mientras se ejecuta; «Lanzar…» sigue disponible para lanzar otra', async () => {
    const { onControl } = bar(live({ status: 'running' }));
    expect(btn('Lanzar…').disabled).toBe(false);
    await userEvent.click(btn('Pausar'));
    await userEvent.click(btn('Cancelar'));
    expect(onControl.mock.calls).toEqual([['pause'], ['cancel']]);
  });

  it('[R15.3] en pausa se ve «En pausa» y aparece Reanudar', async () => {
    const { onControl } = bar(live({ status: 'running', paused: true }));
    expect(screen.getByText('En pausa')).toBeTruthy();
    await userEvent.click(btn('Reanudar'));
    expect(onControl).toHaveBeenCalledWith('resume');
    expect(screen.queryByRole('button', { name: 'Pausar' })).toBeNull();
  });

  it('[R15.3][R52.8] sin ejecución no hay controles de ejecución y «Lanzar…» abre el diálogo', async () => {
    const { onRun } = bar(EMPTY_LIVE);
    expect(screen.queryByRole('button', { name: 'Pausar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancelar' })).toBeNull();
    await userEvent.click(btn('Lanzar…'));
    expect(onRun).toHaveBeenCalledTimes(1);
  });

  it('[R15.9][R32.20] muestra tokens y coste acumulados y lo que queda de presupuesto', () => {
    bar(live({ status: 'running', usage: { inputTokens: 300, outputTokens: 100, costUsd: 0.1234 } }), { maxTokens: 1000 });
    expect(screen.getByText(/400 tokens · 0,123 \$ · Quedan 600 tokens/)).toBeTruthy();
  });

  it('[R15.9] avisa cuando se agota el presupuesto', () => {
    bar(live({ status: 'failed', usage: { inputTokens: 90, outputTokens: 90, costUsd: 0 }, budgetReached: { limit: 'tokens', used: 180, max: 100 } }), { maxTokens: 100 });
    expect(screen.getByText(/Presupuesto agotado/)).toBeTruthy();
  });

  it('[R18.13][R32.18] cuenta las preguntas pendientes con un botón a la bandeja y muestra los errores', async () => {
    const onOpenRuns = vi.fn();
    bar(live({ status: 'running', pending: [{ questionId: 'q', nodeId: 'a', nodePath: [], text: '?' }, { questionId: 'r', nodeId: 'b', nodePath: [], text: '?' }] }), { runError: 'No existe esa ejecución en curso', onOpenRuns });
    await userEvent.click(screen.getByRole('button', { name: '2 preguntas' }));
    expect(onOpenRuns).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert').textContent).toBe('No existe esa ejecución en curso');
  });
});

describe('panel del nodo y chat [R15.2][R18.12]', () => {
  const ev = (seq: number, body: object, nodePath?: string[]): RunEvent => ({ runId: 'r', seq, ts: 't', ...(nodePath ? { nodePath } : {}), ...body }) as RunEvent;
  const events: RunEvent[] = [
    ev(1, { type: 'agent.request', nodeId: 'a', agentId: 'creador', attempt: 1, input: { text: 'haz un juego', files: [] } }),
    ev(2, { type: 'token.stream', nodeId: 'a', text: 'Pensando' }),
    ev(3, { type: 'token.stream', nodeId: 'a', text: '…' }),
    ev(4, { type: 'tool.called', nodeId: 'a', tool: 'Write', input: {} }),
    ev(5, { type: 'tool.result', nodeId: 'a', tool: 'Write', ok: true, output: 'guardado' }),
    ev(6, { type: 'agent.question', nodeId: 'a', questionId: 'q1', text: '¿Qué estilo?', options: ['Pixel', 'Vector'] }),
  ];
  const mount = (evs: RunEvent[], onAnswer = vi.fn()) => {
    render(<NodePanel events={evs} live={deriveLive(evs)} nodeId="a" nodePath={[]} label="Creador" onAnswer={onAnswer} />);
    return onAnswer;
  };

  it('[R15.2] muestra entrada, texto agrupado y herramientas con su resultado', () => {
    mount(events);
    expect(screen.getByRole('region', { name: 'Ejecución de «Creador»' })).toBeTruthy();
    expect(screen.getByText('haz un juego')).toBeTruthy();
    expect(screen.getByText('Pensando…')).toBeTruthy();
    expect(screen.getByText('Herramienta Write')).toBeTruthy();
    expect(screen.getByText('guardado')).toBeTruthy();
    expect(screen.getByText('esperando tu respuesta')).toBeTruthy();
  });

  it('[R18.12] las opciones de la pregunta son botones que responden', async () => {
    const onAnswer = mount(events);
    expect(screen.getByText('¿Qué estilo?')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Vector' }));
    expect(onAnswer).toHaveBeenCalledWith('q1', 'Vector');
  });

  it('[R18.12] también se puede responder con texto libre', async () => {
    const onAnswer = mount(events);
    const send = screen.getByRole('button', { name: 'Enviar respuesta' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    await userEvent.type(screen.getByLabelText('Tu respuesta'), 'Acuarela');
    await userEvent.click(send);
    expect(onAnswer).toHaveBeenCalledWith('q1', 'Acuarela');
  });

  it('[R18.12] una pregunta respondida muestra la respuesta y ya no pide nada', () => {
    mount([...events, ev(7, { type: 'agent.answer', nodeId: 'a', questionId: 'q1', text: 'Pixel' })]);
    expect(screen.getByText('Respondido: Pixel')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Enviar respuesta' })).toBeNull();
  });

  it('[R15.2] un nodo sin actividad lo indica', () => {
    render(<NodePanel events={events} live={deriveLive(events)} nodeId="z" nodePath={[]} label="Z" onAnswer={() => {}} />);
    expect(screen.getByText('Este nodo aún no ha hecho nada')).toBeTruthy();
  });
});

describe('resultados [R17.1][R17.2][R17.5]', () => {
  const finished = live({ status: 'succeeded', finalOutput: 'Todo listo', produced: [{ nodeId: 'a', path: 'src/juego.ts', nodePath: [] }] });

  it('[R17.5] muestra el texto final y quién produjo cada archivo', async () => {
    const api = createMemoryApi([], { outputs: { 'src/juego.ts': 'let x = 1;' } });
    render(<ResultsPanel api={api} runId="r" live={finished} labelOf={() => 'Programador'} />);
    expect(screen.getByText('Todo listo')).toBeTruthy();
    expect(screen.getByText('Producidos por «Programador»')).toBeTruthy();
    expect(screen.getAllByText('src/juego.ts').length).toBeGreaterThan(0);
  });

  it('[R17.1][R17.2] lista los archivos de output/ y previsualiza el texto', async () => {
    const api = createMemoryApi([], { outputs: { 'src/juego.ts': 'let x = 1;' } });
    render(<ResultsPanel api={api} runId="r" live={finished} labelOf={(id) => id} />);
    await userEvent.click(await screen.findByRole('button', { name: 'src/juego.ts' }));
    const region = await screen.findByRole('region', { name: 'Vista previa de src/juego.ts' });
    expect(within(region).getByText('let x = 1;')).toBeTruthy();
  });

  it('[R17.2] indica cuando solo se muestra el principio del archivo', async () => {
    const api = createMemoryApi([], { outputs: { 'a.txt': 'x' } });
    api.readOutput = async () => ({ ok: true, value: { text: 'inicio', truncated: true } });
    render(<ResultsPanel api={api} runId="r" live={finished} labelOf={(id) => id} />);
    await userEvent.click(await screen.findByRole('button', { name: 'a.txt' }));
    expect(await screen.findByText('Se muestra solo el principio del archivo')).toBeTruthy();
  });

  it('[R17.1] sin ejecución o con una en curso no hay archivos y se explica', () => {
    const api = createMemoryApi([]);
    const { rerender } = render(<ResultsPanel api={api} runId={undefined} live={EMPTY_LIVE} labelOf={(id) => id} />);
    expect(screen.getByText('La ejecución aún no tiene resultados')).toBeTruthy();
    rerender(<ResultsPanel api={api} runId="r" live={finished} labelOf={(id) => id} />);
    expect(screen.getByText('Sin archivos de salida')).toBeTruthy();
  });
});

describe('aplicación en vivo [R15.1][R15.5][R15.8][R18.12][R18.13]', () => {
  const rail = () => within(screen.getByRole('navigation', { name: 'Secciones' }));
  async function startExample(api: ReturnType<typeof createMemoryApi>, order = 'haz un juego', budget?: string) {
    render(<App initialProject="Proyecto" api={api} agents={AGENTS} confirm={() => true} />);
    await userEvent.click(screen.getByRole('button', { name: /^Proyecto «/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Abrir proyecto' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Bucle de revisión' }));
    await screen.findByLabelText(/^Bucle «Revisión»/);
    await userEvent.click(screen.getByRole('button', { name: 'Lanzar…' }));
    const d = within(await screen.findByRole('dialog', { name: /^Ejecutar «/ }));
    await userEvent.type(d.getByLabelText('Entrada'), order);
    if (budget) await userEvent.type(d.getByLabelText('Presupuesto (tokens)'), budget);
    await userEvent.click(d.getByRole('button', { name: 'Lanzar y ver la ejecución' }));
  }
  /** En la vista de la ejecución, pulsa el paso para verlo en el lateral: el Diseñador ya no la muestra [R35.9][R52.8]. */
  async function lastRunOf(label: RegExp) {
    fireEvent.click(await screen.findByLabelText(label));
  }

  it('[R15.1][R15.5][R32.19] los nodos pasan a correcto, la ruta se resalta y el bucle muestra su vuelta y veredicto', async () => {
    const api = createMemoryApi([]);
    await startExample(api);
    expect(screen.getByRole('region', { name: 'Ejecuciones' })).toBeTruthy();
    expect(await screen.findByLabelText(/^Agente «creador».*correcto/)).toBeTruthy();
    await waitFor(() => expect(screen.getAllByText('Terminada').length).toBeGreaterThan(0));
    expect(screen.getByText(/vuelta 1 de 5 · cumplido/)).toBeTruthy();
    // se guarda solo, con su propio id [R32.38]
    expect([...api.saved.values()].some((d) => d.name === 'Bucle de revisión')).toBe(true);
  });

  it('[R15.2][R15.9][R32.22] al elegir un nodo se ve su última ejecución y el uso acumulado', async () => {
    await startExample(createMemoryApi([]));
    await screen.findByLabelText(/^Agente «creador».*correcto/);
    await lastRunOf(/^Agente «creador»/);
    const panel = await screen.findByRole('region', { name: 'Ejecución de «creador»' });
    await showConversation(within(panel));
    expect(within(panel).getByText('haz un juego')).toBeTruthy();
    expect(within(panel).getAllByText('salida de creador').length).toBeGreaterThan(0);
    expect(screen.getByText(/tokens · .* \$/, { selector: '.orq-usage' })).toBeTruthy();
  });

  it('[R32.20][R35.8][R35.10][R35.11] al ejecutar se abre la ejecución: cronograma, mensajes del paso, resultado e historial', async () => {
    await startExample(createMemoryApi([]));
    await waitFor(() => expect(screen.getAllByText('Terminada').length).toBeGreaterThan(0));
    expect(screen.getByRole('heading', { name: 'Bucle de revisión' })).toBeTruthy();
    const detail = await openDetail();
    // terminada, se abre en «Resumen» [R38.23]
    if (detail.getByRole('tab', { name: 'Cronograma' }).getAttribute('aria-selected') !== 'true') await userEvent.click(detail.getByRole('tab', { name: 'Cronograma' }));
    await userEvent.click(await detail.findByRole('button', { name: /^creador: correcto/ }));
    const panel = await screen.findByRole('region', { name: 'Ejecución de «creador»' });
    expect(within(panel).getAllByText('salida de creador').length).toBeGreaterThan(0);
    // Pulsar el paso cerró el modal y lo abrió en el lateral; se vuelve a abrir para seguir [R44.2].
    const again = await openDetail();
    expect(again.queryByRole('button', { name: /^Entrada: correcto/ })).toBeNull();
    await userEvent.click(again.getByRole('tab', { name: 'Resultado' }));
    const final = within(await screen.findByRole('region', { name: 'Respuesta final' }));
    expect(final.getByText('salida de revisor')).toBeTruthy();
    expect(screen.getByText('Tokens')).toBeTruthy();
    await userEvent.click(again.getByRole('tab', { name: 'Historial' }));
    expect(screen.getByRole('region', { name: 'Registro de la ejecución' })).toBeTruthy();
    await userEvent.keyboard('{Escape}');
    // Terminada, la ejecución cuelga de «Historial» [R63.26].
    await userEvent.click(screen.getByRole('button', { name: 'Volver a Historial' }));
    const sub = within(screen.getByRole('navigation', { name: 'Apartados de Ejecuciones' }));
    await userEvent.click(sub.getByRole('button', { name: /^Historial/ }));
    expect(screen.getByRole('button', { name: /^Abrir Bucle de revisión · / })).toBeTruthy();
  });

  it('[R18.12][R18.13][R15.11] una pregunta resalta el nodo, se cuenta y se responde desde su panel', async () => {
    const agent = new MockAgent({
      creador: { output: 'listo', asks: [{ question: '¿Estilo?', options: ['Pixel', 'Vector'] }] },
      revisor: { output: 'revisado' },
    });
    const orchestrator = new Orchestrator({ getAdapter: () => agent, decider: new MockDecider() });
    await startExample(createMemoryApi([], { orchestrator }));
    await screen.findByLabelText(/^Agente «creador».*esperando tu respuesta/);
    expect(screen.getByRole('button', { name: '1 pregunta' })).toBeTruthy();
    await lastRunOf(/^Agente «creador»/);
    await userEvent.click(within(await screen.findByRole('region', { name: 'Ejecución de «creador»' })).getByRole('button', { name: 'Vector' }));
    await waitFor(() => expect(screen.getAllByText('Terminada').length).toBeGreaterThan(0));
    expect(screen.queryByRole('button', { name: /^\d+ preguntas?$/ })).toBeNull();
    expect(screen.getByText('Respondido: Vector')).toBeTruthy();
    expect(agent.callsOf('creador')[0]).toBeTruthy();
  });

  it('[R32.18][R35.6] las preguntas pendientes se reúnen en «Necesitan tu respuesta» y se responden allí', async () => {
    const agent = new MockAgent({
      creador: { output: 'listo', asks: [{ question: '¿Puedo modificar juego/datos.json?', options: ['Permitir', 'Denegar'] }] },
      revisor: { output: 'revisado' },
    });
    await startExample(createMemoryApi([], { orchestrator: new Orchestrator({ getAdapter: () => agent, decider: new MockDecider() }) }));
    await screen.findByLabelText(/^Agente «creador».*esperando tu respuesta/);
    const sub = within(screen.getByRole('navigation', { name: 'Apartados de Ejecuciones' }));
    await userEvent.click(sub.getByRole('button', { name: /^Necesitan tu respuesta/ }));
    const item = within(await screen.findByRole('article', { name: 'creador pregunta' }));
    expect(item.getByText('¿Puedo modificar juego/datos.json?')).toBeTruthy();
    expect(item.getByText('en Bucle de revisión')).toBeTruthy();
    expect(rail().getByRole('button', { name: 'Ejecuciones (1)' })).toBeTruthy();
    await userEvent.click(item.getByRole('button', { name: 'Permitir' }));
    await waitFor(() => expect(screen.queryByRole('article', { name: 'creador pregunta' })).toBeNull());
    expect(await screen.findByText('No hay preguntas pendientes.')).toBeTruthy();
    await waitFor(() => expect(screen.getAllByText('Terminada').length).toBeGreaterThan(0));
  });

  it('[R15.3] cancelar detiene la ejecución', async () => {
    let release!: () => void;
    const agent = new MockAgent({ creador: { output: 'x', waitFor: new Promise<void>((r) => (release = r)) }, revisor: { output: 'y' } });
    const api = createMemoryApi([], { orchestrator: new Orchestrator({ getAdapter: () => agent, decider: new MockDecider() }) });
    await startExample(api);
    await userEvent.click((await screen.findAllByRole('button', { name: 'Cancelar' }))[0]!);
    release();
    await waitFor(() => expect(screen.getAllByText('Cancelada').length).toBeGreaterThan(0));
  });

  it('[R15.9] el límite de tokens agota el presupuesto y se avisa', async () => {
    const agent = new MockAgent({ creador: { output: 'x', usage: { inputTokens: 80, outputTokens: 80 } }, revisor: { output: 'y' } });
    const api = createMemoryApi([], { orchestrator: new Orchestrator({ getAdapter: () => agent, decider: new MockDecider() }) });
    await startExample(api, 'x', '100');
    expect(await screen.findByText(/Presupuesto agotado/)).toBeTruthy();
    expect(screen.getAllByText('Fallida').length).toBeGreaterThan(0);
  });

  it('[R15.8] sin proyecto abierto no se puede arrancar: no hay botón Ejecutar', async () => {
    render(<App api={createMemoryApi([])} agents={AGENTS} confirm={() => true} />);
    expect(screen.queryByRole('button', { name: 'Lanzar…' })).toBeNull();
    expect(screen.queryByLabelText('Entrada')).toBeNull();
  });
});

describe('pintado del lienzo [R15.1][R15.5]', () => {
  const level = {
    id: 'd', name: 'D', schemaVersion: 1,
    nodes: [{ id: 'entry', kind: 'entry' as const }, { id: 'l', kind: 'loop' as const }, { id: 'output', kind: 'output' as const }],
    edges: [{ id: 'entry->l', from: 'entry', to: 'l' }, { id: 'l->output', from: 'l', to: 'output' }],
  };
  const l = live({
    status: 'running',
    nodeStatus: { entry: 'succeeded', l: 'running', 'bucle/w': 'running' },
    edges: new Set(['entry->l', 'bucle/x->y']),
    loops: { l: { n: 2, max: 5, verdict: 'continue' } },
  });

  it('[R15.1] las aristas recorridas se resaltan y las demás no', () => {
    const edges = buildFlowEdges(level, [], l);
    expect(edges.map((e) => e.className)).toEqual(['is-traversed is-active', undefined]);
    expect(edges[0]!.animated).toBe(true);
    expect(buildFlowEdges(level, [])[0]!.className).toBeUndefined();
  });

  it('[R15.1][R15.5] los nodos llevan su estado y la vuelta del bucle', () => {
    const nodes = buildFlowNodes(level, [], {}, l);
    expect(nodes.map((n) => n.data.runStatus)).toEqual(['succeeded', 'running', undefined]);
    expect(nodes[1]!.data.loop).toEqual({ n: 2, max: 5, verdict: 'continue' });
  });

  it('[R15.1] dentro de un bucle se usa la ruta completa para buscar el estado', () => {
    const inner = { ...level, nodes: [{ id: 'w', kind: 'agent' as const }], edges: [{ id: 'x->y', from: 'x', to: 'y' }] };
    expect(buildFlowNodes(inner, ['bucle'], {}, l)[0]!.data.runStatus).toBe('running');
    expect(buildFlowEdges(inner, ['bucle'], l)[0]!.className).toBe('is-traversed');
    expect(buildFlowNodes(inner, [], {}, l)[0]!.data.runStatus).toBeUndefined();
  });

  it('[R44.6] solo se anima la conexión al paso en marcha; al terminar, nada se anima y lo no recorrido se atenúa', () => {
    const chain = {
      ...level,
      nodes: [{ id: 'entry', kind: 'entry' as const }, { id: 'a', kind: 'agent' as const }, { id: 'b', kind: 'agent' as const }, { id: 'output', kind: 'output' as const }],
      edges: [{ id: 'e1', from: 'entry', to: 'a' }, { id: 'e2', from: 'a', to: 'b' }, { id: 'e3', from: 'b', to: 'output' }, { id: 'e4', from: 'a', to: 'output' }],
    };
    const during = buildFlowEdges(chain, [], live({ status: 'running', nodeStatus: { entry: 'succeeded', a: 'succeeded', b: 'running' }, edges: new Set(['e1', 'e2']) }));
    expect(during.map((e) => e.className)).toEqual(['is-traversed', 'is-traversed is-active', undefined, undefined]);
    expect(during.map((e) => e.animated === true)).toEqual([false, true, false, false]);
    const after = buildFlowEdges(chain, [], live({ status: 'succeeded', nodeStatus: { entry: 'succeeded', a: 'succeeded', b: 'succeeded', output: 'succeeded' }, edges: new Set(['e1', 'e2', 'e3']) }));
    expect(after.map((e) => e.className)).toEqual(['is-traversed', 'is-traversed', 'is-traversed', 'is-skipped']);
    expect(after.some((e) => e.animated)).toBe(false);
  });
});
