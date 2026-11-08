// @vitest-environment jsdom
import './setup';
import { describe, expect, it } from 'vitest';
import { useEffect, useState } from 'react';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { newAgent, type AgentDefinition } from '@orquestador/core';
import { EditorSession, createDiagram } from '@orquestador/editor';
import { DraftStore } from '../src/common';
import { Inspector } from '../src/diagrams/Inspector';
import type { StepTabId } from '../src/diagrams/StepFields';
import { StepConfigDialog } from '../src/diagrams/StepConfigDialog';
import { AgentQuickEditor } from '../src/knowledge';
import { createMemoryApi } from '../src/memoryApi';

const agent = (id: string, name: string, patch: Partial<AgentDefinition> = {}): AgentDefinition => ({ ...newAgent(id, name), ...patch });
const AGENTS = [agent('pix', 'Pixelador', { description: 'Pinta' })];
const OPTIONS = AGENTS.map((a) => ({ id: a.id, name: a.name, editable: true, skills: ['pixel'] }));

function setup(opts: { files?: boolean } = {}) {
  const api = createMemoryApi([], { agents: AGENTS });
  const session = new EditorSession(createDiagram('d', 'Básico'));
  const id = session.addNode({ kind: 'agent', agentId: 'pix', position: { x: 0, y: 0 } });
  const drafts = new DraftStore();
  let closed = 0;
  const files = opts.files ? { folder: 'FoxPixels', permissions: 'ask' as const, onPermissions: () => undefined } : undefined;
  function Live() {
    const [snap, setSnap] = useState(session.getSnapshot());
    useEffect(() => session.subscribe(() => setSnap(session.getSnapshot())), []);
    return (
      <StepConfigDialog
        api={api}
        session={session}
        snap={snap}
        nodeId={id}
        agents={OPTIONS}
        files={files}
        agentEditor={(p) => <AgentQuickEditor api={api} drafts={drafts} assistantReady={false} {...p} />}
        onClose={() => closed++}
        onError={() => undefined}
        onChangeAgent={() => undefined}
        onAgentSaved={() => undefined}
        openLibrary={() => undefined}
      />
    );
  }
  render(<Live />);
  return { session, id, closed: () => closed };
}
const dialog = () => within(screen.getByRole('dialog', { name: /^Configurar «/ }));
const nav = () => within(dialog().getByRole('navigation', { name: 'Secciones del paso' }));
const item = (name: RegExp) => nav().getByRole('button', { name });

describe('SPEC-066 · ventana «Configurar» con índice', () => {
  it('[R66.1] índice con resumen y una sección cada vez; «Archivos y permisos» solo con carpeta', async () => {
    setup();
    const names = [...document.querySelectorAll('.orq-stepcfg__item .orq-stepcfg__ititle')].map((b) => b.textContent);
    expect(names).toEqual(['Tarea', 'Quién lo hace', 'Conocimiento', 'Supervisión']);
    expect(item(/^Tarea/).getAttribute('aria-current')).toBe('page');
    expect(item(/^Tarea/).textContent).toContain('Sin tarea: sigue sus instrucciones');
    expect(item(/^Conocimiento/).textContent).toContain('1 del agente · 0 solo aquí');
    expect(dialog().getByLabelText('Qué tiene que hacer')).toBeTruthy();
    expect(dialog().queryByLabelText('Modelo')).toBeNull();
    await userEvent.click(item(/^Quién lo hace/));
    expect(item(/^Quién lo hace/).getAttribute('aria-current')).toBe('page');
    expect(dialog().getByLabelText('Modelo')).toBeTruthy();
    expect(dialog().queryByLabelText('Qué tiene que hacer')).toBeNull();
  });

  it('[R66.1] con carpeta de trabajo aparece «Archivos y permisos» con su resumen', () => {
    setup({ files: true });
    expect(item(/^Archivos y permisos/).textContent).toContain('Permisos: Preguntar');
  });

  it('[R66.2] lo que sobrescribe al agente lleva la marca y cuenta en la cabecera; los permisos avisan de que son del proyecto', async () => {
    setup({ files: true });
    expect(dialog().queryByText(/solo en este paso$/)).toBeNull();
    await userEvent.click(item(/^Quién lo hace/));
    await userEvent.selectOptions(dialog().getByLabelText('Modelo'), 'claude-opus-5-5');
    expect(item(/^Quién lo hace/).textContent).toContain('cambiado en este paso');
    expect(dialog().getByText('1 cambio solo en este paso')).toBeTruthy();
    await userEvent.click(item(/^Supervisión/));
    await userEvent.click(dialog().getByRole('checkbox', { name: 'Confirmar antes de terminar' }));
    expect(dialog().getByText('2 cambios solo en este paso')).toBeTruthy();
    expect(item(/^Tarea/).textContent).not.toContain('cambiado en este paso');
    await userEvent.click(item(/^Archivos y permisos/));
    expect(dialog().getByText('Los permisos valen para todo el proyecto, no solo para este paso.')).toBeTruthy();
    expect(item(/^Archivos y permisos/).textContent).not.toContain('cambiado en este paso');
  });

  it('[R66.3] «Editar el agente» abre la ficha dentro y «Volver al paso» regresa al índice', async () => {
    setup();
    await userEvent.click(item(/^Quién lo hace/));
    // un único sitio para editar el agente: no se repite en la tarjeta
    expect(dialog().getAllByRole('button', { name: 'Editar el agente' })).toHaveLength(1);
    await userEvent.click(dialog().getByRole('button', { name: 'Editar el agente' }));
    expect(await dialog().findByLabelText('Para qué sirve')).toBeTruthy();
    expect(dialog().queryByRole('navigation', { name: 'Secciones del paso' })).toBeNull();
    await userEvent.click(dialog().getByRole('button', { name: 'Volver al paso' }));
    expect(nav().getByRole('button', { name: /^Tarea/ })).toBeTruthy();
  });

  it('[R66.4] «Restablecer paso» quita lo sobrescrito de una vez, se puede deshacer, y «Listo» cierra', async () => {
    const { session, id, closed } = setup();
    const reset = () => dialog().getByRole('button', { name: 'Restablecer paso' }) as HTMLButtonElement;
    expect(reset().disabled).toBe(true);
    expect(dialog().getByText('Se guarda solo · solo afecta a este paso')).toBeTruthy();
    session.updateNode(id, { task: 'Pinta', model: 'claude-opus-5-5', confirm: true });
    expect((await dialog().findByText('2 cambios solo en este paso'))).toBeTruthy();
    await userEvent.click(reset());
    const node = () => session.getSnapshot().level.nodes.find((n) => n.id === id)!;
    expect(node()).toMatchObject({ task: 'Pinta' });
    expect(node().model).toBeUndefined();
    expect(node().confirm).toBeUndefined();
    expect(dialog().queryByText(/cambios? solo en este paso$/)).toBeNull();
    expect(reset().disabled).toBe(true);
    session.undo();
    expect(node()).toMatchObject({ model: 'claude-opus-5-5', confirm: true });
    await userEvent.click(dialog().getByRole('button', { name: 'Listo' }));
    expect(closed()).toBe(1);
  });
});

describe('SPEC-066 · lateral del paso', () => {
  function side(kind: 'agent' | 'router') {
    const session = new EditorSession(createDiagram('d', 'Básico'));
    const add = () => (kind === 'agent' ? session.addNode({ kind: 'agent', agentId: 'pix', position: { x: 0, y: 0 } }) : session.addNode({ kind: 'router', position: { x: 0, y: 0 } }));
    const id = add();
    const other = add();
    let select: (n: string) => void = () => undefined;
    function Live() {
      const [snap, setSnap] = useState(session.getSnapshot());
      const [sel, setSel] = useState(id);
      const [tab, setTab] = useState<StepTabId>('task');
      select = setSel;
      useEffect(() => session.subscribe(() => setSnap(session.getSnapshot())), []);
      return <Inspector session={session} snap={snap} selection={{ nodes: [sel], edges: [] }} agents={OPTIONS} onError={() => undefined} stepTab={tab} onStepTab={setTab} />;
    }
    const r = render(<Live />);
    return { session, id, other, select: (n: string) => act(() => select(n)), ...r };
  }
  const aside = () => within(screen.getByRole('complementary', { name: 'Propiedades' }));

  it('[R66.5] la cabecera dice qué es el elemento; en un agente, también de qué agente', () => {
    const a = side('agent');
    expect(document.querySelector('.orq-insp__kind')!.textContent).toBe('Agente· Pixelador');
    a.unmount();
    side('router');
    expect(document.querySelector('.orq-insp__kind')!.textContent).toBe('Router');
    expect(aside().getByLabelText('Nombre')).toBeTruthy();
  });

  it('[R66.6] el lateral tiene pestañas con una sección cada vez, marca de cambio, pestaña recordada y «Restablecer paso»', async () => {
    const { session, id, other, select } = side('agent');
    const tabs = aside().getAllByRole('tab');
    expect(tabs.map((x) => x.textContent)).toEqual(['Tarea', 'Agente', 'Conocimiento', 'Permisos']);
    expect(aside().getByRole('tab', { name: 'Tarea', selected: true })).toBeTruthy();
    expect(aside().getByLabelText('Qué tiene que hacer')).toBeTruthy();
    expect(aside().queryByLabelText('Modelo')).toBeNull();
    const reset = aside().getByRole('button', { name: 'Restablecer paso' }) as HTMLButtonElement;
    expect(reset.disabled).toBe(true);
    act(() => session.updateNode(id, { model: 'claude-opus-5-5', confirm: true }));
    expect(aside().getByRole('tab', { name: /^Agente/ }).textContent).toContain('cambiado en este paso');
    expect(aside().getByRole('tab', { name: /^Permisos/ }).textContent).toContain('cambiado en este paso');
    await userEvent.click(aside().getByRole('tab', { name: /^Permisos/ }));
    expect((aside().getByRole('checkbox', { name: 'Confirmar antes de terminar' }) as HTMLInputElement).checked).toBe(true);
    await userEvent.click(aside().getByRole('tab', { name: /^Agente/ }));
    expect(aside().getByLabelText('Modelo')).toBeTruthy();
    await userEvent.click(aside().getByRole('button', { name: 'Restablecer paso' }));
    expect(aside().getByRole('tab', { name: 'Agente' }).textContent).toBe('Agente');
    // otro paso: sigue en «Agente»
    select(other);
    expect(aside().getByRole('tab', { name: 'Agente', selected: true })).toBeTruthy();
    expect(aside().getByLabelText('Modelo')).toBeTruthy();
  });
});
