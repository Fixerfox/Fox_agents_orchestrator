import { describe, expect, it } from 'vitest';
import type { RunEvent } from '@orquestador/core';
import { ASSISTANT_TOOLS, summarizeRun } from '../src';

let seq = 0;
const at = (s: number) => new Date(Date.UTC(2026, 10, 5, 12, 0, s)).toISOString();
const ev = (s: number, e: Record<string, unknown>) => ({ runId: 'r', seq: ++seq, ts: at(s), ...e }) as RunEvent;

describe('SPEC-038 · resumen de una ejecución', () => {
  it('[R38.23] cuenta cómo terminó, qué hizo cada paso, revisiones, preguntas y archivos', () => {
    const events = [
      ev(0, { type: 'run.started', diagramId: 'd' }),
      ev(0, { type: 'node.started', nodeId: 'entry', input: { text: 'un mundo nuevo', files: [] } }),
      ev(1, { type: 'node.started', nodeId: 'dis' }),
      ev(2, { type: 'agent.question', nodeId: 'dis', questionId: 'q1', text: '¿Estilo?' }),
      ev(3, { type: 'agent.answer', nodeId: 'dis', questionId: 'q1', text: 'Píxel' }),
      ev(4, { type: 'file.produced', nodeId: 'dis', path: 'mundo.md' }),
      ev(5, { type: 'node.finished', nodeId: 'dis', status: 'succeeded', output: { text: 'Diseño hecho', files: [] } }),
      ev(6, { type: 'node.started', nodeId: 'rev' }),
      ev(6, { type: 'review.decided', nodeId: 'rev', round: 1, max: 3, verdict: 'rejected', source: 'verdict', reason: 'faltan jefes', returnTo: 'dis' }),
      ev(7, { type: 'node.finished', nodeId: 'rev', status: 'succeeded' }),
      ev(8, { type: 'node.started', nodeId: 'dis' }),
      ev(9, { type: 'node.finished', nodeId: 'dis', status: 'succeeded', output: { text: 'Diseño con jefes', files: [] } }),
      ev(9, { type: 'node.started', nodeId: 'rev' }),
      ev(9, { type: 'review.decided', nodeId: 'rev', round: 2, max: 3, verdict: 'approved', source: 'verdict' }),
      ev(10, { type: 'node.finished', nodeId: 'rev', status: 'succeeded' }),
      ev(10, { type: 'agent.usage', nodeId: 'dis', inputTokens: 100, outputTokens: 50, costUsd: 0.01 }),
      ev(10, { type: 'node.finished', nodeId: 'output', status: 'succeeded', output: { text: '# Mundo', files: [] } }),
      ev(12, { type: 'run.finished', status: 'succeeded' }),
    ];
    const labels: Record<string, string> = { dis: 'Diseñador', rev: 'Revisión' };
    const s = summarizeRun(events, (id) => labels[id] ?? id);
    expect(s.headline).toBe('Terminada bien: 2 pasos hechos, 1 vuelta de revisión, 1 archivo creado o cambiado.');
    expect(s.input).toBe('un mundo nuevo');
    expect(s.finalOutput).toBe('# Mundo');
    expect(s.durationSec).toBe(12);
    expect(s.usage).toEqual({ inputTokens: 100, outputTokens: 50, costUsd: 0.01 });
    expect(s.steps.map((x) => [x.label, x.status, x.runs, x.output])).toEqual([
      ['Diseñador', 'succeeded', 2, 'Diseño con jefes'],
      ['Revisión', 'succeeded', 2, undefined],
    ]);
    expect(s.steps[0]!.files).toEqual(['mundo.md']);
    expect(s.reviews).toEqual([{ label: 'Revisión', round: 2, max: 3, verdict: 'approved' }]);
    expect(s.questions).toEqual([{ label: 'Diseñador', text: '¿Estilo?', answer: 'Píxel' }]);
  });

  it('[R38.23] si falla dice dónde y por qué; el texto largo se recorta', () => {
    const long = 'x'.repeat(50);
    const s = summarizeRun(
      [
        ev(0, { type: 'run.started', diagramId: 'd' }),
        ev(1, { type: 'node.started', nodeId: 'qa' }),
        ev(2, { type: 'error', nodeId: 'qa', message: 'Sin conexión', retriable: false }),
        ev(2, { type: 'node.finished', nodeId: 'qa', status: 'failed', output: { text: long, files: [] } }),
        ev(3, { type: 'run.finished', status: 'failed', reason: 'Un paso falló' }),
      ],
      undefined,
      10,
    );
    expect(s.headline).toBe('Falló en «qa»: Sin conexión');
    expect(s.failedAt).toBe('qa');
    expect(s.steps[0]!.output).toBe(`${'x'.repeat(10)}…`);
    expect(s.errors).toEqual([{ label: 'qa', message: 'Sin conexión' }]);
    // sin run.finished y marcada como interrumpida en la lista
    const cut = summarizeRun([ev(0, { type: 'run.started', diagramId: 'd' }), ev(1, { type: 'node.started', nodeId: 'a' })], undefined, 10, Date.now(), true);
    expect(cut.status).toBe('interrupted');
    expect(cut.headline).toMatch(/^Interrumpida/);
  });

  it('[R38.24] el asistente tiene list_runs y get_run, de solo lectura', () => {
    for (const n of ['list_runs', 'get_run']) expect(ASSISTANT_TOOLS.find((x) => x.name === n)).toMatchObject({ readOnly: true });
  });
});
