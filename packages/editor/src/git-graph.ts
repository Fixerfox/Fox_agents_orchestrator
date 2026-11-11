import type { GitCommit } from '@orquestador/core';

/** Una fila del grafo de commits: en qué carril va y qué líneas la cruzan [R98.5]. */
export interface GraphRow {
  sha: string;
  /** Carril del commit, desde 0. */
  lane: number;
  /** Carriles que llegan al commit desde arriba (sus hijos). */
  from: number[];
  /** Carriles por los que sale hacia abajo, uno por padre. */
  to: number[];
  /** Carriles que pasan de largo. */
  pass: number[];
}

export interface CommitGraph {
  rows: GraphRow[];
  /** Carriles que hacen falta para dibujarlo. */
  lanes: number;
}

/**
 * Reparte los commits (del más nuevo al más viejo) en carriles, como `git log --graph` [R98.5]. Pura.
 * Cada carril espera a un commit; al llegar, sigue por su primer padre y abre carriles para los demás.
 */
export function commitGraph(commits: readonly GitCommit[]): CommitGraph {
  const waiting: (string | undefined)[] = [];
  const rows: GraphRow[] = [];
  let lanes = 0;
  const free = () => {
    const i = waiting.indexOf(undefined);
    return i >= 0 ? i : waiting.length;
  };
  for (const c of commits) {
    const from = waiting.flatMap((sha, i) => (sha === c.sha ? [i] : []));
    const lane = from[0] ?? free();
    for (const i of from) waiting[i] = undefined;
    const to: number[] = [];
    c.parents.forEach((parent, n) => {
      const known = waiting.indexOf(parent);
      // El primer padre sigue por el carril del commit; los demás van al carril que ya lo espera o abren uno.
      const target = known >= 0 ? known : n === 0 ? lane : free();
      waiting[target] = parent;
      if (!to.includes(target)) to.push(target);
    });
    const pass = waiting.flatMap((sha, i) => (sha !== undefined && i !== lane && !to.includes(i) ? [i] : []));
    while (waiting.length > 0 && waiting[waiting.length - 1] === undefined) waiting.pop();
    lanes = Math.max(lanes, lane + 1, ...to.map((t) => t + 1), ...pass.map((p) => p + 1), ...from.map((f) => f + 1));
    rows.push({ sha: c.sha, lane, from, to, pass });
  }
  return { rows, lanes };
}
