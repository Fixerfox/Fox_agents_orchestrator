import { describe, expect, it } from 'vitest';
import { EditorSession, createDiagram } from '../src';

describe('SPEC-033 · conocimiento añadido en el editor', () => {
  it('[R33.1] un paso guarda lo añadido, vacío lo quita y es un paso de deshacer', () => {
    const s = new EditorSession(createDiagram('d', 'D'));
    const a = s.addNode({ kind: 'agent', agentId: 'pix', position: { x: 0, y: 0 } });
    s.updateNode(a, { extra: { skillIds: ['trazo', 'trazo'], contextIds: [] } });
    expect(s.getSnapshot().level.nodes.find((n) => n.id === a)!.extra).toEqual({ skillIds: ['trazo'] });
    s.updateNode(a, { extra: { skillIds: [] } });
    expect(s.getSnapshot().level.nodes.find((n) => n.id === a)!).not.toHaveProperty('extra');
    s.undo();
    expect(s.getSnapshot().level.nodes.find((n) => n.id === a)!.extra).toEqual({ skillIds: ['trazo'] });
    const r = s.addNode({ kind: 'router', position: { x: 0, y: 0 } });
    expect(() => s.updateNode(r, { extra: { skillIds: ['x'] } })).toThrow();
  });

  it('[R33.1] el diagrama guarda lo que reciben todos sus agentes', () => {
    const s = new EditorSession(createDiagram('d', 'D'));
    s.setDiagramExtra({ contextIds: ['glosario'] });
    expect(s.getSnapshot().diagram.extra).toEqual({ contextIds: ['glosario'] });
    s.setDiagramExtra({});
    expect(s.getSnapshot().diagram).not.toHaveProperty('extra');
    s.undo();
    expect(s.getSnapshot().diagram.extra).toEqual({ contextIds: ['glosario'] });
  });
});

describe('SPEC-033 · subdiagramas en el editor', () => {
  it('[R33.7] añade un paso que apunta a otro diagrama (última versión) y no a sí mismo', () => {
    const s = new EditorSession(createDiagram('mundo', 'Mundo'));
    const id = s.addNode({ kind: 'subdiagram', diagramId: 'cueva', label: 'Cueva', position: { x: 0, y: 0 } });
    expect(s.getSnapshot().level.nodes.find((n) => n.id === id)).toMatchObject({ kind: 'subdiagram', label: 'Cueva', subdiagram: { templateId: 'cueva', version: 'latest' } });
    expect(() => s.addNode({ kind: 'subdiagram', diagramId: 'mundo', position: { x: 0, y: 0 } })).toThrow(/dentro de sí mismo/);
  });
});
