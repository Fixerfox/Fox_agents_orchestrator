import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Diagram, RunEvent } from '@orquestador/core';
import { CHANNELS, parseRequest } from '@orquestador/editor';
import { createDemoOrchestrator } from '@orquestador/runtime';
import { DesktopHandlers } from '../src/main/handlers';

let dir: string;
let h: DesktopHandlers;
let picks: string[][];

const flow: Diagram = {
  id: 'flujo',
  name: 'Flujo',
  schemaVersion: 1,
  nodes: [{ id: 'entry', kind: 'entry' }, { id: 'c', kind: 'agent', agentId: 'creador' }, { id: 'output', kind: 'output' }],
  edges: [{ id: 'e1', from: 'entry', to: 'c' }, { id: 'e2', from: 'c', to: 'output' }],
};
const val = <T,>(r: unknown) => {
  const x = r as { ok: boolean; value?: T; error?: { message: string } };
  if (!x.ok) throw new Error(x.error?.message);
  return x.value as T;
};
const err = (r: unknown) => (r as { ok: boolean; error?: { message: string } }).error?.message ?? '';

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'orq-in-'));
  picks = [];
  h = new DesktopHandlers({
    pickFolder: async () => join(dir, 'p'),
    pickInputFiles: async () => picks.shift() ?? null,
    createOrchestrator: createDemoOrchestrator,
    push: () => {},
    batchMs: 5,
  });
  await h.invoke(CHANNELS.createProject, undefined);
  await h.invoke(CHANNELS.saveDiagram, flow);
});
afterEach(async () => {
  h.dispose();
  await fs.rm(dir, { recursive: true, force: true });
});

async function entryInput(runId: string) {
  for (let i = 0; i < 100; i++) {
    const events = val<RunEvent[]>(await h.invoke(CHANNELS.subscribeRun, { runId, fromSeq: 1 }));
    const e = events.find((x): x is Extract<RunEvent, { type: 'node.started' }> => x.type === 'node.started' && x.nodeId === 'entry');
    if (e) return e.input!;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('sin entrada');
}

describe('SPEC-048 · adjuntos de la entrada por IPC', () => {
  it('[R48.6] los canales validan nombre, bytes y archivos; el texto puede ir vacío si hay archivos', () => {
    const data = new Uint8Array([1, 2, 3]);
    expect(parseRequest(CHANNELS.stageAttachment, { name: 'a.png', data })).toEqual({ name: 'a.png', data });
    expect(() => parseRequest(CHANNELS.stageAttachment, { name: 'a.png', data: new Uint8Array(0) })).toThrow(/vacío/);
    expect(() => parseRequest(CHANNELS.stageAttachment, { name: 'a.png', data: 'C:/x' })).toThrow();
    expect(() => parseRequest(CHANNELS.stageAttachment, { name: 'a.png', data, path: 'C:/x' })).toThrow(/no permitido/);
    expect(parseRequest(CHANNELS.startRun, { diagramId: 'd', order: '', files: ['docs/a.md'], attachments: ['abc-1'] })).toBeTruthy();
    expect(() => parseRequest(CHANNELS.startRun, { diagramId: 'd', order: '' })).toThrow(/order/);
    expect(() => parseRequest(CHANNELS.startRun, { diagramId: 'd', order: 'x', files: ['C:/secreto.txt'] })).toThrow(/files/);
    expect(() => parseRequest(CHANNELS.startRun, { diagramId: 'd', order: 'x', files: ['../fuera.txt'] })).toThrow(/files/);
    expect(() => parseRequest(CHANNELS.startRun, { diagramId: 'd', order: 'x', attachments: ['../x'] })).toThrow(/attachments/);
    expect(() => parseRequest(CHANNELS.startRun, { diagramId: 'd', order: 'x', files: Array.from({ length: 21 }, (_, i) => `f${i}.md`) })).toThrow(/20/);
    expect(parseRequest(CHANNELS.pickAttachments, undefined)).toBeUndefined();
    expect(parseRequest(CHANNELS.pickProjectFiles, undefined)).toBeUndefined();
  });

  it('[R48.6] arrastrar, «Adjuntar» y «Del proyecto…»: el renderer nunca recibe rutas absolutas y el agente recibe los archivos', async () => {
    const outside = join(dir, 'fuera.pdf');
    await fs.writeFile(outside, 'pdf');
    const project = join(dir, 'p');
    await fs.mkdir(join(project, 'docs'), { recursive: true });
    await fs.writeFile(join(project, 'docs', 'estilo.md'), '# estilo');
    const dropped = val<{ id: string; name: string; size: number; image: boolean }>(await h.invoke(CHANNELS.stageAttachment, { name: 'boceto.png', data: new Uint8Array([1, 2, 3, 4]) }));
    expect(dropped).toMatchObject({ name: 'boceto.png', size: 4, image: true });
    picks.push([outside]);
    const picked = val<{ id: string; name: string }[]>(await h.invoke(CHANNELS.pickAttachments, undefined));
    expect(picked).toEqual([expect.objectContaining({ name: 'fuera.pdf', size: 3, image: false })]);
    picks.push([join(project, 'docs', 'estilo.md')]);
    const own = val<{ path: string }[]>(await h.invoke(CHANNELS.pickProjectFiles, undefined));
    expect(own).toEqual([{ path: 'docs/estilo.md', size: 8, image: false }]);
    // Nada de lo que vuelve al renderer lleva la carpeta del usuario.
    expect(JSON.stringify([dropped, picked, own])).not.toContain(dir);
    // Fuera de la carpeta de trabajo, «Del proyecto…» lo rechaza.
    picks.push([outside]);
    expect(err(await h.invoke(CHANNELS.pickProjectFiles, undefined))).toMatch(/no está en la carpeta de trabajo/);
    // Cancelar el diálogo no hace nada.
    expect(val(await h.invoke(CHANNELS.pickAttachments, undefined))).toBeNull();

    const { runId } = val<{ runId: string }>(await h.invoke(CHANNELS.startRun, { diagramId: 'flujo', order: '', files: ['docs/estilo.md'], attachments: [dropped.id, picked[0]!.id] }));
    const input = await entryInput(runId);
    expect(input.text).toBe('');
    expect(input.files).toEqual(['docs/estilo.md', `.orquestador/attachments/${dropped.id}/boceto.png`, `.orquestador/attachments/${picked[0]!.id}/fuera.pdf`]);
    expect(await fs.readFile(join(project, '.orquestador', 'attachments', dropped.id, 'boceto.png'))).toEqual(Buffer.from([1, 2, 3, 4]));
  });
});
