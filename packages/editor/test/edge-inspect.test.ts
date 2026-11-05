import { describe, expect, it } from 'vitest';
import { MockAgent, MockDecider, Orchestrator, type Diagram, type DiagramNode, type Edge, type RunEvent } from '@orquestador/core';
import { approxTokensLabel, edgeTraversals, requestKnowledge } from '../src';

const agent = (id: string, extra: Partial<DiagramNode> = {}): DiagramNode => ({ id, kind: 'agent', agentId: id, label: id, ...extra });
const edge = (from: string, to: string, port?: Edge['port']): Edge => ({ id: `${from}->${to}`, from, to, ...(port ? { port } : {}) });
const diagram = (nodes: DiagramNode[], edges: Edge[]): Diagram => ({ id: 'd', name: 'd', schemaVersion: 1, nodes, edges });
const ENTRY: DiagramNode = { id: 'entry', kind: 'entry' };
const OUTPUT: DiagramNode = { id: 'output', kind: 'output' };

async function run(d: Diagram, scripts: ConstructorParameters<typeof MockAgent>[0], order = 'Haz la landing'): Promise<readonly RunEvent[]> {
  const agents = new MockAgent(scripts);
  const orch = new Orchestrator({
    getAdapter: () => agents,
    decider: new MockDecider(),
    describeAgent: (id) => ({ name: id, model: 'claude-sonnet-5-5', instructions: `Eres ${id}`, skillIds: ['frontend-design'], contextIds: ['publico'] }),
  });
  return (await orch.start(d, order).result).events;
}

describe('SPEC-042 · edgeTraversals', () => {
  it('[R42.1][R42.2][R42.3][R42.4] una conexión normal: lo enviado es la salida del origen y se une a la petición del destino', async () => {
    const d = diagram([ENTRY, agent('esp'), agent('dis'), OUTPUT], [edge('entry', 'esp'), edge('esp', 'dis'), edge('dis', 'output')]);
    const events = await run(d, { esp: { output: '## Especificación\n- reservar', files: ['specs/landing.md'] }, dis: { output: 'hecho' } });
    const [t, ...rest] = edgeTraversals(events, d.edges[1]!);
    expect(rest).toEqual([]);
    expect(t).toMatchObject({ n: 1, kind: 'output', state: 'finished', status: 'succeeded', pass: 1, combined: false });
    expect(t!.sent!.text).toContain('## Especificación\n- reservar');
    expect(t!.sent!.files).toEqual(['specs/landing.md']);
    expect(t!.received).toEqual(t!.sent);
    expect(t!.requests).toHaveLength(1);
    expect(t!.requests[0]).toMatchObject({ agentId: 'dis', attempt: 1, snapshot: { instructions: 'Eres dis' } });
    expect(typeof t!.ts).toBe('string');
  });

  it('[R42.3] con dos entradas, lo recibido junta ambas y se marca como combinado', async () => {
    const d = diagram(
      [ENTRY, agent('esp'), agent('inv'), agent('dis'), OUTPUT],
      [edge('entry', 'esp'), edge('entry', 'inv'), edge('esp', 'dis'), edge('inv', 'dis'), edge('dis', 'output')],
    );
    const events = await run(d, { esp: { output: 'spec' }, inv: { output: 'estudio' }, dis: { output: 'ok' } });
    const [t] = edgeTraversals(events, d.edges[2]!);
    expect(t!.sent!.text).toBe('spec');
    expect(t!.combined).toBe(true);
    expect(t!.received!.text).toContain('spec');
    expect(t!.received!.text).toContain('estudio');
  });

  it('[R42.2][R42.3] en el retorno de una revisión lo enviado es el motivo y cada vez es otra pasada', async () => {
    const rev: DiagramNode = { id: 'rev', kind: 'review', label: 'rev', review: { maxRounds: 3, mode: 'verdict' } };
    const d = diagram(
      [ENTRY, agent('dis'), agent('qa'), rev, OUTPUT],
      [edge('entry', 'dis'), edge('dis', 'qa'), edge('qa', 'rev'), edge('rev', 'output', 'approved'), edge('rev', 'dis', 'rejected'), { ...edge('rev', 'output', 'exhausted'), id: 'rev->output:x' }],
    );
    let qa = 0;
    const events = await run(d, { dis: { output: 'diseño' }, qa: { output: () => (++qa === 1 ? 'Falta contraste.\nVEREDICTO: RECHAZADO' : 'VEREDICTO: APROBADO') } });
    const back = edgeTraversals(events, d.edges[4]!);
    expect(back).toHaveLength(1);
    expect(back[0]).toMatchObject({ kind: 'return', pass: 2, combined: true, state: 'finished' });
    expect(back[0]!.received!.text).toContain('Correcciones pedidas');
    expect(back[0]!.sent!.text).toContain('Falta contraste.');
    // La conexión de entrada solo se recorrió una vez: la primera pasada.
    expect(edgeTraversals(events, d.edges[0]!).map((t) => t.pass)).toEqual([1]);
    // Dentro del destino, la vuelta queda unida a sus propias peticiones.
    expect(back[0]!.requests).toHaveLength(1);
  });

  it('[R42.3] el destino que aún no ha empezado está «waiting»; empezado y sin terminar, «running»', () => {
    const base = { runId: 'r', ts: '2026-11-05T16:00:00Z' };
    const ev = (seq: number, body: object): RunEvent => ({ ...base, seq, ...body }) as RunEvent;
    const events: RunEvent[] = [
      ev(1, { type: 'node.finished', nodeId: 'a', status: 'succeeded', output: { text: 'x', files: [] } }),
      ev(2, { type: 'edge.traversed', edgeId: 'a->b', fromNodeId: 'a', toNodeId: 'b' }),
    ];
    const e = { id: 'a->b', from: 'a', to: 'b' };
    expect(edgeTraversals(events, e)[0]).toMatchObject({ state: 'waiting', sent: { text: 'x' } });
    events.push(ev(3, { type: 'node.started', nodeId: 'b', input: { text: 'x', files: [] } }));
    expect(edgeTraversals(events, e)[0]).toMatchObject({ state: 'running', pass: 1, combined: false });
    // Otro nivel (dentro de un bucle) no se mezcla.
    events.push(ev(4, { type: 'edge.traversed', edgeId: 'a->b', fromNodeId: 'a', toNodeId: 'b', nodePath: ['loop'] }));
    expect(edgeTraversals(events, e)).toHaveLength(1);
    expect(edgeTraversals(events, e, ['loop'])).toHaveLength(1);
  });

  it('[R42.4] si el destino no es un agente no hay peticiones', async () => {
    const d = diagram([ENTRY, agent('esp'), OUTPUT], [edge('entry', 'esp'), edge('esp', 'output')]);
    const events = await run(d, { esp: { output: 'fin' } });
    const [t] = edgeTraversals(events, d.edges[1]!);
    expect(t!.requests).toEqual([]);
    expect(t!.sent!.text).toBe('fin');
  });
});

describe('SPEC-042 · requestKnowledge y tamaño', () => {
  it('[R42.5] lista skills, contextos y MCP con su origen; gana el más concreto', () => {
    const rows = requestKnowledge({
      snapshot: { skillIds: ['frontend-design', 'marca'], contextIds: ['publico'], mcpServers: ['figma'] },
      extra: { diagram: { contextIds: ['estilo', 'publico'] }, node: { skillIds: ['marca'] } },
    });
    expect(rows).toEqual([
      { kind: 'skill', id: 'frontend-design', origin: 'agent' },
      { kind: 'skill', id: 'marca', origin: 'node' },
      { kind: 'context', id: 'publico', origin: 'diagram' },
      { kind: 'context', id: 'estilo', origin: 'diagram' },
      { kind: 'mcp', id: 'figma', origin: 'agent' },
    ]);
    expect(requestKnowledge({})).toEqual([]);
  });

  it('[R42.6] el tamaño se da aproximado', () => {
    expect(approxTokensLabel('abcd'.repeat(105))).toBe('≈ 105 tokens');
    expect(approxTokensLabel('a'.repeat(7368))).toBe('≈ 1,8 k tokens');
  });
});
