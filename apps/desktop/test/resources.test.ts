import { describe, expect, it } from 'vitest';
import type { Diagram, RunEvent } from '@orquestador/core';
import { noticeFor } from '../src/main/notices';
import { appResources } from '../src/main/composition';

const D = { id: 'd', name: 'Web de la tienda', schemaVersion: 1, nodes: [{ id: 'a', kind: 'agent', agentId: 'dev', label: 'Dev' }], edges: [] } as unknown as Diagram;
const ev = (b: Record<string, unknown>) => ({ runId: 'r1', seq: 1, ts: '2026-11-08T10:00:00.000Z', ...b }) as unknown as RunEvent;

describe('SPEC-077 · en la app de escritorio', () => {
  it('[R77.6] al pasar del 80 % llega un aviso del sistema que abre la ejecución', () => {
    expect(noticeFor(ev({ type: 'run.budget_warning', limit: 'cost', used: 4.1, max: 5 }), D)).toEqual({ title: 'Web de la tienda: 82 % del presupuesto', body: 'Se han gastado 4.10 $ de 5.00 $.', runId: 'r1', live: true });
  });

  it('[R77.7] la pregunta del 90 % avisa como «Queda poco presupuesto»', () => {
    expect(noticeFor(ev({ type: 'agent.question', nodeId: 'a', questionId: 'q', text: 'Queda menos del 10 %', kind: 'budget' }), D)?.title).toBe('Queda poco presupuesto');
  });

  it('[R77.1] hay unos solos recursos para toda la app, con 8 agentes por defecto', () => {
    expect(appResources.agents.full).toBe(false);
    expect(appResources.agents.busy).toBe(0);
  });
});

describe('SPEC-019 · errores de la interfaz', () => {
  it('[R19.12] la línea del aviso de error se apunta; los demás mensajes de la consola, no', async () => {
    const { crashLine } = await import('../src/main/crash');
    expect(crashLine([{ message: '[orquestador:interfaz] TypeError: c is not a function\n    at Xy (renderer.js:1:2)' }])).toContain('c is not a function');
    expect(crashLine([{}, 3, '[orquestador:interfaz] Error: x'])).toBe('[orquestador:interfaz] Error: x');
    expect(crashLine([{ message: 'Warning: algo' }])).toBeUndefined();
  });
});
