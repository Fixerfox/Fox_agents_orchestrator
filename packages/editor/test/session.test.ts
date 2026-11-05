import { describe, expect, it, vi } from 'vitest';
import { validateDiagram } from '@orquestador/core';
import { EditorSession, History, agentUsage, createDiagram, exampleTemplates, instantiateTemplate } from '../src';

const P = { x: 0, y: 0 };
const session = () => new EditorSession(createDiagram('d', 'Demo'));

describe('historial [R14.4]', () => {
  it('[R14.4] deshacer y rehacer; una acción nueva descarta el rehacer', () => {
    const h = new History(1);
    h.push(2);
    h.push(3);
    expect(h.undo()).toBe(true);
    expect(h.present).toBe(2);
    expect(h.canRedo).toBe(true);
    h.push(9);
    expect(h.canRedo).toBe(false);
    expect(h.redo()).toBe(false);
    expect(h.undo() && h.undo()).toBe(true);
    expect(h.present).toBe(1);
    expect(h.undo()).toBe(false);
  });

  it('[R14.4] sin límite de pasos', () => {
    const h = new History(0);
    for (let i = 1; i <= 5000; i++) h.push(i);
    let n = 0;
    while (h.undo()) n++;
    expect(n).toBe(5000);
    expect(h.present).toBe(0);
  });

  it('[R14.4] un arrastre completo es un solo paso', () => {
    const s = session();
    const id = s.addNode({ kind: 'agent', agentId: 'a', position: P });
    s.moveNode(id, { x: 50, y: 50 });
    expect(s.undo()).toBe(true);
    expect(s.getSnapshot().level.nodes.find((n) => n.id === id)!.position).toEqual(P);
    expect(s.undo()).toBe(true);
    expect(s.getSnapshot().level.nodes.some((n) => n.id === id)).toBe(false);
  });
});

describe('guardado [R14.5]', () => {
  it('[R14.5] dirty se activa al editar, se limpia al guardar y al deshacer hasta lo guardado', () => {
    const s = session();
    expect(s.getSnapshot().dirty).toBe(false);
    s.addNode({ kind: 'router', position: P });
    expect(s.getSnapshot().dirty).toBe(true);
    s.markSaved();
    expect(s.getSnapshot().dirty).toBe(false);
    s.addNode({ kind: 'router', position: P });
    expect(s.getSnapshot().dirty).toBe(true);
    s.undo();
    expect(s.getSnapshot().dirty).toBe(false);
    s.undo();
    expect(s.getSnapshot().dirty).toBe(true);
  });

  it('[R14.5] el diagrama sobrevive a un viaje por JSON con posiciones', () => {
    const s = session();
    const id = s.addNode({ kind: 'loop', position: { x: 7, y: 8 } });
    s.enter(id);
    s.addNode({ kind: 'agent', agentId: 'q', position: { x: 3, y: 4 } });
    const copy = JSON.parse(JSON.stringify(s.diagram));
    expect(copy).toEqual(s.diagram);
    const t = new EditorSession(copy);
    expect(t.getSnapshot().diagram.nodes.find((n) => n.id === id)!.position).toEqual({ x: 7, y: 8 });
  });

  it('[R14.5] load vacía el historial, la ruta y el estado sucio', () => {
    const s = session();
    s.addNode({ kind: 'router', position: P });
    s.load(createDiagram('otro', 'Otro'));
    const snap = s.getSnapshot();
    expect(snap).toMatchObject({ dirty: false, canUndo: false, canRedo: false, path: [] });
    expect(snap.diagram.id).toBe('otro');
  });
});

describe('validación [R14.3]', () => {
  it('[R14.3] asocia el problema a su nodo y está en español', () => {
    const s = session();
    const id = s.addNode({ kind: 'agent', agentId: 'a', position: P });
    const snap = s.getSnapshot();
    expect(snap.problems.runnable).toBe(false);
    expect(snap.problems.byNode[id]?.[0]).toMatch(/no está conectado/);
  });

  it('[R14.3] sin problemas se puede ejecutar', () => {
    const s = session();
    expect(s.getSnapshot().problems).toMatchObject({ runnable: true, count: 0 });
  });

  it('[R14.3] un problema dentro de un bucle señala al nodo bucle', () => {
    const s = session();
    const loop = s.addNode({ kind: 'loop', position: P });
    s.enter(loop);
    s.addNode({ kind: 'agent', agentId: 'a', position: P }); // sin conectar dentro del bucle
    s.up();
    const snap = s.getSnapshot();
    expect(snap.problems.runnable).toBe(false);
    expect(snap.problems.byNode[loop]?.[0]).toMatch(/Dentro de/);
    const first = snap.problems.all[0]!;
    expect(first.path).toEqual([loop]);
    expect(first.where).toBe('Bucle');
  });

  it('[R14.3] los problemas se recalculan tras cada cambio', () => {
    const s = session();
    const id = s.addNode({ kind: 'agent', agentId: 'a', position: P });
    s.connect('entry', id);
    s.connect(id, 'output');
    s.removeSelection({ edges: ['entry->output'] });
    expect(s.getSnapshot().problems.runnable).toBe(true);
  });
});

describe('selección y rechazos [R14.1][R14.6]', () => {
  it('[R14.1] removeSelection borra en un solo paso e ignora entrada y salida', () => {
    const s = session();
    const a = s.addNode({ kind: 'agent', agentId: 'a', position: P });
    const r = s.removeSelection({ nodes: [a, 'entry', 'output', 'fantasma'], edges: ['entry->output'] });
    expect(r.removedNodes).toEqual([a]);
    expect(r.skipped).toEqual(['entry', 'output']);
    expect(r.removedEdges).toEqual(['entry->output']);
    s.undo();
    const snap = s.getSnapshot();
    expect(snap.level.edges).toHaveLength(1);
    expect(snap.level.nodes.some((n) => n.id === a)).toBe(true);
  });

  it('[R14.1] borrar sin nada que borrar no ensucia el historial', () => {
    const s = session();
    s.removeSelection({ nodes: ['entry'] });
    expect(s.getSnapshot()).toMatchObject({ canUndo: false, dirty: false });
  });

  it('[R14.6] tryConnect devuelve el motivo sin cambiar el diagrama', () => {
    const s = session();
    const before = s.diagram;
    const res = s.tryConnect('entry', 'entry');
    expect(res).toMatchObject({ ok: false, code: 'self-edge' });
    expect(s.diagram).toBe(before);
    expect(s.tryConnect('entry', 'output')).toMatchObject({ ok: false, code: 'duplicate-edge' });
  });
});

describe('navegación por bucles [R14.8]', () => {
  it('[R14.8] entrar, migas de pan, subir e ir a una miga; anidado', () => {
    const s = session();
    const a = s.addNode({ kind: 'loop', label: 'Externo', position: P });
    s.enter(a);
    const b = s.addNode({ kind: 'loop', label: 'Interno', position: P });
    s.enter(b);
    const snap = s.getSnapshot();
    expect(snap.path).toEqual([a, b]);
    expect(snap.crumbs.map((c) => c.label)).toEqual(['Demo', 'Externo', 'Interno']);
    s.up();
    expect(s.getSnapshot().path).toEqual([a]);
    s.enter(b);
    s.goTo([]);
    expect(s.getSnapshot().path).toEqual([]);
    expect(() => s.enter('entry')).toThrow(/bucle/);
    expect(() => s.enter('nope')).toThrow();
  });

  it('[R14.8] si el bucle actual desaparece (deshacer) la ruta se recorta', () => {
    const s = session();
    const a = s.addNode({ kind: 'loop', position: P });
    s.enter(a);
    s.undo();
    expect(s.getSnapshot().path).toEqual([]);
  });

  it('[R14.8] las ediciones dentro del bucle van al historial y afectan al cuerpo', () => {
    const s = session();
    const a = s.addNode({ kind: 'loop', position: P });
    s.enter(a);
    const x = s.addNode({ kind: 'agent', agentId: 'q', position: P });
    s.up();
    const loop = s.getSnapshot().level.nodes.find((n) => n.id === a)!;
    expect(loop.loop!.body.nodes.some((n) => n.id === x)).toBe(true);
    s.undo();
    s.enter(a);
    expect(s.getSnapshot().level.nodes.some((n) => n.id === x)).toBe(false);
  });
});

describe('observación (useSyncExternalStore)', () => {
  it('notifica a los suscriptores y el snapshot es estable entre cambios', () => {
    const s = session();
    const spy = vi.fn();
    const off = s.subscribe(spy);
    const first = s.getSnapshot();
    expect(s.getSnapshot()).toBe(first);
    s.addNode({ kind: 'router', position: P });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(s.getSnapshot()).not.toBe(first);
    off();
    s.addNode({ kind: 'router', position: P });
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('plantillas de ejemplo [R14.9]', () => {
  it('[R14.9][R32.36] hay enrutador con 3 agentes , bucle de revisión y varios a la vez, y todas son válidas', () => {
    const list = exampleTemplates();
    expect(list.map((x) => x.id)).toEqual(['enrutador', 'revision', 'paralelo', 'qa', 'spec-kit']);
    for (const tpl of list) expect(validateDiagram(tpl.diagram)).toEqual([]);
    const router = list[0]!.diagram;
    expect(router.nodes.filter((n) => n.kind === 'agent')).toHaveLength(3);
    expect(router.nodes.some((n) => n.kind === 'router')).toBe(true);
    expect(list[1]!.diagram.nodes.some((n) => n.kind === 'loop')).toBe(true);
  });

  it('[R14.9] instanciar da una copia independiente cargable como diagrama nuevo', () => {
    const tpl = exampleTemplates()[0]!;
    const d = instantiateTemplate(tpl, 'mio', 'Mi flujo');
    expect(d).toMatchObject({ id: 'mio', name: 'Mi flujo' });
    expect(d.nodes).not.toBe(tpl.diagram.nodes);
    const s = new EditorSession(d);
    s.addNode({ kind: 'router', position: P });
    expect(tpl.diagram.nodes.filter((n) => n.kind === 'router')).toHaveLength(1);
    expect(s.getSnapshot().dirty).toBe(true);
  });
});

describe('duplicar [R14.15]', () => {
  it('[R14.15] copia el nodo con id nuevo, posición desplazada y sin conexiones', () => {
    const s = session();
    const a = s.addNode({ kind: 'agent', agentId: 'q', label: 'Pintor', position: { x: 10, y: 20 } });
    s.connect('entry', a);
    const b = s.duplicateNode(a);
    const snap = s.getSnapshot();
    const copy = snap.level.nodes.find((n) => n.id === b)!;
    expect(b).not.toBe(a);
    expect(copy).toMatchObject({ kind: 'agent', agentId: 'q', label: 'Pintor (copia)', position: { x: 50, y: 60 } });
    expect(snap.level.edges.some((e) => e.from === b || e.to === b)).toBe(false);
    s.undo();
    expect(s.getSnapshot().level.nodes.some((n) => n.id === b)).toBe(false);
  });

  it('[R14.15] un bucle se duplica con una copia independiente de su cuerpo', () => {
    const s = session();
    const l = s.addNode({ kind: 'loop', position: P });
    s.enter(l);
    const inner = s.addNode({ kind: 'agent', agentId: 'z', position: P });
    s.up();
    const l2 = s.duplicateNode(l);
    s.enter(l2);
    expect(s.getSnapshot().level.nodes.some((n) => n.id === inner)).toBe(true);
    s.removeSelection({ nodes: [inner] });
    s.up();
    s.enter(l);
    expect(s.getSnapshot().level.nodes.some((n) => n.id === inner)).toBe(true);
  });

  it('[R14.15] la entrada, la salida y lo inexistente no se duplican', () => {
    const s = session();
    expect(() => s.duplicateNode('entry')).toThrow(/entrada y la salida/);
    expect(() => s.duplicateNode('output')).toThrow();
    expect(() => s.duplicateNode('nope')).toThrow();
    expect(s.getSnapshot().canUndo).toBe(false);
  });
});

describe('agentes usados [R21.15]', () => {
  it('[R21.15] agrupa por agente en todos los niveles, también dentro de bucles', () => {
    const s = session();
    const a = s.addNode({ kind: 'agent', agentId: 'q', label: 'Uno', position: P });
    const l = s.addNode({ kind: 'loop', position: P });
    s.enter(l);
    const b = s.addNode({ kind: 'agent', agentId: 'q', position: P });
    const c = s.addNode({ kind: 'agent', agentId: 'z', position: P });
    s.up();
    expect(agentUsage(s.diagram)).toEqual([
      { agentId: 'q', uses: [{ path: [], nodeId: a, label: 'Uno' }, { path: [l], nodeId: b, label: 'q' }] },
      { agentId: 'z', uses: [{ path: [l], nodeId: c, label: 'z' }] },
    ]);
  });
  it('[R21.15] un diagrama sin agentes no tiene usos', () => {
    expect(agentUsage(session().diagram)).toEqual([]);
  });
});
