import { describe, expect, it } from 'vitest';
import type { EventBody, RunEvent } from '@orquestador/core';
import { auditCounts, auditEntries, auditReport, questionGroup, runFiles, runStory, runTimeline, stepFiles, storyClock, storyFilter } from '../src';

const T0 = Date.parse('2026-11-05T16:52:00.000Z');
let seq = 0;
const ev = (s: number, body: EventBody, nodePath?: string[]): RunEvent => ({ ...body, runId: 'r1', seq: ++seq, ts: new Date(T0 + s * 1000).toISOString(), ...(nodePath ? { nodePath } : {}) }) as RunEvent;

/** Spec Kit: el Especificador escribe la spec, pregunta, se confirma; el Planificador pide permisos; Revisión devuelve. */
function specKitRun(): RunEvent[] {
  seq = 0;
  return [
    ev(0, { type: 'run.started', diagramId: 'sk' }),
    ev(0, { type: 'node.started', nodeId: 'entry', input: { text: 'Landing para la beta', files: [] } }),
    ev(1, { type: 'node.finished', nodeId: 'entry', status: 'succeeded', output: { text: 'Landing para la beta', files: [] } }),
    ev(2, { type: 'node.started', nodeId: 'spec' }),
    ev(10, { type: 'tool.called', nodeId: 'spec', tool: 'Write', input: {} }),
    ev(12, { type: 'file.produced', nodeId: 'spec', path: 'specs/001/spec.md', change: 'created' }),
    ev(20, { type: 'agent.question', nodeId: 'spec', questionId: 'q-1', text: '¿Público objetivo?', options: ['Empresas'], kind: 'question' }),
    ev(50, { type: 'agent.answer', nodeId: 'spec', questionId: 'q-1', text: 'Equipos pequeños' }),
    ev(55, { type: 'file.produced', nodeId: 'spec', path: 'specs/001/spec.md', change: 'modified' }),
    ev(60, { type: 'agent.question', nodeId: 'spec', questionId: 'q-2', text: '## Resumen para confirmar\nHecho', options: ['Aprobar'], confirm: { round: 1 } }),
    ev(70, { type: 'agent.answer', nodeId: 'spec', questionId: 'q-2', text: 'Aprobar' }),
    ev(71, { type: 'node.finished', nodeId: 'spec', status: 'succeeded', output: { text: 'spec', files: ['specs/001/spec.md'] } }),
    ev(72, { type: 'node.started', nodeId: 'plan' }),
    // Pregunta de una ejecución anterior a R45.3: sin `kind`, se deduce del texto.
    ev(80, { type: 'agent.question', nodeId: 'plan', questionId: 'q-3', text: '¿Puedo modificar README.md?', options: ['Permitir', 'Permitir en esta ejecución', 'Denegar'] }),
    ev(90, { type: 'agent.answer', nodeId: 'plan', questionId: 'q-3', text: 'Permitir en esta ejecución' }),
    ev(91, { type: 'file.produced', nodeId: 'plan', path: 'README.md' }),
    ev(95, { type: 'agent.question', nodeId: 'plan', questionId: 'q-4', text: '¿Puedo ejecutar este comando?\nnpm test', options: ['Permitir', 'Denegar'], kind: 'permission' }),
    ev(100, { type: 'agent.answer', nodeId: 'plan', questionId: 'q-4', text: 'Denegar' }),
    ev(101, { type: 'run.paused' }),
    ev(110, { type: 'run.resumed' }),
    ev(120, { type: 'node.finished', nodeId: 'plan', status: 'succeeded', output: { text: 'plan', files: ['README.md'] } }),
    ev(121, { type: 'node.started', nodeId: 'rev' }),
    ev(125, { type: 'review.decided', nodeId: 'rev', round: 1, max: 2, verdict: 'rejected', source: 'verdict', reason: 'falta el estado vacío', returnTo: 'plan' }),
    ev(126, { type: 'node.finished', nodeId: 'rev', status: 'succeeded' }),
    ev(127, { type: 'node.started', nodeId: 'plan' }),
    ev(130, { type: 'file.produced', nodeId: 'plan', path: 'README.md', change: 'modified' }),
    ev(140, { type: 'agent.question', nodeId: 'plan', questionId: 'q-5', text: '¿Algo más?' }),
  ];
}

describe('SPEC-045 · ficheros de cada paso', () => {
  it('[R45.4] stepFiles da solo lo que tocó el paso, en orden, con su tipo, horas y pasadas; creado y retocado sigue siendo nuevo', () => {
    const events = specKitRun();
    expect(stepFiles(events, 'spec')).toEqual([{ path: 'specs/001/spec.md', change: 'created', firstTs: events[5]!.ts, lastTs: events[8]!.ts, passes: [1] }]);
    const plan = stepFiles(events, 'plan');
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ path: 'README.md', change: 'modified', passes: [1, 2] });
    expect(stepFiles(events, 'rev')).toEqual([]);
  });

  it('[R45.4] stepFiles distingue pasos con el mismo id dentro de contenedores', () => {
    seq = 0;
    const events = [ev(0, { type: 'node.started', nodeId: 'a' }, ['loop']), ev(1, { type: 'file.produced', nodeId: 'a', path: 'x.md', change: 'created' }, ['loop']), ev(2, { type: 'file.produced', nodeId: 'a', path: 'y.md' })];
    expect(stepFiles(events, 'loop/a').map((f) => f.path)).toEqual(['x.md']);
    expect(stepFiles(events, 'a')).toEqual([expect.objectContaining({ path: 'y.md', passes: [1] })]);
    expect(stepFiles(events, 'a')[0]!.change).toBeUndefined();
  });

  it('[R45.4] runFiles reúne los de la ejecución con sus pasos; sin tipo, modificado si hay copia y nuevo si no', () => {
    seq = 0;
    const events = [
      ev(0, { type: 'file.produced', nodeId: 'a', path: 'viejo.ts' }),
      ev(1, { type: 'file.produced', nodeId: 'a', path: 'nuevo.ts' }),
      ev(2, { type: 'file.produced', nodeId: 'b', path: 'viejo.ts', change: 'modified' }),
    ];
    const files = runFiles(events, ['viejo.ts', 'solo-copia.ts']);
    expect(files.map((f) => [f.path, f.change, f.steps.map((s) => s.key), f.backup])).toEqual([
      ['viejo.ts', 'modified', ['a', 'b'], true],
      ['nuevo.ts', 'created', ['a'], false],
      ['solo-copia.ts', 'modified', [], true],
    ]);
  });
});

describe('SPEC-055 · archivos cambiados por comandos', () => {
  it('[R55.5] runFiles marca lo que cambió un comando; sin copia, no se puede restaurar', () => {
    seq = 0;
    const events = [
      ev(0, { type: 'file.produced', nodeId: 'impl', path: '_raiz/test/index.html', change: 'created', via: 'command' }),
      ev(1, { type: 'file.produced', nodeId: 'impl', path: 'index.html', change: 'modified', via: 'command' }),
      ev(2, { type: 'file.produced', nodeId: 'impl', path: 'build.py', change: 'created' }),
    ];
    expect(runFiles(events).map((f) => [f.path, f.change, f.byCommand, f.backup])).toEqual([
      ['_raiz/test/index.html', 'created', true, false],
      ['index.html', 'modified', true, false],
      ['build.py', 'created', false, false],
    ]);
  });
});

describe('SPEC-045 · auditoría', () => {
  it('[R45.3] questionGroup usa el tipo de la pregunta y, sin él, lo deduce del texto', () => {
    expect(questionGroup({ text: 'x', kind: 'permission' })).toBe('permission');
    expect(questionGroup({ text: '¿Puedo modificar a.ts?' })).toBe('permission');
    expect(questionGroup({ text: '¿Puede usar «buscar» del servidor MCP «GitHub»?' })).toBe('permission');
    expect(questionGroup({ text: '«Dev» ha terminado sin consultarte. ¿Doy por bueno su resultado?' })).toBe('gate');
    expect(questionGroup({ text: 'Resumen', confirm: { round: 2 } })).toBe('confirm');
    expect(questionGroup({ text: '¿Puedo modificar a.ts?', kind: 'question' })).toBe('answer');
  });

  it('[R45.5] auditEntries reúne en orden entrada, respuestas, confirmaciones, permisos, pausas y lo que quedó sin responder', () => {
    const entries = auditEntries(specKitRun());
    expect(entries.map((e) => [e.key ?? '—', e.group, e.effect, e.answer])).toEqual([
      ['—', 'control', 'input', 'Landing para la beta'],
      ['spec', 'answer', 'answered', 'Equipos pequeños'],
      ['spec', 'confirm', 'approved', 'Aprobar'],
      ['plan', 'permission', 'allowed-run', 'Permitir en esta ejecución'],
      ['plan', 'permission', 'denied', 'Denegar'],
      ['—', 'control', 'paused', ''],
      ['—', 'control', 'resumed', ''],
      ['plan', 'answer', 'unanswered', ''],
    ]);
    expect(entries[2]!.asked).toBe('Confirmar antes de terminar · vuelta 1');
    expect(entries[4]!.asked).toBe('¿Puedo ejecutar este comando?\nnpm test');
    expect(auditCounts(entries)).toEqual({ all: 8, answer: 2, permission: 2, confirm: 1, control: 3 });
  });

  it('[R45.5] cancelaciones, límite de presupuesto (con su pausa) y supervisión', () => {
    seq = 0;
    const entries = auditEntries([
      ev(0, { type: 'node.started', nodeId: 'a' }),
      ev(1, { type: 'agent.question', nodeId: 'a', questionId: 'q-1', text: '«A» ha terminado sin consultarte. ¿Doy por bueno su resultado?', kind: 'gate' }),
      ev(2, { type: 'agent.answer', nodeId: 'a', questionId: 'q-1', text: 'Que lo rehaga' }),
      ev(3, { type: 'run.budget_reached', limit: 'cost', used: 2, max: 1 }),
      ev(3, { type: 'run.paused' }),
      ev(4, { type: 'run.cancelled', reason: 'basta' }),
    ]);
    expect(entries.map((e) => [e.group, e.effect])).toEqual([
      ['confirm', 'changes'],
      ['control', 'budget'],
      ['control', 'paused'],
      ['control', 'cancelled'],
    ]);
    expect(entries[2]!.asked).toMatch(/límite de presupuesto/);
    expect(entries[3]!.answer).toBe('basta');
  });

  it('[R45.6] auditReport compone el informe con cabecera, entrada, tabla de decisiones, ficheros por paso y final', () => {
    const md = auditReport(specKitRun(), { diagramName: 'Spec Kit', status: 'failed', reason: 'se cortó', startedAt: new Date(T0).toISOString(), durationS: 140, usage: { tokens: 1200, costUsd: 0.5 }, labelOf: (id) => ({ spec: 'Especificador', plan: 'Planificador técnico' })[id] ?? id });
    expect(md).toMatch(/^# Auditoría · Spec Kit\n/);
    expect(md).toContain('- **Estado:** Falló');
    expect(md).toContain('## Entrada\n\nLanding para la beta');
    expect(md).toContain('| Planificador técnico | ¿Puedo ejecutar este comando? npm test | Denegar | Denegado |');
    expect(md).toContain('- `specs/001/spec.md` · nuevo · Especificador');
    expect(md).toContain('- `README.md` · modificado · Planificador técnico');
    expect(md).toContain('## Cómo terminó\n\nFalló: se cortó');
    seq = 0;
    const empty = auditReport([ev(0, { type: 'run.started', diagramId: 'd' })], { diagramName: 'D', status: 'succeeded', finalOutput: 'Todo bien' });
    expect(empty).toContain('No hubo decisiones del usuario.');
    expect(empty).toContain('No se creó ni modificó ningún fichero.');
    expect(empty).toContain('Todo bien');
  });
});

describe('SPEC-045 · cronograma y relato', () => {
  it('[R45.7] runTimeline da esperas por pasada, ficheros y decisiones por paso y el tiempo total esperando', () => {
    const tl = runTimeline(specKitRun(), T0 + 150_000);
    const spec = tl.steps.find((s) => s.nodeId === 'spec')!;
    expect(spec.passes[0]!.waits.map((w) => [w.startS, w.endS])).toEqual([
      [20, 50],
      [60, 70],
    ]);
    expect(spec.files.map((f) => [f.atS, f.path, f.change])).toEqual([
      [12, 'specs/001/spec.md', 'created'],
      [55, 'specs/001/spec.md', 'modified'],
    ]);
    expect(spec.decisions.map((d) => [d.atS, d.question, d.answer])).toEqual([
      [50, '¿Público objetivo?', 'Equipos pequeños'],
      [70, '## Resumen para confirmar\nHecho', 'Aprobar'],
    ]);
    const plan = tl.steps.find((s) => s.nodeId === 'plan')!;
    // La última pregunta sigue abierta: su espera llega hasta ahora.
    expect(plan.passes[1]!.waits).toEqual([expect.objectContaining({ startS: 140, endS: 150 })]);
    expect(tl.waitS).toBe(30 + 10 + 10 + 5 + 10);
    expect(spec.passes[0]!.waits[0]!.leftPct).toBeCloseTo((20 / 150) * 100);
  });

  it('[R45.7] con la ejecución cerrada, una espera sin respuesta acaba con el paso', () => {
    const tl = runTimeline(specKitRun(), T0 + 999_000, { settled: true });
    const plan = tl.steps.find((s) => s.nodeId === 'plan')!;
    expect(plan.passes[1]!.waits[0]!.endS).toBe(140);
  });

  it('[R45.8] runStory cuenta la ejecución en orden con quién, qué, clase y paso; storyFilter filtra', () => {
    const story = runStory(specKitRun(), (id) => ({ spec: 'Especificador', plan: 'Planificador técnico', rev: 'Revisión' })[id] ?? id);
    const texts = story.map((l) => `${storyClock(l.atS)} ${l.who}: ${l.text}`);
    expect(texts).toEqual([
      '0:00 Tú: Lanzaste la ejecución con: «Landing para la beta»',
      '0:02 Especificador: Empezó',
      '0:10 Especificador: Usó Write',
      '0:12 Especificador: Creó specs/001/spec.md',
      '0:20 Especificador: Preguntó: «¿Público objetivo?»',
      '0:50 Tú: Respondiste «Equipos pequeños»',
      '0:55 Especificador: Modificó specs/001/spec.md',
      '1:00 Especificador: Pide que confirmes lo que ha hecho',
      '1:10 Tú: Aprobado («Aprobar»)',
      '1:11 Especificador: Terminó',
      '1:12 Planificador técnico: Empezó',
      '1:20 Planificador técnico: Pide permiso: «¿Puedo modificar README.md?»',
      '1:30 Tú: Permitido en la ejecución («Permitir en esta ejecución»)',
      '1:31 Planificador técnico: Tocó README.md',
      '1:35 Planificador técnico: Pide permiso: «¿Puedo ejecutar este comando? npm test»',
      '1:40 Tú: Denegado («Denegar»)',
      '1:41 Tú: Pausaste la ejecución',
      '1:50 Tú: Reanudaste la ejecución',
      '2:00 Planificador técnico: Terminó',
      '2:01 Revisión: Empezó',
      '2:05 Revisión: Rechazó: «falta el estado vacío» → vuelve a Planificador técnico',
      '2:06 Revisión: Terminó',
      '2:07 Planificador técnico: Empezó (pasada 2)',
      '2:10 Planificador técnico: Modificó README.md',
      '2:20 Planificador técnico: Preguntó: «¿Algo más?»',
    ]);
    expect(story.find((l) => l.text.startsWith('Respondiste'))).toMatchObject({ whoKind: 'user', cls: 'decision', key: 'spec' });
    expect(story[0]!.key).toBeUndefined();
    const noTools = storyFilter(story, new Set(['step', 'file', 'decision']));
    expect(noTools.some((l) => l.cls === 'tool')).toBe(false);
    expect(noTools).toHaveLength(story.length - 1);
    expect(storyClock(3725)).toBe('1:02:05');
  });
});
