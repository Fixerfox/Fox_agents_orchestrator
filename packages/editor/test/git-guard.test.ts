import { describe, expect, it } from 'vitest';
import type { RunEvent } from '@orquestador/core';
import { CHANNELS, EditorError, EditorSession, createDiagram, parseRequest, summarizeRun, t } from '../src';

const P = { x: 0, y: 0 };
const node = (s: EditorSession, id: string) => s.getSnapshot().level.nodes.find((n) => n.id === id)!;
const ev = (seq: number, body: object) => ({ runId: 'r', seq, ts: `2026-11-11T09:00:0${seq}.000Z`, ...body }) as RunEvent;

describe('SPEC-097 · la guarda de rama en el editor', () => {
  it('[R97.15] startRun admite la elección de rama bien formada y rechaza la que no lo está', () => {
    const base = { diagramId: 'd', order: 'x' };
    expect(parseRequest(CHANNELS.startRun, { ...base, git: { mode: 'stay' } })).toMatchObject({ git: { mode: 'stay' } });
    const fresh = { mode: 'new', name: 'orq/a', from: 'here' };
    expect(parseRequest(CHANNELS.startRun, { ...base, git: fresh })).toMatchObject({ git: fresh });
    expect(parseRequest(CHANNELS.startRun, { ...base, git: { ...fresh, from: 'develop', changes: 'stash' } })).toMatchObject({ git: { changes: 'stash' } });
    for (const bad of ['stay', { mode: 'otro' }, { mode: 'stay', name: 'x' }, { mode: 'new', name: 'a b', from: 'here' }, { mode: 'new', name: '--force', from: 'here' }, { mode: 'new', name: 'a', from: '-b' }, { mode: 'new', name: 'a' }, { ...fresh, changes: 'tirar' }, { ...fresh, path: '/etc' }, null]) {
      expect(() => parseRequest(CHANNELS.startRun, { ...base, git: bad })).toThrow(/git no válido/);
    }
  });

  it('[R97.15] gitGuard solo admite el id del diagrama', () => {
    expect(parseRequest(CHANNELS.gitGuard, { diagramId: 'd' })).toEqual({ diagramId: 'd' });
    for (const bad of [undefined, 'd', {}, { diagramId: '../x' }, { diagramId: 'd', path: '/' }]) expect(() => parseRequest(CHANNELS.gitGuard, bad)).toThrow();
  });

  it('[R97.13] «Este paso gestiona ramas» se pone y se quita en un paso de agente, y en otro tipo de paso no vale', () => {
    const s = new EditorSession(createDiagram('d', 'D'));
    const id = s.addNode({ kind: 'agent', agentId: 'pr', position: P });
    s.updateNode(id, { ownsBranch: true });
    expect(node(s, id).ownsBranch).toBe(true);
    s.updateNode(id, { ownsBranch: false });
    expect(node(s, id)).not.toHaveProperty('ownsBranch');
    expect(s.undo()).toBe(true);
    expect(node(s, id).ownsBranch).toBe(true);
    const r = s.addNode({ kind: 'router', position: P });
    expect(() => s.updateNode(r, { ownsBranch: true })).toThrow(EditorError);
    expect(t('problem.node-ownsbranch-not-agent', { node: 'R' })).toContain('solo los pasos de agente pueden gestionar ramas');
  });

  it('[R97.11] el resumen lleva la rama y el commit con los que empezó, y si la rama se creó o se apartaron cambios', () => {
    const base = [ev(1, { type: 'run.started', diagramId: 'd' }), ev(3, { type: 'run.finished', status: 'succeeded' })];
    expect(summarizeRun(base).git).toBeUndefined();
    const s = summarizeRun([base[0]!, ev(2, { type: 'run.git', branch: 'orq/a', commit: 'abc1234', created: true, from: 'main', stash: 'orquestador: D' }), base[1]!]);
    expect(s.git).toEqual({ branch: 'orq/a', commit: 'abc1234', created: true, from: 'main', stash: 'orquestador: D' });
    expect(summarizeRun([base[0]!, ev(2, { type: 'run.git', branch: 'feature/x', dirty: 3 }), base[1]!]).git).toEqual({ branch: 'feature/x', dirty: 3 });
  });
});
