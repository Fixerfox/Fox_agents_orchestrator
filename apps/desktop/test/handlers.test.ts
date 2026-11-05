import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CHANNELS, createDiagram, parseRequest } from '@orquestador/editor';
import { createDemoOrchestrator } from '@orquestador/runtime';
import { DesktopHandlers, scrubPaths } from '../src/main/handlers';

let dir: string;
let picks: (string | null)[];
let h: DesktopHandlers;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'orq-desktop-'));
  picks = [];
  h = new DesktopHandlers({ pickFolder: async () => picks.shift() ?? null, createOrchestrator: createDemoOrchestrator });
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const val = <T,>(r: { ok: boolean; value?: unknown }) => (r as { value: T }).value;

async function createProject(name = 'mi-proyecto') {
  const root = join(dir, name);
  picks.push(root);
  return h.invoke(CHANNELS.createProject, undefined);
}

describe('contrato IPC [R19.3]', () => {
  it('[R19.3] rechaza canales desconocidos y peticiones mal formadas con un error claro', async () => {
    expect(await h.invoke('fs:read', '/etc/passwd')).toMatchObject({ ok: false, error: { code: 'bad-request' } });
    expect(await h.invoke(CHANNELS.loadDiagram, { id: 'x' })).toMatchObject({ ok: false, error: { code: 'bad-request' } });
    expect(await h.invoke(CHANNELS.loadDiagram, '../fuera')).toMatchObject({ ok: false, error: { code: 'bad-request' } });
    expect(await h.invoke(CHANNELS.saveDiagram, { id: 'a' })).toMatchObject({ ok: false, error: { code: 'bad-request' } });
    expect(await h.invoke(CHANNELS.listDiagrams, { extra: 1 })).toMatchObject({ ok: false, error: { code: 'bad-request' } });
  });

  it('[R19.3] parseRequest acepta un diagrama bien formado y los canales sin argumentos', () => {
    const d = createDiagram('a', 'A');
    expect(parseRequest(CHANNELS.saveDiagram, d)).toBe(d);
    expect(parseRequest(CHANNELS.listDiagrams, undefined)).toBeUndefined();
    expect(parseRequest(CHANNELS.loadDiagram, 'ok-1')).toBe('ok-1');
  });

  it('[R19.3] hay un canal por operación y todos distintos', () => {
    const values = Object.values(CHANNELS);
    expect(new Set(values).size).toBe(values.length);
    expect(values).toHaveLength(Object.keys(CHANNELS).length);
  });
});

describe('operaciones sobre el proyecto [R19.4]', () => {
  it('[R19.4] crear proyecto (diálogo) deja la estructura .orquestador y devuelve su nombre', async () => {
    const res = await createProject('juego');
    expect(val<{ name: string }>(res)).toEqual({ name: 'juego' });
    expect((await stat(join(dir, 'juego', '.orquestador'))).isDirectory()).toBe(true);
  });

  it('[R19.4] cancelar el diálogo devuelve null sin error', async () => {
    expect(await h.invoke(CHANNELS.createProject, undefined)).toEqual({ ok: true, value: null });
    expect(await h.invoke(CHANNELS.openProject, undefined)).toEqual({ ok: true, value: null });
  });

  it('[R19.4] guardar, listar y cargar diagramas pasa por ProjectStore', async () => {
    await createProject();
    const d = createDiagram('principal', 'Principal');
    d.nodes[0]!.position = { x: 5, y: 6 };
    expect(await h.invoke(CHANNELS.saveDiagram, d)).toEqual({ ok: true, value: null });
    expect(val(await h.invoke(CHANNELS.listDiagrams, undefined))).toEqual([{ id: 'principal', name: 'Principal' }]);
    expect(val(await h.invoke(CHANNELS.loadDiagram, 'principal'))).toEqual(d);
  });

  it('[R19.4] el guardado es atómico y versionado (archivo JSON válido en .orquestador)', async () => {
    await createProject();
    await h.invoke(CHANNELS.saveDiagram, createDiagram('a', 'A'));
    const raw = JSON.parse(await readFile(join(dir, 'mi-proyecto', '.orquestador', 'diagrams', 'a.json'), 'utf8'));
    expect(raw.schemaVersion).toBe(1);
  });

  it('[R19.4] se rechazan secretos al guardar', async () => {
    await createProject();
    const d = createDiagram('a', 'A');
    d.nodes[0]!.label = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789';
    expect(await h.invoke(CHANNELS.saveDiagram, d)).toMatchObject({ ok: false, error: { code: 'secrets' } });
  });

  it('[R19.4] abrir un proyecto existente y listar las plantillas de ejemplo', async () => {
    await createProject('p1');
    picks.push(join(dir, 'p1'));
    expect(val<{ name: string }>(await h.invoke(CHANNELS.openProject, undefined)).name).toBe('p1');
    const ex = val<{ id: string }[]>(await h.invoke(CHANNELS.listExamples, undefined));
    expect(ex.map((e) => e.id)).toEqual(['enrutador', 'revision', 'paralelo', 'qa', 'spec-kit']);
  });

  it('[R19.4] abrir una carpeta que no es proyecto da un error claro', async () => {
    picks.push(dir);
    expect(await h.invoke(CHANNELS.openProject, undefined)).toMatchObject({ ok: false, error: { code: 'not-a-project' } });
  });
});

describe('un proyecto y sin rutas [R19.5]', () => {
  it('[R19.5] sin proyecto abierto no se puede listar, cargar ni guardar', async () => {
    for (const [c, p] of [
      [CHANNELS.listDiagrams, undefined],
      [CHANNELS.loadDiagram, 'a'],
      [CHANNELS.saveDiagram, createDiagram('a', 'A')],
    ] as const) {
      expect(await h.invoke(c, p)).toMatchObject({ ok: false, error: { code: 'not-found' } });
    }
  });

  it('[R19.5] abrir otro proyecto sustituye al anterior (máximo uno abierto)', async () => {
    await createProject('uno');
    await h.invoke(CHANNELS.saveDiagram, createDiagram('solo-en-uno', 'U'));
    await createProject('dos');
    expect(val(await h.invoke(CHANNELS.listDiagrams, undefined))).toEqual([]);
    expect(await h.invoke(CHANNELS.loadDiagram, 'solo-en-uno')).toMatchObject({ ok: false });
  });

  it('[R19.5] el renderer no puede salir de .orquestador con ids ni rutas', async () => {
    await createProject();
    await writeFile(join(dir, 'secreto.json'), '{"x":1}');
    for (const id of ['../../secreto', '..\\..\\secreto', '/etc/passwd', 'C:\\Windows\\win', 'a/b', '..']) {
      expect(await h.invoke(CHANNELS.loadDiagram, id)).toMatchObject({ ok: false, error: { code: 'bad-request' } });
      expect(await h.invoke(CHANNELS.saveDiagram, { ...createDiagram('a', 'A'), id })).toMatchObject({ ok: false });
    }
  });
});

describe('errores seguros [R19.6]', () => {
  it('[R19.6] los errores tienen forma {ok:false,error:{code,message}} y no incluyen rutas', async () => {
    const root = join(dir, 'p');
    picks.push(root);
    await h.invoke(CHANNELS.createProject, undefined);
    picks.push(root);
    const again = await h.invoke(CHANNELS.createProject, undefined);
    expect(again).toMatchObject({ ok: false, error: { code: 'exists' } });
    const text = JSON.stringify(again);
    expect(text).not.toContain(dir);
    expect(Object.keys((again as { error: object }).error).sort()).toEqual(['code', 'message']);
  });

  it('[R19.6] un fallo inesperado no filtra trazas ni mensajes internos', async () => {
    const boom = new DesktopHandlers({
      createOrchestrator: createDemoOrchestrator,
      pickFolder: async () => {
        throw new Error('fallo en /home/usuario/secreto.txt\n    at stack');
      },
    });
    const res = await boom.invoke(CHANNELS.createProject, undefined);
    expect(res).toEqual({ ok: false, error: { code: 'internal', message: 'Error interno' } });
  });

  it('[R19.6] scrubPaths oculta la raíz del proyecto y rutas absolutas ajenas', () => {
    expect(scrubPaths('No existe /home/u/proy/.orquestador/x.json', '/home/u/proy')).toBe('No existe <proyecto>/.orquestador/x.json');
    expect(scrubPaths('Error en C:\\Users\\yo\\datos.txt y /etc/passwd fin')).toBe('Error en <ruta> y <ruta> fin');
    expect(scrubPaths('sin rutas aquí')).toBe('sin rutas aquí');
  });
});
