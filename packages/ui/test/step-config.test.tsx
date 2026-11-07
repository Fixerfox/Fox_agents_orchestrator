// @vitest-environment jsdom
import './setup';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { newAgent, type AgentDefinition } from '@orquestador/core';
import { EditorSession, createDiagram } from '@orquestador/editor';
import { App } from '../src/App';
import { DraftStore } from '../src/common';
import { StepConfigDialog } from '../src/diagrams/StepConfigDialog';
import { AgentQuickEditor } from '../src/knowledge';
import { createMemoryApi } from '../src/memoryApi';
import { stepTab } from './nav';

const agent = (id: string, name: string, patch: Partial<AgentDefinition> = {}): AgentDefinition => ({ ...newAgent(id, name), ...patch });
const AGENTS = [agent('pix', 'Pixelador', { description: 'Pinta', instructions: 'Usa píxel art' }), agent('rev', 'Revisor', { description: 'Revisa' })];

async function mount() {
  const api = createMemoryApi([createDiagram('principal', 'Principal')], { agents: AGENTS });
  render(<App initialProject="Juego" api={api} agents={[]} confirm={() => true} />);
  await userEvent.click(screen.getByRole('button', { name: /^Proyecto «/ }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Abrir proyecto' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Añadir «Pixelador» al diagrama' }));
  const node = (await screen.findByLabelText(/^Agente «pix»/)).closest('.react-flow__node') as HTMLElement;
  return { api, node };
}
const dialog = () => within(screen.getByRole('dialog', { name: /^Configurar «/ }));
const section = (name: RegExp) => within(dialog().getByRole('navigation', { name: 'Secciones del paso' })).getByRole('button', { name });
const taskOf = (api: ReturnType<typeof createMemoryApi>) => [...api.saved.values()].flatMap((d) => d.nodes).find((n) => n.agentId === 'pix')?.task;

describe('SPEC-064 · configurar un agente desde el diagrama', () => {
  it('[R64.1] el doble clic sobre un agente abre «Configurar» con el índice del paso y «Editar el agente»', async () => {
    const { node } = await mount();
    fireEvent.doubleClick(node);
    const d = dialog();
    expect(screen.getByRole('dialog', { name: 'Configurar «pix»' })).toBeTruthy();
    expect(d.getByRole('navigation', { name: 'Secciones del paso' })).toBeTruthy();
    expect(d.getByRole('button', { name: 'Editar el agente' })).toBeTruthy();
    await userEvent.click(section(/^Quién lo hace/));
    expect(d.getByRole('group', { name: 'Quién lo hace' })).toBeTruthy();
  });

  it('[R64.1] el doble clic sobre un nodo que no es agente no abre la ventana', async () => {
    await mount();
    await userEvent.click(screen.getByRole('button', { name: '+ Router' }));
    fireEvent.doubleClick((await screen.findByLabelText(/^Router «/)).closest('.react-flow__node')!);
    expect(screen.queryByRole('dialog', { name: /^Configurar «/ })).toBeNull();
  });

  it('[R64.2] el botón derecho empieza por «Configurar…» y el lateral tiene «Abrir en grande»', async () => {
    const { node } = await mount();
    fireEvent.contextMenu(node);
    const items = within(screen.getByRole('menu')).getAllByRole('menuitem');
    expect(items[0]!.textContent).toBe('Configurar…');
    await userEvent.click(items[0]!);
    expect(screen.getByRole('dialog', { name: 'Configurar «pix»' })).toBeTruthy();
    await userEvent.click(dialog().getByRole('button', { name: 'Cerrar' }));
    expect(screen.queryByRole('dialog', { name: /^Configurar «/ })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Abrir en grande' }));
    expect(screen.getByRole('dialog', { name: 'Configurar «pix»' })).toBeTruthy();
  });

  it('[R64.3] «Este paso» cambia nombre, tarea y modelo del paso, y se puede deshacer', async () => {
    const { api, node } = await mount();
    fireEvent.doubleClick(node);
    const d = dialog();
    const title = d.getByLabelText('Nombre');
    await userEvent.clear(title);
    await userEvent.type(title, 'Sprites{Enter}');
    expect(await screen.findByRole('dialog', { name: 'Configurar «Sprites»' })).toBeTruthy();
    await userEvent.type(d.getByLabelText('Qué tiene que hacer'), 'Pinta el héroe');
    await userEvent.click(section(/^Quién lo hace/));
    await userEvent.selectOptions(d.getByLabelText('Modelo'), 'claude-opus-5-5');
    await userEvent.click(d.getByRole('button', { name: 'Cerrar' }));
    // el lateral ve lo mismo
    expect((screen.getByLabelText('Qué tiene que hacer') as HTMLTextAreaElement).value).toBe('Pinta el héroe');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(taskOf(api)).toBe('Pinta el héroe'));
    await userEvent.click(screen.getByRole('button', { name: 'Deshacer' }));
    await stepTab('Agente');
    expect(((screen.getByLabelText('Modelo') as HTMLSelectElement).value)).toBe('');
  });

  it('[R64.4] «El agente» edita la ficha, avisa de que vale en todos los diagramas, guarda sin cerrar y no tiene «Eliminar»', async () => {
    const { api, node } = await mount();
    fireEvent.contextMenu(node);
    await userEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Configurar…' }));
    await userEvent.click(dialog().getByRole('button', { name: 'Editar el agente' }));
    const d = dialog();
    expect(d.getByText('Los cambios valen para todos los diagramas que usan a «Pixelador».')).toBeTruthy();
    expect(d.queryByRole('button', { name: 'Eliminar' })).toBeNull();
    const desc = await d.findByLabelText('Para qué sirve');
    await userEvent.clear(desc);
    await userEvent.type(desc, 'Pinta sprites');
    await userEvent.click(d.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(api.agents.get('pix')).toMatchObject({ description: 'Pinta sprites', instructions: 'Usa píxel art' }));
    expect(screen.getByRole('dialog', { name: /^Configurar «/ })).toBeTruthy();
    // la paleta y los pasos se actualizan
    await userEvent.click(dialog().getByRole('button', { name: 'Volver al paso' }));
    await userEvent.click(section(/^Quién lo hace/));
    await waitFor(() => expect(within(dialog().getByRole('group', { name: 'Quién lo hace' })).getByText('Pinta sprites')).toBeTruthy());
  });

  it('[R64.4] «Editar» del lateral abre la ventana en la ficha del agente y «Abrir en Agentes» lleva a la biblioteca', async () => {
    await mount();
    const side = await stepTab('Agente');
    await userEvent.click(side.getByRole('button', { name: 'Editar el agente' }));
    expect(dialog().getByRole('button', { name: 'Volver al paso' })).toBeTruthy();
    await userEvent.click(dialog().getByRole('button', { name: 'Abrir en Agentes' }));
    expect(screen.queryByRole('dialog', { name: /^Configurar «/ })).toBeNull();
    const lib = within(await screen.findByRole('region', { name: 'Agentes' }));
    await waitFor(() => expect((lib.getByLabelText('Nombre') as HTMLInputElement).value).toBe('Pixelador'));
  });

  it('[R64.4] el Coordinador se configura, pero sin «Editar el agente»', async () => {
    await mount();
    await userEvent.click(screen.getByRole('button', { name: '+ Coordinador' }));
    fireEvent.doubleClick((await screen.findByLabelText(/^Agente «Coordinador»/)).closest('.react-flow__node')!);
    expect(screen.getByRole('dialog', { name: 'Configurar «Coordinador»' })).toBeTruthy();
    expect(dialog().queryByRole('button', { name: 'Editar el agente' })).toBeNull();
    expect(dialog().getByLabelText('Qué tiene que hacer')).toBeTruthy();
  });

  it('[R64.5] Esc y pulsar fuera cierran; lo escrito en la tarea se aplica y el borrador del agente se conserva', async () => {
    const { node } = await mount();
    fireEvent.doubleClick(node);
    await userEvent.type(dialog().getByLabelText('Qué tiene que hacer'), 'Sin salir del campo');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: /^Configurar «/ })).toBeNull();
    expect((screen.getByLabelText('Qué tiene que hacer') as HTMLTextAreaElement).value).toBe('Sin salir del campo');
    fireEvent.doubleClick(node);
    await userEvent.click(dialog().getByRole('button', { name: 'Editar el agente' }));
    const desc = await dialog().findByLabelText('Para qué sirve');
    await userEvent.type(desc, ' y anima');
    fireEvent.pointerDown(document.querySelector('.orq-modal')!);
    expect(screen.queryByRole('dialog', { name: /^Configurar «/ })).toBeNull();
    fireEvent.doubleClick(node);
    await userEvent.click(dialog().getByRole('button', { name: 'Editar el agente' }));
    expect(((await dialog().findByLabelText('Para qué sirve')) as HTMLTextAreaElement).value).toBe('Pinta y anima');
    expect(dialog().getByText('Sin guardar')).toBeTruthy();
  });

  it('[R64.6] en solo lectura los campos del paso están desactivados y la ficha no guarda', async () => {
    const api = createMemoryApi([], { agents: AGENTS });
    const session = new EditorSession(createDiagram('d', 'D'));
    const id = session.addNode({ kind: 'agent', agentId: 'pix', position: { x: 0, y: 0 } });
    session.setReadOnly(true);
    const drafts = new DraftStore();
    const agents = AGENTS.map((a) => ({ id: a.id, name: a.name, editable: true }));
    const props = { api, session, snap: session.getSnapshot(), nodeId: id, agents, agentEditor: (p: Parameters<NonNullable<Parameters<typeof StepConfigDialog>[0]['agentEditor']>>[0]) => <AgentQuickEditor api={api} drafts={drafts} assistantReady={false} {...p} />, onClose: () => undefined, onError: () => undefined, onChangeAgent: () => undefined, onAgentSaved: () => undefined, openLibrary: () => undefined };
    const { unmount } = render(<StepConfigDialog {...props} />);
    expect((dialog().getByLabelText('Qué tiene que hacer') as HTMLTextAreaElement).matches(':disabled')).toBe(true);
    await userEvent.click(section(/^Quién lo hace/));
    expect((dialog().getByLabelText('Modelo') as HTMLSelectElement).matches(':disabled')).toBe(true);
    unmount();
    render(<StepConfigDialog {...props} initialTab="agent" />);
    await dialog().findByLabelText('Para qué sirve');
    expect((dialog().getByRole('button', { name: 'Guardar' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
