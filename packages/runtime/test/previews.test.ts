import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { portsOf } from './ports';
import { MockAgent, MockDecider, Orchestrator, type Diagram } from '@orquestador/core';
import { ProjectStore, encodeStepKey, previewDir, relativeAssets, snapshotStep } from '@orquestador/store';
import { RunService } from '../src';

/** Entrada → Implementador → Salida. */
const D: Diagram = {
  id: 'web',
  name: 'Web',
  schemaVersion: 1,
  nodes: [
    { id: 'entry', kind: 'entry' },
    { id: 'imp', kind: 'agent', agentId: 'imp', label: 'Implementador' },
    { id: 'output', kind: 'output' },
  ],
  edges: [
    { id: 'e1', from: 'entry', to: 'imp' },
    { id: 'e2', from: 'imp', to: 'output' },
  ],
};
const HTML = '<link rel="stylesheet" href="css/site.css"><script src="./app.js"></script><img src="img/hero.png"><a href="https://fuera.example/">x</a><img src="/abs.png"><img src="../../fuera.png">';
let dir: string;
let store: ProjectStore;
const write = async (rel: string, data: string | Buffer) => {
  await fs.mkdir(join(dir, ...rel.split('/').slice(0, -1)), { recursive: true });
  await fs.writeFile(join(dir, ...rel.split('/')), data);
};
beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'orq-prev-'));
  store = await ProjectStore.create(dir, { name: 'p' });
  await store.diagrams.save(D);
  await write('web/index.html', HTML);
  await write('web/css/site.css', 'body { background: url("../img/fondo.png") }');
  await write('web/app.js', 'console.log(1)');
  await write('web/img/hero.png', Buffer.from([137, 80, 78, 71]));
  await write('web/img/fondo.png', Buffer.from([137, 80, 78, 71, 1]));
  await write('docs/plan.md', '# Plan');
  await write('.env', 'SECRETO=1');
});
afterEach(() => fs.rm(dir, { recursive: true, force: true }));

function service(files: string[]) {
  const agent = new MockAgent({ imp: { output: 'hecho', files } });
  return new RunService(portsOf(store), new Orchestrator({ getAdapter: () => agent, decider: new MockDecider() }));
}

describe('SPEC-054 · copia por ejecución y vista previa', () => {
  it('[R54.3] los recursos relativos de una web y de su CSS se resuelven desde su carpeta; lo externo o absoluto no', () => {
    expect(relativeAssets(HTML, 'web/index.html').sort()).toEqual(['web/app.js', 'web/css/site.css', 'web/img/hero.png']);
    expect(relativeAssets('a { background: url(../img/fondo.png?v=2#x) }', 'web/css/site.css')).toEqual(['web/img/fondo.png']);
    expect(encodeStepKey('bucle/a b')).toBe('bucle~a%20b');
  });

  it('[R54.3] al terminar bien un paso se copia lo que hizo con lo que enlaza; los secretos no; hay tope de tamaño', async () => {
    const svc = service(['web/index.html', 'docs/plan.md', '.env', 'no-existe.txt']);
    const { runId } = await svc.start({ diagramId: 'web', order: 'haz la web' });
    await svc.settled(runId);
    const copy = previewDir(store.paths.runDir(runId), 'imp');
    for (const rel of ['web/index.html', 'web/css/site.css', 'web/app.js', 'web/img/hero.png', 'web/img/fondo.png', 'docs/plan.md']) {
      expect(await fs.readFile(join(copy, ...rel.split('/')))).toEqual(await fs.readFile(join(dir, ...rel.split('/'))));
    }
    await expect(fs.access(join(copy, '.env'))).rejects.toThrow();
    const small = await snapshotStep({ runDir: join(dir, 'x'), workRoot: dir, key: 'imp', files: ['web/index.html', 'docs/plan.md'], maxBytes: HTML.length + 2 });
    expect(small.copied).toEqual(['web/index.html']);
    expect(small.skipped).toContain('docs/plan.md');
  });

  it('[R54.4] previewFile: imagen como datos, Markdown como texto, web por el protocolo; la copia no cambia aunque cambie la carpeta', async () => {
    const svc = service(['web/index.html', 'docs/plan.md', 'web/img/hero.png']);
    const { runId } = await svc.start({ diagramId: 'web', order: 'haz la web' });
    await svc.settled(runId);
    await write('docs/plan.md', '# Plan cambiado después');
    expect(await svc.previewFile(runId, 'imp', 'docs/plan.md')).toMatchObject({ kind: 'markdown', text: '# Plan', source: 'run', fromRunId: runId });
    expect(await svc.previewFile(runId, 'imp', 'web/img/hero.png')).toMatchObject({ kind: 'image', dataUrl: 'data:image/png;base64,iVBORw==' });
    const web = await svc.previewFile(runId, 'imp', 'web/index.html');
    expect(web).toMatchObject({ kind: 'html', url: `orq-preview://run/${runId}/imp/web/index.html` });
    // El protocolo sirve la copia y lo que enlaza, y nada de fuera.
    expect(await svc.previewAsset(`orq-preview://run/${runId}/imp/web/css/site.css`)).toBe(await fs.realpath(join(previewDir(store.paths.runDir(runId), 'imp'), 'web', 'css', 'site.css')));
    expect(await svc.previewAsset(`orq-preview://run/${runId}/imp/web/../../../.env`)).toBeUndefined();
    expect(await svc.previewAsset(`orq-preview://run/${runId}/imp/.env`)).toBeUndefined();
    expect(await svc.previewAsset(`orq-preview://run/otra/imp/web/index.html`)).toBeUndefined();
    expect(await svc.previewAsset(`https://fuera.example/x`)).toBeUndefined();
    expect(await svc.previewFile(runId, 'imp', 'nada.md')).toEqual({ path: 'nada.md', kind: 'missing' });
    await expect(svc.previewFile(runId, 'imp', '../fuera.md')).rejects.toMatchObject({ code: 'bad-request' });
    await expect(svc.previewFile(runId, 'imp', '.env')).rejects.toMatchObject({ code: 'bad-request' });
    await expect(svc.previewFile('nope', 'imp', 'docs/plan.md')).rejects.toMatchObject({ code: 'not-found' });
  });

  it('[R54.4] un paso reutilizado enseña la copia de la ejecución de la que viene; sin copia, la carpeta si la ejecución lo tocó', async () => {
    const svc = service(['docs/plan.md']);
    const first = await svc.start({ diagramId: 'web', order: 'haz la web' });
    await svc.settled(first.runId);
    const fixed = await svc.correctRun(first.runId, { text: 'otra cosa', nodeId: 'imp' });
    await svc.settled(fixed.runId);
    expect((await svc.previewFile(fixed.runId, 'imp', 'docs/plan.md')).source).toBe('run');
    // Sin copia (como una ejecución anterior a esta spec): se lee la carpeta tal como está.
    await fs.rm(previewDir(store.paths.runDir(first.runId), 'imp'), { recursive: true, force: true });
    await write('docs/plan.md', '# Ahora');
    expect(await svc.previewFile(first.runId, 'imp', 'docs/plan.md')).toMatchObject({ source: 'live', text: '# Ahora' });
    expect(await svc.previewAsset(`orq-preview://live/${first.runId}/web/app.js`)).toBe(await fs.realpath(join(dir, 'web', 'app.js')));
    expect(await svc.previewAsset(`orq-preview://live/${first.runId}/.env`)).toBeUndefined();
    expect(await svc.previewAsset(`orq-preview://live/${first.runId}/.orquestador/project.json`)).toBeUndefined();
  });
});
