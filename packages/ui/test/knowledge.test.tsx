// @vitest-environment jsdom
import './setup';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { newAgent, newContext, newMcpServer, newSkill, type Diagram, type KnowledgeExtra } from '@orquestador/core';
import { createDiagram, deriveLive, EMPTY_LIVE, type LiveView } from '@orquestador/editor';
import { App } from '../src/App';
import { resourceEdges, resourceNodes } from '../src/Canvas';
import { ExtraKnowledge, type KnowledgeCatalog } from '../src/ExtraKnowledge';
import { createMemoryApi } from '../src/memoryApi';

const catalog: KnowledgeCatalog = { skills: [{ id: 'trazo', name: 'Trazo' }], contexts: [{ id: 'guia', name: 'Guía' }], mcp: [{ id: 'pixel', name: 'Pixelart' }] };
const node = (extra: KnowledgeExtra): Diagram['nodes'][number] => ({ id: 'a', kind: 'agent', agentId: 'a', extra });

describe('SPEC-036 · interruptor «Obligatoria» en el panel', () => {
  it('[R36.16] cada ficha tiene un interruptor con candado y texto «Obligatoria» cuando está activo', async () => {
    const onChange = vi.fn();
    const { rerender } = render(<ExtraKnowledge label="Para todos sus agentes" hint="" value={{ skillIds: ['trazo'], mcpIds: ['pixel'] }} catalog={catalog} onChange={onChange} />);
    const lock = screen.getByRole('button', { name: 'Hacer obligatoria «Trazo»' });
    expect(lock.getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByText('Obligatoria')).toBeNull();
    await userEvent.click(lock);
    expect(onChange).toHaveBeenLastCalledWith({ skillIds: ['trazo'], mcpIds: ['pixel'], required: { skillIds: ['trazo'] } });
    rerender(<ExtraKnowledge label="Para todos sus agentes" hint="" value={{ skillIds: ['trazo'], required: { skillIds: ['trazo'] } }} catalog={catalog} onChange={onChange} />);
    const on = screen.getByRole('button', { name: 'Dejar «Trazo» como opcional' });
    expect(on.getAttribute('aria-pressed')).toBe('true');
    expect(within(on).getByText('Obligatoria')).toBeTruthy();
    await userEvent.click(on);
    expect(onChange).toHaveBeenLastCalledWith({ skillIds: ['trazo'] });
  });

  it('[R36.19] lo que el diagrama manda como obligatorio se ve así en el paso y no se puede desmarcar desde él', async () => {
    const onChange = vi.fn();
    render(<ExtraKnowledge label="Solo en este paso" hint="" value={{ contextIds: ['guia'] }} inherited={{ contextIds: ['guia'], required: { contextIds: ['guia'] } }} catalog={catalog} onChange={onChange} />);
    const btn = screen.getByRole('button', { name: 'Obligatoria por el diagrama' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(within(btn).getByText('Obligatoria por el diagrama')).toBeTruthy();
    await userEvent.click(btn);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('SPEC-036 · fichas y líneas en el lienzo', () => {
  it('[R36.17] la línea de una ficha obligatoria lleva la clase de color propio; la opcional, no', () => {
    const nodes = resourceNodes(node({ contextIds: ['guia', 'notas'], required: { contextIds: ['guia'] } }));
    const edges = resourceEdges(nodes);
    const cls = (id: string) => edges.find((e) => e.id === `res-edge:res:a:${id}`)!.className!;
    expect(cls('contextIds:guia')).toBe('orq-res-edge is-required');
    expect(cls('contextIds:notas')).toBe('orq-res-edge');
    expect(nodes.map((n) => n.data.required === true)).toEqual([true, false]);
  });

  it('[R36.19] lo obligatorio en el diagrama marca la ficha del paso como obligatoria «por el diagrama»', () => {
    const nodes = resourceNodes(node({ contextIds: ['guia'] }), {}, undefined, { ports: { diagramExtra: { contextIds: ['guia'], required: { contextIds: ['guia'] } } } });
    expect(nodes[0]!.data).toMatchObject({ required: true, byDiagram: true });
  });

  it('[R36.18] el estado de cada ficha sale del último intento; «No usada» solo cuando el paso ya terminó', () => {
    const n = node({ skillIds: ['trazo', 'paleta'], contextIds: ['guia'], required: { skillIds: ['trazo'] } });
    const live = (status: 'running' | 'succeeded' | 'failed'): LiveView => ({
      ...EMPTY_LIVE,
      status: 'running',
      nodeStatus: { a: status },
      knowledge: { a: { 'skill:trazo': 'included', 'context:guia': 'used' } },
    });
    const state = (l: LiveView) => Object.fromEntries(resourceNodes(n, {}, undefined, { live: l, key: 'a' }).map((r) => [r.data.itemId, r.data.state]));
    expect(state(live('running'))).toEqual({ trazo: 'included', paleta: undefined, guia: 'used' });
    expect(state(live('succeeded'))).toEqual({ trazo: 'included', paleta: 'unused', guia: 'used' });
    const failed: LiveView = { ...live('failed'), knowledge: { a: { 'skill:trazo': 'missing' } } };
    expect(state(failed)).toEqual({ trazo: 'missing', paleta: 'unused', guia: 'unused' });
    expect(deriveLive([]).knowledge).toEqual({});
  });
});

describe('SPEC-036 · de punta a punta en el editor', () => {
  it('[R36.16][R36.17] el candado de la ficha del lienzo la marca como obligatoria y se deshace con Ctrl+Z', async () => {
    const api = createMemoryApi([createDiagram('principal', 'Principal')], {
      agents: [{ ...newAgent('pix', 'Pixelador'), description: 'Pinta' }],
      skills: [{ ...newSkill('trazo', 'Trazo'), description: 'Contornos' }],
      contexts: [{ ...newContext('glosario', 'Glosario'), value: 'Términos' }],
      mcp: [{ ...newMcpServer('pixelart', 'Pixelart'), command: 'npx' }],
    });
    render(<App initialProject="Juego" api={api} agents={[]} confirm={() => true} />);
    await userEvent.click(screen.getByRole('button', { name: /^Proyecto «/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Abrir proyecto' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Añadir «Pixelador» al diagrama' }));
    await screen.findByLabelText(/^Agente «pix»/);
    await userEvent.click(screen.getByRole('button', { name: 'Añadir skill o contexto solo a «pix»' }));
    const pick = within(screen.getByRole('dialog', { name: 'Skills y contextos · solo en «pix»' }));
    await userEvent.click(pick.getByRole('button', { name: 'Añadir Glosario' }));
    await userEvent.click(pick.getByRole('button', { name: 'Listo' }));
    const ficha = await screen.findByRole('group', { name: 'Contexto «Glosario» solo en este paso' });
    await userEvent.click(within(ficha).getByRole('button', { name: 'Hacer obligatoria «Glosario»' }));
    const marked = await screen.findByRole('group', { name: 'Contexto «Glosario» solo en este paso · Obligatoria' });
    expect(within(marked).getByRole('button', { name: 'Dejar «Glosario» como opcional' }).getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('.react-flow__edge.orq-res-edge.is-required')).not.toBeNull();
    await userEvent.keyboard('{Control>}z{/Control}');
    await waitFor(() => expect(screen.getByRole('group', { name: 'Contexto «Glosario» solo en este paso' })).toBeTruthy());
    expect(document.querySelector('.react-flow__edge.orq-res-edge.is-required')).toBeNull();
  });
});

describe('SPEC-036 · skills y MCP enchufados: obligatorios siempre', () => {
  it('[R36.22] en el lienzo una skill o un MCP del paso es obligatorio, con candado fijo y sin interruptor', () => {
    const toggle = vi.fn();
    const nodes = resourceNodes(node({ skillIds: ['trazo'], contextIds: ['guia'], mcpIds: ['pixel'] }), {}, undefined, { ports: { onToggleRequired: toggle } });
    const by = (id: string) => nodes.find((n) => n.data.itemId === id)!.data;
    expect(by('trazo')).toMatchObject({ required: true, plugged: true });
    expect(by('pixel')).toMatchObject({ required: true, plugged: true });
    expect(by('trazo').onToggleRequired).toBeUndefined();
    expect(by('pixel').onToggleRequired).toBeUndefined();
    expect(by('guia').required).toBeUndefined();
    expect(by('guia').onToggleRequired).toBe(toggle);
    const cls = resourceEdges(nodes).map((e) => e.className);
    expect(cls).toEqual(['orq-res-edge is-required', 'orq-res-edge', 'orq-res-edge is-mcp is-required']);
    // aunque el diagrama la tenga como opcional, en el paso sigue siendo obligatoria y no «por el diagrama»
    const d = resourceNodes(node({ skillIds: ['trazo'] }), {}, undefined, { ports: { diagramExtra: { skillIds: ['trazo'], required: { skillIds: ['trazo'] } } } });
    expect(d[0]!.data.byDiagram).toBeUndefined();
  });

  it('[R36.22] en «Solo en este paso» las skills y MCP salen obligatorios y sin poder desmarcarse; el contexto conserva el interruptor', async () => {
    const onChange = vi.fn();
    render(<ExtraKnowledge label="Solo en este paso" hint="" step value={{ skillIds: ['trazo'], contextIds: ['guia'], mcpIds: ['pixel'] }} catalog={catalog} onChange={onChange} />);
    const locks = screen.getAllByRole('button', { name: 'Obligatoria: está enchufada a este paso' }) as HTMLButtonElement[];
    expect(locks).toHaveLength(2);
    for (const b of locks) {
      expect(b.disabled).toBe(true);
      expect(b.getAttribute('aria-pressed')).toBe('true');
      expect(within(b).getByText('Obligatoria')).toBeTruthy();
    }
    await userEvent.click(locks[0]!);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Hacer obligatoria «Guía»' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('[R36.22] enchufar una skill en el editor la deja obligatoria al momento, con línea continua y sin candado que desmarcar', async () => {
    const api = createMemoryApi([createDiagram('principal', 'Principal')], {
      agents: [{ ...newAgent('pix', 'Pixelador'), description: 'Pinta' }],
      skills: [{ ...newSkill('trazo', 'Trazo'), description: 'Contornos' }],
    });
    render(<App initialProject="Juego" api={api} agents={[]} confirm={() => true} />);
    await userEvent.click(screen.getByRole('button', { name: /^Proyecto «/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Abrir proyecto' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Añadir «Pixelador» al diagrama' }));
    await screen.findByLabelText(/^Agente «pix»/);
    await userEvent.click(screen.getByRole('button', { name: 'Añadir skill o contexto solo a «pix»' }));
    const pick = within(screen.getByRole('dialog', { name: 'Skills y contextos · solo en «pix»' }));
    await userEvent.click(pick.getByRole('button', { name: 'Añadir Trazo' }));
    await userEvent.click(pick.getByRole('button', { name: 'Listo' }));
    const ficha = await screen.findByRole('group', { name: 'Skill «Trazo» solo en este paso · Obligatoria' });
    expect(ficha.getAttribute('title')).toBe('Obligatoria: está enchufada a este paso');
    expect(within(ficha).queryByRole('button', { name: /obligatoria «Trazo»|como opcional/ })).toBeNull();
    expect(document.querySelector('.react-flow__edge.orq-res-edge.is-required')).not.toBeNull();
  });
});
