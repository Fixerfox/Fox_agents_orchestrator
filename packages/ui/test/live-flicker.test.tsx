// @vitest-environment jsdom
import './setup';
import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { Diagram } from '@orquestador/core';
import type { ProjectApi, RunSnapshot } from '@orquestador/editor';
import { keepNodes } from '../src/diagrams/keepNodes';
import { useRunData } from '../src/runs/useRunData';

type Node = Parameters<typeof keepNodes>[0][number];
const node = (data: Record<string, unknown>, more: Record<string, unknown> = {}): Node => ({ id: 'a', type: 'orq', position: { x: 0, y: 0 }, data: { kind: 'agent', label: 'Paso', problems: [], ...data }, ...more }) as unknown as Node;
const measured = { width: 200, height: 84 };

describe('SPEC-015 · el lienzo no parpadea', () => {
  it('[R15.15] un nodo que cambia conserva su medida: sin ella, React Flow lo oculta', () => {
    const [kept] = keepNodes([node({}, { measured })], [node({ runStatus: 'running' })], true);
    expect(kept!.measured).toEqual(measured);
    expect(kept!.data['runStatus']).toBe('running');
  });

  it('[R15.15] también al editar', () => {
    expect(keepNodes([node({}, { measured })], [node({ label: 'Otro' })], false)[0]!.measured).toEqual(measured);
  });

  it('[R15.15] el que no cambia en una ejecución es el mismo objeto, aunque traiga funciones nuevas', () => {
    const before = [node({ onOpenFile: () => 1, files: ['a.md'] }, { measured })];
    expect(keepNodes(before, [node({ onOpenFile: () => 2, files: ['a.md'] })], true)).toBe(before);
  });

  it('[R15.15] al editar, las funciones nuevas sí se reciben', () => {
    const fresh = () => 2;
    expect(keepNodes([node({ onPort: () => 1 }, { measured })], [node({ onPort: fresh })], false)[0]!.data['onPort']).toBe(fresh);
  });

  it('[R15.15] conserva la selección, y lo que cambia de sitio o de datos se actualiza', () => {
    const was = node({}, { measured, selected: true });
    expect(keepNodes([was], [node({})], true)[0]).toBe(was);
    expect(keepNodes([was], [node({}, { position: { x: 5, y: 0 } })], true)[0]!.position.x).toBe(5);
    expect(keepNodes([was], [node({ alerts: ['uno'] })], true)[0]).not.toBe(was);
  });

  it('[R15.15] los nodos nuevos entran y los que ya no están salen', () => {
    const other = { ...node({}), id: 'b' } as Node;
    expect(keepNodes([node({}, { measured })], [other], true).map((n) => n.id)).toEqual(['b']);
  });

  it('[R15.16] saber tarde qué diagrama es no vacía el que ya se ve', async () => {
    const diagram = { id: 'd', name: 'd', schemaVersion: 1, nodes: [], edges: [] } as unknown as Diagram;
    const runDiagram = vi.fn(() => new Promise((r) => setTimeout(() => r({ ok: true, value: diagram }), 0)));
    const api = { runDiagram } as unknown as ProjectApi;
    const main = (events: unknown[]) => ({ runId: 'r', events, live: { status: 'running', usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 } } }) as unknown as RunSnapshot;
    const now = () => 0;
    const { result, rerender } = renderHook(({ s }) => useRunData(api, 'r', s, undefined, true, now), { initialProps: { s: main([]) } });
    await waitFor(() => expect(result.current.diagram).toBe(diagram));
    rerender({ s: main([{ type: 'run.started', runId: 'r', seq: 1, ts: '2026-11-06T10:00:00.000Z', diagramId: 'd' }]) });
    expect(result.current.diagram).toBe(diagram);
    await waitFor(() => expect(runDiagram).toHaveBeenCalledTimes(2));
    expect(result.current.diagram).toBe(diagram);
  });
});
