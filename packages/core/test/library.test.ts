import { describe, expect, it } from 'vitest';
import { addFolder, buildFolderTree, emptyLibraryFolders, moveToFolder, normalizeFolder, removeFolder, renameFolder, tidyLibraryFolders, validateLibraryFolders } from '../src';

describe('SPEC-038 · carpetas de la biblioteca', () => {
  it('[R38.13] normaliza rutas y rechaza las que no valen', () => {
    expect(normalizeFolder('  Arte //  Píxel  art / ')).toBe('Arte/Píxel art');
    expect(normalizeFolder('')).toBe('');
    expect(normalizeFolder('a/b/c/d')).toBeUndefined();
    expect(normalizeFolder('a/../b')).toBeUndefined();
    expect(normalizeFolder('x'.repeat(41))).toBeUndefined();
    expect(normalizeFolder('a\\b')).toBeUndefined();
  });

  it('[R38.13] ordena el documento: crea los padres, quita rutas e ids inválidos y valida', () => {
    const f = tidyLibraryFolders({ kinds: { skills: { folders: ['Arte/Píxel', 'Arte/Píxel', 'a/../b'], items: { pixel: 'Arte/Píxel', '../x': 'Arte', musica: 'Audio' } } } });
    expect(f.kinds.skills.folders).toEqual(['Arte', 'Arte/Píxel', 'Audio']);
    expect(f.kinds.skills.items).toEqual({ pixel: 'Arte/Píxel', musica: 'Audio' });
    expect(f.kinds.mcp).toEqual({ folders: [], items: {} });
    expect(validateLibraryFolders(f)).toBeUndefined();
    expect(validateLibraryFolders({ ...f, kinds: { ...f.kinds, mcp: { folders: ['a//b'], items: {} } } })).toMatch(/no válido/);
    expect(tidyLibraryFolders(null)).toEqual(emptyLibraryFolders());
  });

  it('[R38.14] crear, mover, renombrar con lo de dentro y quitar sin borrar nada', () => {
    let f = addFolder(emptyLibraryFolders(), 'mcp', 'Servicios/Código');
    f = moveToFolder(f, 'mcp', 'github', 'Servicios/Código');
    f = moveToFolder(f, 'mcp', 'notion', 'Servicios');
    expect(f.kinds.mcp.folders).toEqual(['Servicios', 'Servicios/Código']);
    f = renameFolder(f, 'mcp', 'Servicios', 'Web');
    expect(f.kinds.mcp).toEqual({ folders: ['Web', 'Web/Código'], items: { github: 'Web/Código', notion: 'Web' } });
    expect(() => renameFolder(f, 'mcp', 'Web', 'Web/Código/x')).toThrow(/sí misma/);
    expect(() => renameFolder(addFolder(f, 'mcp', 'Otra'), 'mcp', 'Otra', 'Web')).toThrow(/Ya existe/);
    f = removeFolder(f, 'mcp', 'Web');
    expect(f.kinds.mcp).toEqual({ folders: ['Código'], items: { github: 'Código' } });
    f = moveToFolder(f, 'mcp', 'github', '');
    expect(f.kinds.mcp.items).toEqual({});
    expect(() => moveToFolder(f, 'mcp', 'github', 'a/b/c/d')).toThrow();
  });

  it('[R38.13] el árbol pone carpetas y elementos por nombre y cuenta lo de dentro; lo desconocido va a la raíz', () => {
    const f = tidyLibraryFolders({ kinds: { skills: { folders: ['Vacía'], items: { b: 'Arte/Píxel', a: 'Arte' } } } });
    const tree = buildFolderTree(
      [
        { id: 'b', name: 'Bordes' },
        { id: 'a', name: 'Acuarela' },
        { id: 'z', name: 'Zeta' },
      ],
      f.kinds.skills,
    );
    expect(tree.total).toBe(3);
    expect(tree.items.map((i) => i.id)).toEqual(['z']);
    expect(tree.folders.map((n) => [n.path, n.total])).toEqual([
      ['Arte', 2],
      ['Vacía', 0],
    ]);
    expect(tree.folders[0]!.folders[0]).toMatchObject({ name: 'Píxel', path: 'Arte/Píxel', total: 1 });
  });
});
