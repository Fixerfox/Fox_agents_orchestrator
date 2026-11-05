// @vitest-environment jsdom
import './setup';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MockAgent, MockDecider, Orchestrator, newAgent } from '@orquestador/core';
import { EditorSession, createDiagram } from '@orquestador/editor';
import { App } from '../src/App';
import { createMemoryApi } from '../src/memoryApi';
import { goLib } from './nav';

/** Orquestador simulado en el que «pix» pregunta y la ejecución se queda esperando. */
function waitingOrchestrator() {
  const agent = { output: 'hecho', tokens: ['hecho'], usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 }, latencyMs: 1 };
  const mock = new MockAgent({ pix: { ...agent, asks: [{ question: '¿Qué estilo?' }] } });
  return new Orchestrator({ getAdapter: () => mock, decider: new MockDecider() });
}

async function startWaitingRun() {
  const api = createMemoryApi([createDiagram('principal', 'Principal')], { orchestrator: waitingOrchestrator(), agents: [{ ...newAgent('pix', 'Pixelador'), description: 'Pinta' }] });
  render(<App initialProject="Juego" api={api} agents={[]} confirm={() => true} />);
  await userEvent.click(screen.getByRole('button', { name: /^Proyecto «/ }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Abrir proyecto' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Insertar un paso entre «Entrada» y «Salida»' }));
  await userEvent.click(within(screen.getByRole('dialog', { name: 'Insertar paso' })).getByRole('button', { name: /Pixelador/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Lanzar…' }));
  const d = within(await screen.findByRole('dialog', { name: /^Ejecutar «/ }));
  await userEvent.type(d.getByLabelText('Entrada'), 'un dragón');
  await userEvent.click(d.getByRole('button', { name: 'Lanzar y ver la ejecución' }));
  await screen.findByRole('button', { name: '1 pregunta' });
  await userEvent.click(within(screen.getByRole('navigation', { name: 'Secciones' })).getByRole('button', { name: 'Diseñador' }));
  return api;
}

describe('SPEC-032/051 · sin cerrojo de ejecución [R32.37][R52.2][R52.8]', () => {
  it('[R32.37] la sesión admite un modo de solo lectura que bloquea cambios, deshacer y cargar otro diagrama', () => {
    const s = new EditorSession(createDiagram('d', 'D'));
    const router = s.addNode({ kind: 'router', position: { x: 0, y: 0 } });
    s.setReadOnly(true);
    expect(s.getSnapshot().readOnly).toBe(true);
    expect(s.getSnapshot().canUndo).toBe(false);
    expect(() => s.addNode({ kind: 'loop', position: { x: 0, y: 0 } })).toThrow(/Se está ejecutando/);
    expect(() => s.removeSelection({ nodes: [router] })).toThrow();
    expect(s.undo()).toBe(false);
    expect(() => s.load(createDiagram('otro', 'Otro'))).toThrow();
    s.setReadOnly(false);
    expect(s.undo()).toBe(true);
  });

  it('[R32.37][R52.8] con una ejecución esperando, el Diseñador sigue editable y no muestra su estado', async () => {
    await startWaitingRun();
    expect(screen.queryByText('Ejecutándose: solo lectura hasta que termine')).toBeNull();
    expect(screen.getAllByRole('button', { name: /^Insertar un paso entre/ }).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: '+ Router' }).matches(':disabled')).toBe(false);
    expect((screen.getByRole('button', { name: 'Nuevo' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: /^Diagrama «/ }) as HTMLButtonElement).disabled).toBe(false);
    // el lienzo no pinta la ejecución: el paso no está «esperando tu respuesta»
    expect(screen.getByLabelText(/^Agente «pix»/).getAttribute('aria-label')).not.toMatch(/esperando/);
    // la barra no tiene pausar/cancelar, pero sí «1 en marcha» y la pregunta pendiente
    expect(screen.queryByRole('button', { name: 'Pausar' })).toBeNull();
    expect(screen.getByRole('button', { name: '1 en marcha' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '1 pregunta' })).toBeTruthy();
    // el menú del nodo y el panel del paso permiten cambiarlo
    fireEvent.contextMenu(screen.getByLabelText(/^Agente «pix»/));
    expect(within(screen.getByRole('menu')).getAllByRole('menuitem').length).toBeGreaterThan(1);
    await userEvent.keyboard('{Escape}');
    fireEvent.click(screen.getByLabelText(/^Agente «pix»/));
    const task = (await screen.findByLabelText('Qué tiene que hacer')) as HTMLTextAreaElement;
    expect(task.matches(':disabled')).toBe(false);
    await userEvent.type(task, 'Dibuja en 32×32');
    expect(task.value).toBe('Dibuja en 32×32');
    // «1 en marcha» lleva a En directo
    await userEvent.click(screen.getByRole('button', { name: '1 en marcha' }));
    expect(await screen.findByRole('heading', { name: 'En directo' })).toBeTruthy();
  });

  it('[R32.37][R52.2] en la biblioteca, el agente que se está ejecutando se puede editar y eliminar', async () => {
    await startWaitingRun();
    const s = await goLib('agents');
    await userEvent.click(s.getByRole('button', { name: 'Pixelador' }));
    expect(s.queryByText(/Lo usa la ejecución en curso/)).toBeNull();
    expect((s.getByRole('button', { name: 'Eliminar' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('[R52.7][R52.9] lanzar otra del mismo diagrama «En cola»: aparece en En directo › En cola y arranca al terminar la anterior', async () => {
    const api = await startWaitingRun();
    await userEvent.click(screen.getByRole('button', { name: 'Lanzar…' }));
    const d = within(await screen.findByRole('dialog', { name: /^Ejecutar «/ }));
    const busy = within(d.getByRole('group', { name: 'Ya hay 1 ejecución de este diagrama en marcha.' }));
    expect((busy.getByRole('radio', { name: /^A la vez, en la misma carpeta/ }) as HTMLInputElement).checked).toBe(true);
    await userEvent.click(busy.getByRole('radio', { name: /^En cola/ }));
    // trae la última entrada usada con este diagrama [R52.7]
    expect((d.getByLabelText('Entrada') as HTMLTextAreaElement).value).toBe('un dragón');
    await userEvent.clear(d.getByLabelText('Entrada'));
    await userEvent.type(d.getByLabelText('Entrada'), 'otro dragón');
    await userEvent.click(d.getByRole('button', { name: 'Lanzar y ver la ejecución' }));
    const queue = within(await screen.findByRole('region', { name: 'En cola' }));
    expect(queue.getByText('otro dragón')).toBeTruthy();
    expect((await api.listQueue()).ok).toBe(true);
    // responder la pregunta de la primera la termina y la de la cola arranca
    const sub = within(screen.getByRole('navigation', { name: 'Apartados de Ejecuciones' }));
    await userEvent.click(sub.getByRole('button', { name: /^Necesitan tu respuesta/ }));
    const item = within(await screen.findByRole('article', { name: /pregunta$/ }));
    await userEvent.type(item.getByRole('textbox'), 'pixel{Enter}');
    await waitFor(async () => {
      const q = await api.listQueue();
      expect(q.ok && q.value).toEqual([]);
    });
    await waitFor(async () => {
      const runs = await api.listRuns();
      expect(runs.ok && runs.value.map((r) => r.order)).toEqual(expect.arrayContaining(['un dragón', 'otro dragón']));
    });
  });

  it('[R52.9] «Quitar de la cola» la quita', async () => {
    await startWaitingRun();
    await userEvent.click(screen.getByRole('button', { name: 'Lanzar…' }));
    const d = within(await screen.findByRole('dialog', { name: /^Ejecutar «/ }));
    await userEvent.click(d.getByRole('radio', { name: /^En cola/ }));
    await userEvent.type(d.getByLabelText('Entrada'), 'otro');
    await userEvent.click(d.getByRole('button', { name: 'Lanzar y ver la ejecución' }));
    const queue = within(await screen.findByRole('region', { name: 'En cola' }));
    await userEvent.click(queue.getByRole('button', { name: 'Quitar «Principal» de la cola' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'En cola' })).toBeNull());
  });
});
