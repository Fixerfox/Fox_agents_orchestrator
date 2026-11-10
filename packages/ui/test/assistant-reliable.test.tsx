// @vitest-environment jsdom
import './setup';
import { describe, expect, it, vi } from 'vitest';
import type { Diagram, DiagramNode, Edge } from '@orquestador/core';
import { EditorSession } from '@orquestador/editor';
import { runAssistantTool, type AssistantHost } from '../src/assistant/assistantTools';
import { createMemoryApi } from '../src/memoryApi';

const N = (id: string, kind: DiagramNode['kind'] = 'agent', extra: Partial<DiagramNode> = {}): DiagramNode => ({ id, kind, label: id, ...(kind === 'agent' ? { agentId: id } : {}), ...extra });
const E = (from: string, to: string, extra: Partial<Edge> = {}): Edge => ({ id: `${from}->${to}${extra.port ? `:${extra.port}` : ''}`, from, to, ...extra });
const D = (nodes: DiagramNode[], edges: Edge[]): Diagram => ({ id: 'd', name: 'D', schemaVersion: 1, nodes: [N('entry', 'entry'), N('output', 'output'), ...nodes], edges });

function host(d: Diagram, run: AssistantHost['run'] = vi.fn(async () => 'run-9')) {
  const session = new EditorSession(d);
  return { session, h: { api: createMemoryApi(), session, newDiagram: vi.fn(), run, refresh: vi.fn() } as unknown as AssistantHost };
}
const links = (s: EditorSession) => s.getSnapshot().level.edges.map((e) => `${e.from}->${e.to}${e.port ? `:${e.port}` : ''}${e.condition ? `?${e.condition}` : ''}`).sort();

describe('SPEC-085 · quitar un paso', () => {
  it('[R85.1] un paso que no existe, la Entrada o la Salida dan error y no cambian nada', async () => {
    const { session, h } = host(D([N('a')], [E('entry', 'a'), E('a', 'output')]));
    expect(await runAssistantTool(h, 'remove_step', { nodeId: 'zz' })).toMatchObject({ ok: false, summary: 'No existe el paso «zz».' });
    expect(await runAssistantTool(h, 'remove_step', { nodeId: 'output' })).toMatchObject({ ok: false, summary: 'La Entrada y la Salida no se pueden quitar.' });
    expect(links(session)).toEqual(['a->output', 'entry->a']);
  });

  it('[R85.2] en medio de una cadena une el anterior con el siguiente', async () => {
    const { session, h } = host(D([N('a'), N('b'), N('c')], [E('entry', 'a'), E('a', 'b'), E('b', 'c'), E('c', 'output')]));
    const r = await runAssistantTool(h, 'remove_step', { nodeId: 'b' });
    expect(r).toMatchObject({ ok: true, result: { ok: true, reconnected: { from: 'a', to: 'c' } } });
    expect(links(session)).toEqual(['a->c', 'c->output', 'entry->a']);
  });

  it('[R85.2] conserva la salida de una revisión y la condición de un enrutador', async () => {
    const review = host(
      D([N('a'), N('rev', 'review', { review: { mode: 'verdict', maxRounds: 2 } }), N('b')], [E('entry', 'a'), E('a', 'rev'), E('rev', 'b', { port: 'approved' }), E('rev', 'a', { port: 'rejected' }), E('b', 'output'), E('rev', 'output', { port: 'exhausted' })]),
    );
    expect((await runAssistantTool(review.h, 'remove_step', { nodeId: 'b' })).result).toMatchObject({ reconnected: { from: 'rev', to: 'output' } });
    expect(links(review.session)).toContain('rev->output:approved');
    const routed = host(D([N('r', 'router', { router: { mode: 'rules' } }), N('a'), N('x')], [E('entry', 'r'), E('r', 'a', { condition: 'es un bug' }), E('r', 'x', { condition: 'otra cosa' }), E('a', 'output'), E('x', 'output')]));
    await runAssistantTool(routed.h, 'remove_step', { nodeId: 'a' });
    expect(links(routed.session)).toContain('r->output?es un bug');
  });

  it('[R85.2] si la conexión ya existe no la duplica', async () => {
    const { session, h } = host(D([N('a'), N('b')], [E('entry', 'a'), E('a', 'b'), E('b', 'output'), E('a', 'output')]));
    const r = await runAssistantTool(h, 'remove_step', { nodeId: 'b' });
    expect(r.result).toEqual({ ok: true });
    expect(links(session)).toEqual(['a->output', 'entry->a']);
  });

  it('[R85.3] con varias entradas o salidas no inventa conexiones y dice qué quedó suelto', async () => {
    const { session, h } = host(D([N('a'), N('b'), N('j')], [E('entry', 'a'), E('entry', 'b'), E('a', 'j'), E('b', 'j'), E('j', 'output')]));
    const r = await runAssistantTool(h, 'remove_step', { nodeId: 'j' });
    expect((r.result as { disconnected: string[] }).disconnected.sort()).toEqual(['a', 'b', 'output']);
    expect(links(session)).toEqual(['entry->a', 'entry->b']);
  });
});

describe('SPEC-085 · añadir y lanzar', () => {
  it('[R85.4] sin «after»: ninguna conexión a la Salida y varias dan mensajes distintos', async () => {
    const none = host(D([N('a')], [E('entry', 'a')]));
    expect(await runAssistantTool(none.h, 'add_step', { agentId: 'b' })).toMatchObject({ ok: false, summary: 'Ninguna conexión llega a la Salida: indica tras qué paso va (after).' });
    expect(await runAssistantTool(none.h, 'add_parallel', { agentIds: ['b', 'c'] })).toMatchObject({ ok: false, summary: 'Ninguna conexión llega a la Salida: indica tras qué paso va (after).' });
    const many = host(D([N('a'), N('b')], [E('entry', 'a'), E('entry', 'b'), E('a', 'output'), E('b', 'output')]));
    expect(await runAssistantTool(many.h, 'add_step', { agentId: 'c' })).toMatchObject({ ok: false, summary: 'Indica tras qué paso va (after): hay varias conexiones que llegan a Salida.' });
  });

  it('[R85.5] un diagrama no válido no se lanza y el error lista los problemas', async () => {
    const run = vi.fn(async () => 'run-9');
    const { h } = host(D([N('a')], [E('entry', 'a')]), run);
    const r = await runAssistantTool(h, 'run_diagram', { input: 'x' });
    expect(r.ok).toBe(false);
    expect(r.summary).toContain('El diagrama no se puede ejecutar:');
    expect(r.summary).toContain('- El nodo output no es alcanzable desde el entry');
    expect(run).not.toHaveBeenCalled();
  });

  it('[R85.6] devuelve el id de la ejecución, o falla si la app no la lanzó', async () => {
    const valid = D([N('a')], [E('entry', 'a'), E('a', 'output')]);
    expect(await runAssistantTool(host(valid).h, 'run_diagram', { input: 'x' })).toMatchObject({ ok: true, result: { started: true, runId: 'run-9' } });
    const r = await runAssistantTool(host(valid, vi.fn(async () => undefined)).h, 'run_diagram', { input: 'x' });
    expect(r).toMatchObject({ ok: false, summary: 'No se pudo lanzar la ejecución: la app enseña el motivo.' });
  });
});
