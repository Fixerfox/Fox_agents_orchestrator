// @vitest-environment jsdom
import './setup';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MockAgent, MockDecider, Orchestrator, type Diagram, type RunEvent } from '@orquestador/core';
import { agentsIn, eventTypesIn, eventsToJsonl, filterEvents } from '@orquestador/editor';
import { LogViewer } from '../src/runs/LogViewer';

const d: Diagram = {
  id: 'd', name: 'D', schemaVersion: 1,
  nodes: [{ id: 'entry', kind: 'entry' }, { id: 'a', kind: 'agent', agentId: 'pintor' }, { id: 'b', kind: 'agent', agentId: 'sonidista' }, { id: 'output', kind: 'output' }],
  edges: [{ id: 'e1', from: 'entry', to: 'a' }, { id: 'e2', from: 'a', to: 'b' }, { id: 'e3', from: 'b', to: 'output' }],
};

async function events(): Promise<RunEvent[]> {
  const agent = new MockAgent({
    pintor: { output: 'cuadro listo', tools: [{ tool: 'Write', input: { f: 'x.png' }, ok: true, output: 'ok' }], tokens: ['pin', 'tando'] },
    sonidista: { output: 'sonido listo' },
  });
  const h = new Orchestrator({ getAdapter: () => agent, decider: new MockDecider() }).start(d, 'haz arte');
  const out: RunEvent[] = [];
  h.bus.subscribe((e) => out.push(e));
  await h.result;
  return out;
}

describe('visor de logs [R8.11]', () => {
  it('[R8.11] filtra por agente, tipo de evento y texto', async () => {
    const ev = await events();
    expect(agentsIn(ev)).toEqual(['pintor', 'sonidista']);
    expect(eventTypesIn(ev)).toContain('tool.called');
    const pintor = filterEvents(ev, { agentId: 'pintor' });
    expect(pintor.length).toBeGreaterThan(0);
    expect(pintor.every((e) => 'nodeId' in e && e.nodeId === 'a')).toBe(true);
    expect(filterEvents(ev, { types: ['tool.called', 'tool.result'] }).map((e) => e.type)).toEqual(['tool.called', 'tool.result']);
    expect(filterEvents(ev, { text: 'SONIDO LISTO' }).every((e) => JSON.stringify(e).includes('sonido listo'))).toBe(true);
    expect(filterEvents(ev, { agentId: 'pintor', types: ['node.finished'] })).toHaveLength(1);
    expect(filterEvents(ev, { agentId: 'nadie' })).toEqual([]);
    expect(filterEvents(ev, {})).toHaveLength(ev.length);
    expect(filterEvents(ev, { nodeId: 'b', types: ['agent.request'] })).toHaveLength(1);
  });

  it('[R8.11] exporta una línea JSON por evento, recuperable sin pérdida', async () => {
    const ev = await events();
    const text = eventsToJsonl(ev);
    expect(text.endsWith('\n')).toBe(true);
    expect(text.trim().split('\n').map((l) => JSON.parse(l))).toEqual(ev);
    expect(eventsToJsonl([])).toBe('');
  });

  it('[R8.11] el visor muestra entrada, herramientas y respuesta, filtra y exporta', async () => {
    const ev = await events();
    const onExport = vi.fn();
    render(<LogViewer events={ev} onExport={onExport} />);
    expect(screen.getByText(`${ev.length} de ${ev.length} eventos`)).toBeTruthy();
    expect(screen.getByText(/pintor recibe: haz arte/)).toBeTruthy();
    expect(screen.getByText(/Write → ok: ok/)).toBeTruthy();
    expect(screen.getByText(/succeeded: cuadro listo/)).toBeTruthy();

    await userEvent.selectOptions(screen.getByLabelText('Agente'), 'sonidista');
    expect(screen.queryByText(/succeeded: cuadro listo/)).toBeNull();
    expect(screen.getByText(/succeeded: sonido listo/)).toBeTruthy();

    await userEvent.selectOptions(screen.getByLabelText('Agente'), '');
    await userEvent.selectOptions(screen.getByLabelText('Tipo de evento'), 'tool.called');
    expect(screen.getAllByRole('listitem')).toHaveLength(1);

    await userEvent.selectOptions(screen.getByLabelText('Tipo de evento'), '');
    await userEvent.type(screen.getByLabelText('Buscar texto'), 'zzz-nada');
    expect(screen.getByText('No hay eventos que mostrar')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Exportar registro' }));
    expect(onExport).toHaveBeenCalledWith(eventsToJsonl(ev));
  });

  it('[R8.11] sin eventos no se puede exportar', () => {
    render(<LogViewer events={[]} onExport={() => {}} />);
    expect((screen.getByRole('button', { name: 'Exportar registro' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
