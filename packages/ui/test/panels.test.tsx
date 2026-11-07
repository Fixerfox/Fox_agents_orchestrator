// @vitest-environment jsdom
import './setup';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EditorSession, createDiagram, exampleTemplates } from '@orquestador/editor';
import { AgentPicker } from '../src/diagrams/AgentPicker';
import { ContextMenu } from '../src/common/ContextMenu';
import { Breadcrumbs } from '../src/diagrams/Breadcrumbs';
import { Inspector } from '../src/diagrams/Inspector';
import { Palette } from '../src/diagrams/Palette';
import { ProblemsPanel } from '../src/diagrams/ProblemsPanel';
import { EditButtons, SaveStatus } from '../src/diagrams/DiagramMenu';
import { Toolbar } from '../src/shell/Toolbar';

const P = { x: 0, y: 0 };
const AGENTS = [
  { id: 'sprites', name: 'Sprites' },
  { id: 'sonido', name: 'Sonido' },
];

function mountInspector(session: EditorSession, selection: { nodes: string[]; edges: string[] }) {
  const onError = vi.fn();
  const view = (sel: typeof selection) => (
    <Inspector session={session} snap={session.getSnapshot()} selection={sel} agents={AGENTS} onError={onError} />
  );
  const r = render(view(selection));
  return { ...r, rerender: (sel = selection) => r.rerender(view(sel)), onError };
}

const palette = (o: Partial<React.ComponentProps<typeof Palette>> = {}) => {
  const props = {
    agents: AGENTS,
    examples: [],
    usage: [],
    onAdd: vi.fn(),
    onPickAgent: vi.fn(),
    onAddAgent: vi.fn(),
    onSelectUse: vi.fn(),
    onLoadExample: vi.fn(),
    ...o,
  };
  render(<Palette {...props} />);
  return props;
};

describe('paleta [R14.2]', () => {
  it('[R14.2][R21.14] «+ Agente» abre la galería; router y bucle se añaden directo', async () => {
    const p = palette();
    await userEvent.click(screen.getByRole('button', { name: '+ Agente' }));
    await userEvent.click(screen.getByRole('button', { name: '+ Router' }));
    await userEvent.click(screen.getByRole('button', { name: '+ Bucle' }));
    expect(p.onPickAgent).toHaveBeenCalledTimes(1);
    expect(vi.mocked(p.onAdd).mock.calls.map((c) => c[0])).toEqual([{ kind: 'router' }, { kind: 'loop' }]);
  });

  it('[R14.9] lista las plantillas de ejemplo y las carga', async () => {
    const ex = exampleTemplates();
    const p = palette({ examples: ex });
    await userEvent.click(screen.getByRole('button', { name: 'Bucle de revisión' }));
    expect(p.onLoadExample).toHaveBeenCalledWith(ex[1]);
  });

  it('[R21.15][R32.39] «En este diagrama» agrupa los agentes usados; el contador recorre sus usos', async () => {
    const usage = [
      { agentId: 'sprites', uses: [{ path: [], nodeId: 'agent1', label: 'Pintor' }, { path: ['loop1'], nodeId: 'agent2', label: 'Dentro' }] },
      { agentId: 'sonido', uses: [{ path: [], nodeId: 'agent3', label: 'Sonidos' }] },
    ];
    const p = palette({ usage, agents: [{ id: 'sprites', name: 'Sprites' }, { id: 'sonido', name: 'Sonido' }] });
    expect(screen.getByText('2 usos')).toBeTruthy();
    expect(screen.getByText('1 uso')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^En este diagrama/ }).getAttribute('aria-expanded')).toBe('true');
    const count = screen.getByRole('button', { name: 'Ir a un paso de «Sprites» (2 en el diagrama)' });
    await userEvent.click(count);
    expect(p.onSelectUse).toHaveBeenLastCalledWith(usage[0]!.uses[0]);
    await userEvent.click(count);
    expect(p.onSelectUse).toHaveBeenLastCalledWith(usage[0]!.uses[1]);
    await userEvent.click(count);
    expect(p.onSelectUse).toHaveBeenLastCalledWith(usage[0]!.uses[0]);
    await userEvent.click(screen.getByRole('button', { name: 'Añadir «Sonido» al diagrama' }));
    expect(p.onAddAgent).toHaveBeenCalledWith('sonido');
  });

  it('[R21.15][R21.19] un agente sin usos no muestra contador; «Tarea de agente» abre la galería', async () => {
    const p = palette({ agents: [{ id: 'sonido', name: 'Sonido' }] });
    expect(screen.queryByText(/usos?$/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: '+ Agente' }));
    expect(p.onPickAgent).toHaveBeenCalledTimes(1);
  });
});

describe('galería de agentes [R21.14]', () => {
  it('[R21.14] muestra una tarjeta por agente y al elegir una la devuelve', async () => {
    const onPick = vi.fn();
    render(<AgentPicker agents={[...AGENTS, { id: 'x', name: 'Extra', description: 'Hace cosas' }]} onPick={onPick} onClose={() => {}} />);
    expect(screen.getByRole('dialog', { name: 'Elige un agente' })).toBeTruthy();
    expect(screen.getByText('Hace cosas')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /Extra/ }));
    expect(onPick).toHaveBeenCalledWith('x');
  });

  it('[R21.14] Esc y el botón Cerrar la cierran', async () => {
    const onClose = vi.fn();
    render(<AgentPicker agents={AGENTS} onPick={() => {}} onClose={onClose} />);
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('[R21.14] sin agentes lo dice', () => {
    render(<AgentPicker agents={[]} onPick={() => {}} onClose={() => {}} />);
    expect(screen.getByText('No hay agentes disponibles')).toBeTruthy();
  });
});

describe('menú contextual [R21.12]', () => {
  const items = (fn = vi.fn()) => [
    { id: 'a', label: 'Uno', onSelect: fn },
    { id: 'b', label: 'Dos', disabled: true, onSelect: vi.fn() },
    { id: 'c', label: 'Tres', danger: true, onSelect: vi.fn() },
  ];
  it('[R21.12] enfoca el primer elemento, se mueve con flechas saltando los desactivados y Esc cierra', async () => {
    const onClose = vi.fn();
    render(<ContextMenu x={10} y={10} items={items()} onClose={onClose} />);
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Uno' }));
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Tres' }));
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Uno' }));
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });
  it('[R21.12] elegir una opción la ejecuta y cierra; un clic fuera cierra', async () => {
    const fn = vi.fn();
    const onClose = vi.fn();
    render(<ContextMenu x={10} y={10} items={items(fn)} onClose={onClose} />);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Uno' }));
    expect(fn).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
  it('[R21.12] las opciones desactivadas no se pueden pulsar', () => {
    render(<ContextMenu x={10} y={10} items={items()} onClose={() => {}} />);
    expect((screen.getByRole('menuitem', { name: 'Dos' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('problemas y ejecutar [R14.3]', () => {
  it('[R14.3] lista los problemas en español y los cuenta', () => {
    const s = new EditorSession(createDiagram('d', 'D'));
    s.addNode({ kind: 'agent', agentId: 'a', position: P });
    render(<ProblemsPanel problems={s.getSnapshot().problems} />);
    expect(screen.getByText(/no está conectado desde la entrada/)).toBeTruthy();
    expect(screen.getByText('1 problemas')).toBeTruthy();
  });

  it('[R14.3] sin problemas lo dice', () => {
    const s = new EditorSession(createDiagram('d', 'D'));
    render(<ProblemsPanel problems={s.getSnapshot().problems} />);
    expect(screen.getByText('Sin problemas')).toBeTruthy();
  });

  const bar = () => (
    <Toolbar canUndo canRedo={false} dirty projectOpen onUndo={() => {}} onRedo={() => {}} onSave={() => {}} onNew={() => {}} onOpenProject={() => {}} onCreateProject={() => {}} />
  );

  it('[R14.5] el indicador muestra cambios sin guardar', () => {
    // Va en la cabecera del Diseñador, no en la barra superior [R32.38].
    const { unmount } = render(bar());
    expect(screen.queryByText('Cambios sin guardar')).toBeNull();
    unmount();
    render(<SaveStatus dirty />);
    expect(screen.getByText('Cambios sin guardar')).toBeTruthy();
  });

  it('[R32.38] Nuevo, Deshacer, Rehacer y Guardar van en la cabecera del Diseñador, no en la barra superior', () => {
    const { unmount } = render(<Toolbar editInHeader canUndo canRedo={false} dirty projectOpen onUndo={() => {}} onRedo={() => {}} onSave={() => {}} onNew={() => {}} onOpenProject={() => {}} onCreateProject={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Deshacer' })).toBeNull();
    unmount();
    render(<EditButtons canUndo canRedo={false} projectOpen onUndo={() => {}} onRedo={() => {}} onSave={() => {}} onNew={() => {}} />);
    const group = within(screen.getByRole('group', { name: 'Editar el diagrama' }));
    expect(group.getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Nuevo', 'Deshacer', 'Rehacer', 'Guardar']);
  });
});

describe('migas de pan [R14.8]', () => {
  it('[R14.8] navega por la ruta y marca la actual', async () => {
    const onGo = vi.fn();
    const onUp = vi.fn();
    render(<Breadcrumbs crumbs={[{ path: [], label: 'Raíz' }, { path: ['l'], label: 'Bucle' }]} onGo={onGo} onUp={onUp} />);
    expect(screen.getByText('Bucle').getAttribute('aria-current')).toBe('page');
    await userEvent.click(screen.getByRole('button', { name: 'Raíz' }));
    expect(onGo).toHaveBeenCalledWith([]);
    await userEvent.click(screen.getByRole('button', { name: 'Subir un nivel' }));
    expect(onUp).toHaveBeenCalled();
  });

  it('[R14.8] en la raíz no se puede subir', () => {
    render(<Breadcrumbs crumbs={[{ path: [], label: 'Raíz' }]} onGo={() => {}} onUp={() => {}} />);
    expect((screen.getByRole('button', { name: 'Subir un nivel' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('inspector [R14.12]', () => {
  it('[R14.12] renombra un nodo al salir del campo, en un solo paso de historial', async () => {
    const s = new EditorSession(createDiagram('d', 'D'));
    const id = s.addNode({ kind: 'agent', agentId: 'sprites', label: 'Viejo', position: P });
    mountInspector(s, { nodes: [id], edges: [] });
    const input = screen.getByLabelText('Nombre');
    await userEvent.clear(input);
    await userEvent.type(input, 'Nuevo');
    expect(s.getSnapshot().level.nodes.find((n) => n.id === id)!.label).toBe('Viejo');
    await userEvent.tab();
    expect(s.getSnapshot().level.nodes.find((n) => n.id === id)!.label).toBe('Nuevo');
    s.undo();
    expect(s.getSnapshot().level.nodes.find((n) => n.id === id)!.label).toBe('Viejo');
  });

  it('[R14.12] cambia el agente asignado', async () => {
    const s = new EditorSession(createDiagram('d', 'D'));
    const id = s.addNode({ kind: 'agent', agentId: 'sprites', position: P });
    const onChangeAgent = vi.fn();
    render(<Inspector session={s} snap={s.getSnapshot()} selection={{ nodes: [id], edges: [] }} agents={AGENTS} onError={vi.fn()} onChangeAgent={onChangeAgent} />);
    await userEvent.click(screen.getByRole('tab', { name: 'Agente' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cambiar el agente' }));
    expect(onChangeAgent).toHaveBeenCalledWith(id);
  });

  it('[R14.7] elige el modo del router y edita la condición solo en aristas de router', async () => {
    const s = new EditorSession(createDiagram('d', 'D'));
    const r = s.addNode({ kind: 'router', position: P });
    const a = s.addNode({ kind: 'agent', agentId: 'sprites', position: P });
    s.connect(r, a);
    s.connect('entry', r);
    const m = mountInspector(s, { nodes: [r], edges: [] });
    await userEvent.selectOptions(screen.getByLabelText('Modo de enrutado'), 'rules');
    expect(s.getSnapshot().level.nodes.find((n) => n.id === r)!.router!.mode).toBe('rules');
    m.rerender({ nodes: [], edges: [`${r}->${a}`] });
    const cond = screen.getByLabelText('Condición');
    await userEvent.type(cond, 'dibujar');
    await userEvent.tab();
    expect(s.getSnapshot().level.edges.find((e) => e.id === `${r}->${a}`)!.condition).toBe('dibujar');
    m.rerender({ nodes: [], edges: ['entry->' + r] });
    expect(screen.queryByLabelText('Condición')).toBeNull();
    expect(screen.getByText(/Solo las conexiones que salen de un router/)).toBeTruthy();
  });

  it('[R21.13] el botón «Eliminar conexión» quita la conexión seleccionada', async () => {
    const s = new EditorSession(createDiagram('d', 'D'));
    const a = s.addNode({ kind: 'agent', agentId: 'sprites', position: P });
    s.connect('entry', a);
    mountInspector(s, { nodes: [], edges: [`entry->${a}`] });
    await userEvent.click(screen.getByRole('button', { name: 'Eliminar conexión' }));
    expect(s.getSnapshot().level.edges.some((e) => e.id === `entry->${a}`)).toBe(false);
  });

  it('[R21.13] el botón «Eliminar nodo» quita el nodo y no existe para la entrada', async () => {
    const s = new EditorSession(createDiagram('d', 'D'));
    const a = s.addNode({ kind: 'agent', agentId: 'sprites', position: P });
    const m = mountInspector(s, { nodes: [a], edges: [] });
    await userEvent.click(screen.getByRole('button', { name: 'Eliminar nodo' }));
    expect(s.getSnapshot().level.nodes.some((n) => n.id === a)).toBe(false);
    m.rerender({ nodes: ['entry'], edges: [] });
    expect(screen.queryByRole('button', { name: 'Eliminar nodo' })).toBeNull();
  });

  it('[R14.8] edita el bucle: modo, vueltas, prompt y máximo', async () => {
    const s = new EditorSession(createDiagram('d', 'D'));
    const l = s.addNode({ kind: 'loop', position: P });
    const get = () => s.getSnapshot().level.nodes.find((n) => n.id === l)!.loop!;
    const m = mountInspector(s, { nodes: [l], edges: [] });
    const times = screen.getByLabelText('Vueltas');
    await userEvent.clear(times);
    await userEvent.type(times, '4');
    await userEvent.tab();
    expect(get().count).toBe(4);
    const max = screen.getByLabelText('Máximo de iteraciones');
    await userEvent.clear(max);
    await userEvent.type(max, '9');
    await userEvent.tab();
    expect(get().maxIterations).toBe(9);
    await userEvent.selectOptions(screen.getByLabelText('Modo del bucle'), 'ai-judge');
    m.rerender();
    const prompt = screen.getByLabelText('Condición para terminar');
    await userEvent.type(prompt, '¿Listo?');
    await userEvent.tab();
    expect(get()).toMatchObject({ mode: 'ai-judge', prompt: '¿Listo?', maxIterations: 9 });
  });

  it('[R14.12] sin selección muestra la ayuda y con varios nodos no edita', () => {
    const s = new EditorSession(createDiagram('d', 'D'));
    const m = mountInspector(s, { nodes: [], edges: [] });
    expect(screen.getByText('Selecciona un nodo o una conexión')).toBeTruthy();
    m.rerender({ nodes: ['entry', 'output'], edges: [] });
    expect(screen.queryByLabelText('Nombre')).toBeNull();
  });

  it('[R14.12] un error del editor se comunica sin romper la interfaz', () => {
    const s = new EditorSession(createDiagram('d', 'D'));
    const m = mountInspector(s, { nodes: ['entry'], edges: [] });
    expect(m.onError).not.toHaveBeenCalled();
    fireEvent.blur(screen.getByLabelText('Nombre'));
    expect(s.getSnapshot().canUndo).toBe(false);
  });
});

describe('panel derecho en ventanas estrechas [R21.16]', () => {
  const withMedia = (matches: boolean) => {
    const listeners = new Set<(e: { matches: boolean }) => void>();
    (window as unknown as { matchMedia: unknown }).matchMedia = () => ({
      matches,
      addEventListener: (_: string, l: (e: { matches: boolean }) => void) => listeners.add(l),
      removeEventListener: (_: string, l: (e: { matches: boolean }) => void) => listeners.delete(l),
    });
    return listeners;
  };
  const mountApp = async () => {
    const [{ App }, { createMemoryApi }] = await Promise.all([import('../src/App'), import('../src/memoryApi')]);
    render(<App initialProject="Proyecto" api={createMemoryApi()} confirm={() => true} />);
  };

  it('[R21.16] con ventana estrecha el panel derecho empieza cerrado y se abre con su botón', async () => {
    withMedia(true);
    await mountApp();
    expect(screen.queryByRole('complementary', { name: 'Propiedades' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /derecho/i }));
    expect(await screen.findByRole('complementary', { name: 'Propiedades' })).toBeTruthy();
  });

  it('[R21.16] con ventana ancha empieza abierto y al estrecharse se cierra solo', async () => {
    const listeners = withMedia(false);
    await mountApp();
    // Sin nada seleccionado el panel no se ve [R33.6]; con algo seleccionado, sí.
    await userEvent.click(screen.getByRole('button', { name: 'Ajustes del diagrama' }));
    expect(screen.getByRole('complementary', { name: 'Propiedades' })).toBeTruthy();
    listeners.forEach((l) => l({ matches: true }));
    await vi.waitFor(() => expect(screen.queryByRole('complementary', { name: 'Propiedades' })).toBeNull());
  });
});
