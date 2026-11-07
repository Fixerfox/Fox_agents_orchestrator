import { useCallback, useRef, useState } from 'react';
import type { EditorSnapshot } from '@orquestador/editor';
import type { Selection } from './Canvas';

const NONE: Selection = { nodes: [], edges: [] };

/** Selección del lienzo y peticiones de seleccionar un paso desde fuera. */
export function useDesignerSelection(snap: EditorSnapshot) {
  const [selection, setSelection] = useState<Selection>(NONE);
  const [selectRequest, setSelectRequest] = useState<{ id: string; n: number }>();
  const updateSelection = useCallback(
    (next: Selection) =>
      setSelection((prev) => (prev.nodes.join() === next.nodes.join() && prev.edges.join() === next.edges.join() ? prev : next)),
    [],
  );
  const selectedNode = selection.nodes.length === 1 ? snap.level.nodes.find((n) => n.id === selection.nodes[0]) : undefined;
  const hasSelection = selection.nodes.length + selection.edges.length > 0;
  const selRef = useRef(selection);
  selRef.current = selection;
  const clearSelection = useCallback(() => setSelection(NONE), []);
  const select = (id: string) => {
    setSelectRequest((r) => ({ id, n: (r?.n ?? 0) + 1 }));
  };
  return { selection, selectRequest, updateSelection, selectedNode, hasSelection, selRef, clearSelection, select };
}

export type DesignerSelection = ReturnType<typeof useDesignerSelection>;
