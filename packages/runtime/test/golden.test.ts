import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { RunEvent } from '@orquestador/core';
import { goldenScenarios, type GoldenOrder } from './golden-scenarios';

const DIR = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures', 'golden');
/** Solo para crear una grabación que aún no existe; R56.6 prohíbe regrabar durante SPEC-056. */
const RECORD = process.env.GOLDEN_RECORD === '1';

type Normal = Record<string, unknown>;

/** Quita lo que cambia en cada ejecución: la hora y el número de secuencia (decisión 8). */
function normal(e: RunEvent): Normal {
  const rest: Normal = { ...e };
  delete rest.ts;
  delete rest.seq;
  return rest;
}

/** Quién emite un evento, para comparar por nodo en las ramas paralelas. */
function ownerOf(e: Normal): string {
  const id = e.nodeId ?? e.fromNodeId ?? e.loopId ?? '(ejecución)';
  return [...((e.nodePath as string[] | undefined) ?? []), id as string].join('/');
}

function shape(events: RunEvent[], order: GoldenOrder): unknown {
  const list = events.map(normal);
  if (order === 'global') return list;
  const byNode: Record<string, Normal[]> = {};
  for (const e of list) (byNode[ownerOf(e)] ??= []).push(e);
  return Object.fromEntries(Object.entries(byNode).sort(([a], [b]) => a.localeCompare(b)));
}

describe('SPEC-056 · grabación de referencia', () => {
  it('[R56.6] hay 14 casos, cada uno con su grabación', () => {
    const names = goldenScenarios().map((s) => s.name);
    expect(new Set(names).size).toBe(14);
    if (!RECORD) for (const n of names) expect(existsSync(join(DIR, `${n}.json`)), n).toBe(true);
  });

  for (const scenario of goldenScenarios()) {
    it(`[R56.6] ${scenario.name}: la secuencia normalizada es la grabada`, async () => {
      const runs = await scenario.play();
      for (const events of runs) expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i + 1));
      const actual = JSON.parse(JSON.stringify({ name: scenario.name, order: scenario.order, diagram: scenario.diagram, runs: runs.map((r) => shape(r, scenario.order)) })) as unknown;
      const file = join(DIR, `${scenario.name}.json`);
      if (RECORD && !existsSync(file)) writeFileSync(file, `${JSON.stringify(actual, null, 2)}\n`);
      expect(actual).toEqual(JSON.parse(readFileSync(file, 'utf8')));
    });
  }
});
