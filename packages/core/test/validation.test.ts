import { describe, expect, it } from 'vitest';
import { validateDiagram, type Diagram } from '../src';
import { ENTRY, OUTPUT, agent, chain, diagram, edge, loop, router, sub } from './helpers';

const codes = (d: Diagram) => validateDiagram(d).map((i) => i.code);
const body = () => chain(['inner'], 'body');

describe('SPEC-001 · validación de diagramas', () => {
  it('[R1.13] un diagrama válido no devuelve problemas', () => {
    expect(validateDiagram(chain(['a', 'b']))).toEqual([]);
  });

  it('[R1.1] la posición opcional de los nodos no afecta a la validación', () => {
    const d = chain(['a']);
    d.nodes = d.nodes.map((n, i) => ({ ...n, position: { x: i * 100, y: 20 } }));
    expect(validateDiagram(d)).toEqual([]);
  });

  it('[R1.1] rechaza una schemaVersion distinta de la actual', () => {
    expect(codes({ ...chain(['a']), schemaVersion: 2 })).toContain('schema-version');
  });

  it('[R1.2] ids de nodo y de arista únicos', () => {
    const d = diagram([ENTRY, agent('a'), agent('a'), OUTPUT], [edge('entry', 'a'), edge('a', 'output')]);
    expect(codes(d)).toContain('duplicate-node-id');
    const d2 = diagram([ENTRY, agent('a'), OUTPUT], [edge('entry', 'a'), edge('entry', 'a'), edge('a', 'output')]);
    expect(codes(d2)).toContain('duplicate-edge-id');
  });

  it('[R1.3] aristas a nodos inexistentes o a sí mismos', () => {
    const d = diagram([ENTRY, agent('a'), OUTPUT], [edge('entry', 'a'), edge('a', 'output'), edge('a', 'zzz')]);
    expect(codes(d)).toContain('unknown-node');
    const d2 = diagram([ENTRY, agent('a'), OUTPUT], [edge('entry', 'a'), edge('a', 'a'), edge('a', 'output')]);
    expect(codes(d2)).toContain('self-edge');
  });

  it('[R1.4] exactamente un entry y un output', () => {
    expect(codes(diagram([agent('a'), OUTPUT], [edge('a', 'output')]))).toContain('entry-count');
    const two = diagram(
      [ENTRY, agent('a'), OUTPUT, { id: 'o2', kind: 'output' }],
      [edge('entry', 'a'), edge('a', 'output'), edge('a', 'o2')],
    );
    expect(codes(two)).toContain('output-count');
  });

  it('[R1.5] el entry no recibe y el output no emite', () => {
    const d = diagram(
      [ENTRY, agent('a'), OUTPUT],
      [edge('entry', 'a'), edge('a', 'output'), edge('a', 'entry'), edge('output', 'a')],
    );
    const c = codes(d);
    expect(c).toContain('entry-has-incoming');
    expect(c).toContain('output-has-outgoing');
  });

  it('[R1.6] detecta ciclos y sugiere el nodo loop', () => {
    const d = diagram(
      [ENTRY, agent('a'), agent('b'), OUTPUT],
      [edge('entry', 'a'), edge('a', 'b'), edge('b', 'a'), edge('b', 'output')],
    );
    const issues = validateDiagram(d);
    const cycle = issues.find((i) => i.code === 'cycle');
    expect(cycle).toBeDefined();
    expect(cycle!.message).toContain('loop');
  });

  it('[R1.7] detecta nodos inalcanzables desde el entry', () => {
    const d = diagram(
      [ENTRY, agent('a'), agent('x'), OUTPUT],
      [edge('entry', 'a'), edge('a', 'output'), edge('x', 'output')],
    );
    const issue = validateDiagram(d).find((i) => i.code === 'unreachable');
    expect(issue?.nodeId).toBe('x');
  });

  it('[R1.8] un agente necesita agentId', () => {
    const d = diagram(
      [ENTRY, { id: 'a', kind: 'agent' }, OUTPUT],
      [edge('entry', 'a'), edge('a', 'output')],
    );
    expect(codes(d)).toContain('agent-missing-id');
  });

  it('[R1.9] un router necesita configuración y al menos una salida', () => {
    const d = diagram(
      [ENTRY, { id: 'r', kind: 'router' }, OUTPUT],
      [edge('entry', 'r'), edge('entry', 'output')],
    );
    const c = codes(d);
    expect(c).toContain('router-missing-config');
    expect(c).toContain('router-no-outgoing');
    expect(codes(diagram([ENTRY, router('r', 'ai'), OUTPUT], [edge('entry', 'r'), edge('r', 'output')]))).toEqual([]);
  });

  it('[R1.10] valida la configuración de los bucles', () => {
    const mk = (cfg: Parameters<typeof loop>[1] | undefined) =>
      diagram(
        [ENTRY, cfg ? loop('l', cfg) : { id: 'l', kind: 'loop' }, OUTPUT],
        [edge('entry', 'l'), edge('l', 'output')],
      );
    expect(codes(mk(undefined))).toContain('loop-missing-config');
    expect(codes(mk({ mode: 'count', count: 2, maxIterations: 0, body: body() }))).toContain('loop-invalid-max');
    expect(codes(mk({ mode: 'count', count: 2, maxIterations: 1.5, body: body() }))).toContain('loop-invalid-max');
    expect(codes(mk({ mode: 'count', count: 0, maxIterations: 3, body: body() }))).toContain('loop-invalid-count');
    expect(codes(mk({ mode: 'count', count: 5, maxIterations: 3, body: body() }))).toContain('loop-invalid-count');
    expect(codes(mk({ mode: 'ai-judge', prompt: '  ', maxIterations: 3, body: body() }))).toContain('loop-missing-prompt');
    expect(codes(mk({ mode: 'count', count: 3, maxIterations: 3, body: body() }))).toEqual([]);
    expect(codes(mk({ mode: 'ai-judge', prompt: 'listo', maxIterations: 3, body: body() }))).toEqual([]);
  });

  it('[R1.11] valida el cuerpo del bucle e indica la cadena de bucles en path', () => {
    const badBody = diagram([ENTRY, agent('x')], [edge('entry', 'x')], 'bad'); // sin output
    const inner = loop('inner', { mode: 'count', count: 1, maxIterations: 1, body: badBody });
    const outerBody = diagram([ENTRY, inner, OUTPUT], [edge('entry', 'inner'), edge('inner', 'output')], 'ob');
    const d = diagram(
      [ENTRY, loop('outer', { mode: 'count', count: 1, maxIterations: 1, body: outerBody }), OUTPUT],
      [edge('entry', 'outer'), edge('outer', 'output')],
    );
    const issue = validateDiagram(d).find((i) => i.code === 'output-count');
    expect(issue?.path).toEqual(['outer', 'inner']);
  });

  it('[R1.12] un subdiagrama necesita templateId', () => {
    const d = diagram(
      [ENTRY, { id: 's', kind: 'subdiagram' }, OUTPUT],
      [edge('entry', 's'), edge('s', 'output')],
    );
    expect(codes(d)).toContain('subdiagram-missing-template');
    expect(codes(diagram([ENTRY, sub('s', 't'), OUTPUT], [edge('entry', 's'), edge('s', 'output')]))).toEqual([]);
  });
});
