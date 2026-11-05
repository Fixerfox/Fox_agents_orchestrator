import { describe, expect, it } from 'vitest';
import { CONFIRM_APPROVE, composeConfirmInput, isApproval, validateDiagram, type Diagram, type RunEvent } from '../src';
import { ENTRY, OUTPUT, agent, chain, diagram, edge, fan, ofType, setup, waitForEvent } from './helpers';

const confirming = (d: Diagram, ids: string[]): Diagram => ({ ...d, nodes: d.nodes.map((n) => (ids.includes(n.id) ? { ...n, confirm: true } : n)) });
const isQ = (e: RunEvent) => e.type === 'agent.question';

describe('SPEC-043 · confirmar antes de terminar (motor)', () => {
  it('[R43.2] solo los pasos de agente confirman', () => {
    expect(validateDiagram(confirming(chain(['a']), ['a']))).toEqual([]);
    const bad = diagram([ENTRY, { ...agent('a') }, { ...OUTPUT, confirm: true }], [edge('entry', 'a'), edge('a', 'output')]);
    expect(validateDiagram(bad).map((i) => i.code)).toEqual(['node-confirm-not-agent']);
  });

  it('[R43.4][R43.5][R43.6] pide confirmación con la salida y «Aprobar»; aprobado, el flujo sigue con esa salida', async () => {
    const { orch, agents } = setup({ scripts: { a: { output: '## Resumen para confirmar\n- Hecho' }, b: { output: 'fin' } } });
    const h = orch.start(confirming(chain(['a', 'b']), ['a']), 'Haz algo');
    const q = (await waitForEvent(h.bus, isQ)) as Extract<RunEvent, { type: 'agent.question' }>;
    expect(q).toMatchObject({ nodeId: 'a', text: '## Resumen para confirmar\n- Hecho', options: [CONFIRM_APPROVE], confirm: { round: 1 } });
    // Mientras espera, el siguiente paso no ha empezado.
    expect(agents.callsOf('b')).toHaveLength(0);
    expect(agents.callsOf('a')[0]!.confirm).toBe(true);
    expect(h.answer(q.questionId, ' aprobar ')).toBe(true);
    const r = await h.result;
    expect(r.status).toBe('succeeded');
    expect(agents.callsOf('a')).toHaveLength(1);
    expect(agents.callsOf('b')[0]!.input.text).toBe('## Resumen para confirmar\n- Hecho');
    expect(ofType(r.events, 'agent.request').find((e) => e.nodeId === 'a')).toMatchObject({ confirm: true });
    expect(ofType(r.events, 'agent.request').find((e) => e.nodeId === 'b')!.confirm).toBeUndefined();
    expect(ofType(r.events, 'confirm.decided')).toEqual([expect.objectContaining({ nodeId: 'a', round: 1, verdict: 'approved' })]);
  });

  it('[R43.7] pedir cambios vuelve a ejecutar al agente con su entrega anterior y lo pedido; luego vuelve a preguntar', async () => {
    const { orch, agents } = setup({ scripts: { a: { output: () => `entrega ${agents.callsOf('a').length}`, files: ['web/index.html'] } } });
    const h = orch.start(confirming(chain(['a']), ['a']), { text: 'Haz la web', files: ['brief.md'] });
    const q1 = (await waitForEvent(h.bus, isQ)) as Extract<RunEvent, { type: 'agent.question' }>;
    h.answer(q1.questionId, 'Cambia el color del botón');
    const q2 = (await waitForEvent(h.bus, (e) => isQ(e) && e.type === 'agent.question' && e.confirm?.round === 2)) as Extract<RunEvent, { type: 'agent.question' }>;
    expect(q2.text).toContain('entrega 2');
    const second = agents.callsOf('a')[1]!;
    expect(second.input.text).toContain('Haz la web');
    expect(second.input.text).toContain('## Cambios pedidos antes de confirmar (vuelta 1)');
    expect(second.input.text).toContain('### Tu entrega anterior\n\nentrega 1');
    expect(second.input.text).toContain('### Lo que pide el usuario\n\nCambia el color del botón');
    expect(second.input.files).toEqual(['brief.md', 'web/index.html']);
    expect(second.previousAnswers.at(-1)).toMatchObject({ answer: 'Cambia el color del botón' });
    h.answer(q2.questionId, CONFIRM_APPROVE);
    const r = await h.result;
    expect(r.status).toBe('succeeded');
    expect(r.output!.text).toContain('entrega 2');
    expect(ofType(r.events, 'confirm.decided').map((e) => [e.round, e.verdict, e.text])).toEqual([
      [1, 'changes', 'Cambia el color del botón'],
      [2, 'approved', undefined],
    ]);
    // Sigue siendo una sola pasada del paso.
    expect(ofType(r.events, 'node.started').filter((e) => e.nodeId === 'a')).toHaveLength(1);
  });

  it('[R43.5] mientras espera la confirmación libera su hueco: otra rama trabaja', async () => {
    const { orch, agents } = setup({ scripts: { a: { output: 'a' }, b: { output: 'b' } } });
    const h = orch.start(confirming(fan(['a', 'b']), ['a']), 'x', { maxConcurrency: 1 });
    const q = (await waitForEvent(h.bus, isQ)) as Extract<RunEvent, { type: 'agent.question' }>;
    await waitForEvent(h.bus, (e) => e.type === 'node.finished' && e.nodeId === 'b');
    expect(agents.callsOf('b')).toHaveLength(1);
    h.answer(q.questionId, 'Aprobar');
    expect((await h.result).status).toBe('succeeded');
  });

  it('[R43.7] cancelar mientras espera deja el paso cancelado', async () => {
    const { orch } = setup({ scripts: { a: { output: 'a' } } });
    const h = orch.start(confirming(chain(['a']), ['a']), 'x');
    await waitForEvent(h.bus, isQ);
    h.cancel();
    const r = await h.result;
    expect(r.status).toBe('cancelled');
    expect(ofType(r.events, 'confirm.decided')).toEqual([]);
  });

  it('[R43.6][R43.7] «Aprobar» sin distinguir mayúsculas; la entrada compuesta junta archivos sin repetir', () => {
    expect(isApproval('APROBAR')).toBe(true);
    expect(isApproval('aprobar, pero…')).toBe(false);
    const p = composeConfirmInput({ round: 2, original: { text: 'O', files: ['a', 'b'] }, previous: { text: 'P', files: ['b', 'c'] }, request: 'R' });
    expect(p).toEqual({ text: 'O\n\n## Cambios pedidos antes de confirmar (vuelta 2)\n\n### Tu entrega anterior\n\nP\n\n### Lo que pide el usuario\n\nR', files: ['a', 'b', 'c'] });
  });
});
