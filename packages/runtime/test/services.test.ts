import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MemoryLibrary, MemoryRunRepository, MemoryWorkspaceFiles, MockAgent, MockDecider, Orchestrator, memoryPathPolicy, type Diagram, type RunEvent } from '@orquestador/core';
import { RunError, RunSnapshots } from '../src';
import { RunControl } from '../src/run-control';
import { RunCorrections } from '../src/run-corrections';
import { RunFiles } from '../src/run-files';
import { RunHistory } from '../src/run-history';
import { RunLauncher } from '../src/run-launcher';
import { RunQueue } from '../src/run-queue';
import { LiveRuns } from '../src/run-types';

const D: Diagram = {
  id: 'd',
  name: 'D',
  schemaVersion: 1,
  nodes: [
    { id: 'entry', kind: 'entry' },
    { id: 'a', kind: 'agent', agentId: 'a', label: 'Analista' },
    { id: 'output', kind: 'output' },
  ],
  edges: [
    { id: 'e1', from: 'entry', to: 'a' },
    { id: 'e2', from: 'a', to: 'output' },
  ],
};

const gate = () => {
  let open!: () => void;
  const promise = new Promise<void>((r) => (open = r));
  return { promise, open };
};

function parts(agent = new MockAgent(), snapshots?: RunSnapshots) {
  const live = new LiveRuns();
  const runs = new MemoryRunRepository();
  const library = new MemoryLibrary();
  library.diagrams.set('d', D);
  let n = 0;
  const orchestrator = new Orchestrator({ getAdapter: () => agent, decider: new MockDecider(), newRunId: () => `run-${++n}` });
  const stepFiles: [string, string, string[]][] = [];
  const queue = new RunQueue(live, runs, orchestrator, snapshots, async (runId, key, files) => void stepFiles.push([runId, key, files]));
  const history = new RunHistory(live, runs, library);
  const launcher = new RunLauncher(runs, library, () => ({ maxConcurrency: 2 }), snapshots);
  return { live, runs, library, orchestrator, queue, history, launcher, control: new RunControl(live), stepFiles };
}

describe('SPEC-056 · RunQueue', () => {
  it('[R56.16] lanza, registra la ejecución y la marca terminada', async () => {
    const { queue, live, control } = parts();
    const run = queue.launch(D, 'x', {});
    expect(live.isRunning(run.handle.runId)).toBe(true);
    await control.settled(run.handle.runId);
    expect(live.isRunning(run.handle.runId)).toBe(false);
  });

  it('[R56.16] la cola de un diagrama arranca sola, en orden, cuando acaba la que corre', async () => {
    const hold = gate();
    const agent = new MockAgent({ a: { waitFor: hold.promise } });
    const { queue, live, control } = parts(agent);
    const first = queue.launch(D, 'primera', {});
    expect(queue.isBusy('d')).toBe(true);
    queue.enqueue({ diagram: D, order: 'segunda', options: {} }, 'segunda');
    queue.enqueue({ diagram: D, order: 'tercera', options: {} }, 'tercera');
    expect(queue.queued().map((q) => q.order)).toEqual(['segunda', 'tercera']);
    hold.open();
    await control.settled(first.handle.runId);
    await expect.poll(() => queue.queued().length).toBe(0);
    await expect.poll(() => live.running().length).toBe(0);
    expect(agent.calls.map((c) => c.input.text)).toEqual(['primera', 'segunda', 'tercera']);
  });

  it('[R56.16] quitar de la cola y vaciarla', () => {
    const { queue } = parts();
    const { queuedId } = queue.enqueue({ diagram: D, order: 'x', options: {} }, 'x');
    expect(queue.unqueue('otro')).toBe(false);
    expect(queue.unqueue(queuedId)).toBe(true);
    queue.enqueue({ diagram: D, order: 'y', options: {} }, 'y');
    queue.clear();
    expect(queue.queued()).toEqual([]);
    expect(queue.isBusy('d')).toBe(false);
  });

  it('[R56.16] guarda la copia mientras dura la ejecución y avisa de los archivos de los pasos que terminan bien', async () => {
    const snapshots = new RunSnapshots();
    const { queue, control, stepFiles } = parts(new MockAgent({ a: { files: ['a\\b.txt'] } }), snapshots);
    const snap = { agents: [], contexts: [], skills: [], mcp: [], templates: new Map() };
    const { handle } = queue.launch(D, 'x', {}, snap);
    expect(snapshots.get(handle.runId)).toBe(snap);
    await control.settled(handle.runId);
    expect(snapshots.size).toBe(0);
    expect(stepFiles).toEqual([[handle.runId, 'a', ['a/b.txt']]]);
  });
});

describe('SPEC-056 · RunLauncher', () => {
  it('[R56.16] prepara el diagrama, las opciones por defecto y el presupuesto', async () => {
    const { launcher } = parts();
    const p = await launcher.prepare({ diagramId: 'd', order: 'x', maxTokens: 5 });
    expect(p.diagram.id).toBe('d');
    expect(p.options).toEqual({ maxConcurrency: 2, budget: { maxTokens: 5 } });
    expect(p.order).toBe('x');
    expect(p.snapshot).toBeUndefined();
  });

  it('[R56.16] rechaza un diagrama inválido, un entregable malo y una entrada vacía', async () => {
    const { launcher, library } = parts();
    library.diagrams.set('mal', { ...D, id: 'mal', edges: [] });
    await expect(launcher.prepare({ diagramId: 'mal', order: 'x' })).rejects.toMatchObject({ code: 'invalid-diagram' });
    await expect(launcher.prepare({ diagramId: 'd', order: 'x', deliverable: { items: [] } })).rejects.toMatchObject({ code: 'bad-request' });
    await expect(launcher.prepare({ diagramId: 'd', order: '   ' })).rejects.toMatchObject({ code: 'bad-request' });
  });

  it('[R56.16] `deliverable: null` quita el entregable y la entrada lleva archivos y adjuntos sin repetir', async () => {
    const { launcher, runs } = parts();
    runs.projectFiles.set('a.md', 1);
    runs.attachments.set('adj', 'a.md');
    const p = await launcher.prepare({ diagramId: 'd', order: 'x', deliverable: null, files: ['a.md'], attachments: ['adj'] });
    expect(p.options.deliverable).toBeNull();
    expect(p.order).toEqual({ text: 'x', files: ['a.md'] });
  });

  it('[R56.16] pone tope a los archivos de entrada y traduce los errores del repositorio', async () => {
    const { launcher } = parts();
    const many = Array.from({ length: 21 }, (_, i) => `f${i}`);
    await expect(launcher.inputPayload({ order: 'x', files: many })).rejects.toThrow('Como mucho 20');
    await expect(launcher.inputPayload({ order: 'x', files: ['no-esta'] })).rejects.toBeInstanceOf(RunError);
  });

  it('[R56.16] hace la copia de la biblioteca solo si el servicio las usa', async () => {
    const withCopies = parts(new MockAgent(), new RunSnapshots());
    expect((await withCopies.launcher.prepare({ diagramId: 'd', order: 'x' })).snapshot).toBeDefined();
    expect(await parts().launcher.snapshotOf(D)).toBeUndefined();
  });
});

describe('SPEC-056 · RunControl', () => {
  it('[R56.16] pausa, reanuda y cancela la ejecución', async () => {
    const hold = gate();
    const { queue, control } = parts(new MockAgent({ a: { waitFor: hold.promise } }));
    const { handle } = queue.launch(D, 'x', {});
    control.pause(handle.runId);
    control.resume(handle.runId);
    control.cancel(handle.runId);
    const result = await handle.result;
    expect(result.status).toBe('cancelled');
    expect(result.reason).toBe('Cancelada por el usuario');
    expect(result.events.map((e) => e.type)).toEqual(expect.arrayContaining(['run.paused', 'run.resumed']));
  });

  it('[R56.16] responde a las preguntas pendientes', async () => {
    const { queue, control } = parts(new MockAgent({ a: { asks: [{ question: '¿Color?' }], output: (_r, a) => a[0]! } }));
    const { handle } = queue.launch(D, 'x', {});
    await expect.poll(() => control.pending(handle.runId).length).toBe(1);
    expect(control.answer(handle.runId, control.pending(handle.runId)[0]!.questionId, 'Azul')).toBe(true);
    expect((await handle.result).output?.text).toBe('Azul');
  });

  it('[R56.16] cancela todas las que están en marcha y no toca las terminadas', async () => {
    const hold = gate();
    const { queue, control } = parts(new MockAgent({ a: { waitFor: hold.promise } }));
    const one = queue.launch(D, 'x', {});
    const two = queue.launch(D, 'y', {});
    control.cancelAll();
    expect((await one.handle.result).reason).toBe('Proyecto cerrado');
    expect((await two.handle.result).status).toBe('cancelled');
  });

  it('[R56.16] una ejecución que no existe da error', () => {
    const { control } = parts();
    expect(() => control.pause('nada')).toThrow(RunError);
    expect(() => control.pending('nada')).toThrow('No existe esa ejecución en curso');
  });
});

describe('SPEC-056 · RunHistory', () => {
  it('[R56.16] lista, y lo que sigue vivo no sale como interrumpido', async () => {
    const hold = gate();
    const { queue, history, control } = parts(new MockAgent({ a: { waitFor: hold.promise } }));
    const { handle } = queue.launch(D, 'x', {});
    expect((await history.list())[0]!.status).toBe('running');
    expect(history.isFinished(handle.runId)).toBe(false);
    hold.open();
    await control.settled(handle.runId);
    expect((await history.list())[0]!.status).toBe('succeeded');
    expect(history.isFinished(handle.runId)).toBe(true);
  });

  it('[R56.16] se suscribe sin huecos ni duplicados', async () => {
    const hold = gate();
    const { queue, history, control } = parts(new MockAgent({ a: { waitFor: hold.promise } }));
    const { handle } = queue.launch(D, 'x', {});
    await expect.poll(() => handle.bus.history().some((e) => e.type === 'agent.request')).toBe(true);
    const live: RunEvent[] = [];
    const { backlog, unsubscribe } = await history.subscribe(handle.runId, 1, (e) => live.push(e));
    hold.open();
    await control.settled(handle.runId);
    unsubscribe();
    expect([...backlog, ...live].map((e) => e.seq)).toEqual(handle.bus.history().map((e) => e.seq));
  });

  it('[R56.16] se suscribe a una guardada leyendo el repositorio y valida `fromSeq`', async () => {
    const { runs, orchestrator, history } = parts();
    const { handle, logged } = runs.start(orchestrator, D, 'x', {});
    await logged;
    const { backlog } = await history.subscribe(handle.runId, 2, () => {});
    expect(backlog[0]!.seq).toBe(2);
    await expect(history.subscribe(handle.runId, 0, () => {})).rejects.toMatchObject({ code: 'bad-request' });
    await expect(history.subscribe('nada', 1, () => {})).rejects.toMatchObject({ code: 'not-found' });
  });

  it('[R56.16] el linaje sigue reanudaciones y correcciones, hasta 5 anteriores y sin ciclos', async () => {
    const { runs, orchestrator, history } = parts();
    const ids: string[] = [];
    for (let i = 0; i < 8; i++) {
      const { handle, logged } = runs.start(orchestrator, D, 'x', {});
      await logged;
      ids.push(handle.runId);
      if (i > 0) runs.runs.get(handle.runId)!.meta.resumedFrom = ids[i - 1]!;
    }
    expect(await history.lineage(ids[7]!)).toEqual([...ids].reverse().slice(0, 6));
    runs.runs.get(ids[0]!)!.meta.correctedFrom = ids[1]!;
    expect(await history.lineage(ids[1]!)).toEqual([ids[1], ids[0]]);
  });

  it('[R56.16] una terminada conserva diagrama, entrada y entregable; sin diagrama guardado usa la biblioteca', async () => {
    const { runs, orchestrator, history } = parts();
    const { handle, logged } = runs.start(orchestrator, D, 'mi pedido', { deliverable: { items: [{ kind: 'links' }] } });
    await logged;
    const past = await history.past(handle.runId);
    expect(past.order).toEqual({ text: 'mi pedido', files: [] });
    expect(past.deliverable).toEqual({ items: [{ kind: 'links' }] });
    await expect(history.past('nada')).rejects.toMatchObject({ code: 'not-found' });
  });

  it('[R56.16] no descarta una ejecución en marcha', async () => {
    const hold = gate();
    const { queue, history } = parts(new MockAgent({ a: { waitFor: hold.promise } }));
    const { handle } = queue.launch(D, 'x', {});
    await expect(history.dismiss(handle.runId)).rejects.toMatchObject({ code: 'bad-request' });
    handle.cancel();
    await handle.result;
  });
});

describe('SPEC-056 · RunCorrections', () => {
  function corrections(agent = new MockAgent()) {
    const p = parts(agent);
    return { ...p, fix: new RunCorrections(p.live, p.runs, p.orchestrator, p.history, p.launcher, p.queue) };
  }

  it('[R56.16] reanuda reutilizando lo terminado y lo anota; no reanuda dos veces', async () => {
    const hold = gate();
    const agent = new MockAgent({ a: { waitFor: hold.promise } });
    const { fix, queue, runs, control } = corrections(agent);
    const first = queue.launch(D, 'x', {});
    control.cancel(first.handle.runId);
    await control.settled(first.handle.runId);
    hold.open();
    const next = await fix.resumeRun(first.handle.runId);
    await control.settled(next.runId);
    expect(runs.runs.get(first.handle.runId)!.meta.resumedBy).toBe(next.runId);
    await expect(fix.resumeRun(first.handle.runId)).rejects.toThrow('ya se reanudó');
  });

  it('[R56.16] solo se reanuda lo que no acabó bien', async () => {
    const { fix, queue, control } = corrections();
    const { handle } = queue.launch(D, 'x', {});
    await control.settled(handle.runId);
    await expect(fix.resumeRun(handle.runId)).rejects.toThrow('Solo se reanuda');
    await expect(fix.resumeRun('nada')).rejects.toMatchObject({ code: 'not-found' });
  });

  it('[R56.16] propone el paso a corregir y exige que la ejecución haya terminado', async () => {
    const hold = gate();
    const { fix, queue, control } = corrections(new MockAgent({ a: { waitFor: hold.promise } }));
    const { handle } = queue.launch(D, 'x', {});
    await expect(fix.proposeCorrection(handle.runId, 'x')).rejects.toThrow('se corrige cuando termine');
    hold.open();
    await control.settled(handle.runId);
    const res = await fix.proposeCorrection(handle.runId, '  arregla  ');
    expect(res.candidates).toEqual([{ nodeId: 'a', label: 'Analista' }]);
    expect(res.proposal.nodeId).toBe('a');
  });

  it('[R56.16] corregir exige texto y un paso válido', async () => {
    const { fix, queue, control } = corrections();
    const { handle } = queue.launch(D, 'x', {});
    await control.settled(handle.runId);
    await expect(fix.correctRun(handle.runId, { text: '  ', nodeId: 'a' })).rejects.toThrow('Escribe qué hay que corregir');
    await expect(fix.correctRun(handle.runId, { text: 'x', nodeId: 'entry' })).rejects.toThrow('no se puede corregir');
  });

  it('[R56.16] la corrección lleva los archivos que se le añaden', async () => {
    const agent = new MockAgent();
    const { fix, queue, control, runs } = corrections(agent);
    runs.projectFiles.set('nota.md', 1);
    const { handle } = queue.launch(D, 'x', {});
    await control.settled(handle.runId);
    const next = await fix.correctRun(handle.runId, { text: 'mira esto', nodeId: 'a', files: ['nota.md'] });
    await control.settled(next.runId);
    expect(agent.calls.at(-1)!.input.files).toContain('nota.md');
  });
});

describe('SPEC-056 · RunFiles', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'orq-files-'));
  });
  afterEach(() => fs.rm(dir, { recursive: true, force: true }));

  function files() {
    const p = parts();
    const manifest = new MemoryWorkspaceFiles();
    p.runs.root = dir;
    p.runs.outputFolder = () => join(dir, 'output');
    const realFiles = { manifestOf: manifest.manifestOf.bind(manifest), resolveInside: (root: string, rel: string) => (rel.includes('..') ? (() => { throw new Error('fuera'); })() : join(root, rel)) };
    return { ...p, manifest, service: new RunFiles(p.live, p.runs, memoryPathPolicy, realFiles, p.history) };
  }
  const finished = async (p: ReturnType<typeof files>) => {
    const { handle, logged } = p.runs.start(p.orchestrator, D, 'x', {});
    await logged;
    return handle.runId;
  };

  it('[R56.16] la copia de un paso no incluye secretos y un fallo al copiar no rompe nada', async () => {
    const p = files();
    await p.service.snapshotStep('r', 'a', ['ok.txt', '.env']);
    expect(await p.runs.findPreview('r', 'a', 'ok.txt')).toBeDefined();
    expect(await p.runs.findPreview('r', 'a', '.env')).toBeUndefined();
    p.runs.workRoot = () => Promise.reject(new Error('sin carpeta'));
    await expect(p.service.snapshotStep('r', 'a', ['x'])).resolves.toBeUndefined();
  });

  it('[R56.16] la vista previa rechaza rutas no permitidas y ejecuciones que no existen', async () => {
    const p = files();
    await expect(p.service.previewFile('r', 'a', '.env')).rejects.toMatchObject({ code: 'bad-request' });
    await expect(p.service.previewFile('nada', 'a', 'a.txt')).rejects.toMatchObject({ code: 'not-found' });
  });

  it('[R56.16] sin copia ni registro del archivo, la vista previa dice que falta', async () => {
    const p = files();
    const runId = await finished(p);
    expect(await p.service.previewFile(runId, 'a', 'a.txt')).toEqual({ path: 'a.txt', kind: 'missing' });
  });

  it('[R56.16] clasifica la copia: texto, markdown y binario', async () => {
    const p = files();
    const runId = await finished(p);
    const put = async (name: string, data: string | Buffer) => {
      await fs.writeFile(join(dir, name), data);
      p.runs.previews.set(`${runId}|a|${name}`, join(dir, name));
    };
    await put('a.txt', 'hola');
    await put('b.md', '# t');
    await put('c.bin', Buffer.from([1, 0, 2]));
    expect(await p.service.previewFile(runId, 'a', 'a.txt')).toMatchObject({ kind: 'text', text: 'hola', source: 'run', truncated: false });
    expect((await p.service.previewFile(runId, 'a', 'b.md')).kind).toBe('markdown');
    expect((await p.service.previewFile(runId, 'a', 'c.bin')).kind).toBe('other');
  });

  it('[R56.16] busca la copia en la ejecución de la que viene', async () => {
    const p = files();
    const old = await finished(p);
    const next = await finished(p);
    p.runs.runs.get(next)!.meta.resumedFrom = old;
    await fs.writeFile(join(dir, 'a.txt'), 'x');
    p.runs.previews.set(`${old}|a|a.txt`, join(dir, 'a.txt'));
    expect(await p.service.locatePreview(next, 'a', 'a.txt')).toEqual({ abs: join(dir, 'a.txt'), source: 'previous', from: old });
  });

  it('[R56.16] un recurso de una web: solo con esquema propio, ejecución conocida y ruta permitida', async () => {
    const p = files();
    const runId = await finished(p);
    p.runs.previews.set(`${runId}|a|index.css`, '/copia/index.css');
    expect(await p.service.previewAsset(`orq-preview://run/${runId}/a/index.css`)).toBe('/copia/index.css');
    expect(await p.service.previewAsset(`orq-preview://run/${runId}/a/.env`)).toBeUndefined();
    expect(await p.service.previewAsset('orq-preview://run/nada/a/index.css')).toBeUndefined();
    expect(await p.service.previewAsset(`https://run/${runId}/a/index.css`)).toBeUndefined();
    expect(await p.service.previewAsset('esto no es una url')).toBeUndefined();
  });

  it('[R56.16] lista y lee la salida; rechaza rutas fuera y archivos que no existen', async () => {
    const p = files();
    const out = join(dir, 'output');
    await fs.mkdir(out);
    await fs.writeFile(join(out, 'b.md'), 'contenido');
    p.manifest.folders.set(out, new Map([['b.md', { size: 9 }], ['a.md', { size: 1 }]]));
    expect((await p.service.listOutput('r')).map((f) => f.path)).toEqual(['a.md', 'b.md']);
    expect(await p.service.readOutput('r', 'b.md')).toEqual({ text: 'contenido', truncated: false });
    await expect(p.service.readOutput('r', '../fuera')).rejects.toMatchObject({ code: 'bad-request' });
    await expect(p.service.readOutput('r', 'no.md')).rejects.toMatchObject({ code: 'not-found' });
  });
});

describe('SPEC-070 · lanzar', () => {
  it('[R70.19] «Si nadie responde» del lanzamiento sustituye al de Ajustes', async () => {
    const { launcher } = parts();
    const def = await launcher.prepare({ diagramId: 'd', order: 'x' });
    expect(def.options.unanswered).toBeUndefined();
    const run = await launcher.prepare({ diagramId: 'd', order: 'x', unanswered: { afterMinutes: 30, action: 'fallback' } });
    expect(run.options.unanswered).toEqual({ afterMinutes: 30, action: 'fallback' });
  });
});
