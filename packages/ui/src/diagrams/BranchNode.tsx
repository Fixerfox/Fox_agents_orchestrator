import type { Node, NodeProps } from '@xyflow/react';
import { GitBranch } from 'lucide-react';
import { branchBoxes, t, type Rect } from '@orquestador/editor';

/** Recuadro de rayas amarillas con los pasos que actuaron en una rama de git [R58.8]. */
export interface BranchNodeData extends Record<string, unknown> {
  branch: string;
}
export type BranchFlowNode = Node<BranchNodeData, 'branch'>;

export function BranchNode({ data }: NodeProps<BranchFlowNode>) {
  return (
    <div className="orq-branchbox" role="group" aria-label={t('node.branch', { name: data.branch })}>
      <span className="orq-branchbox__name" title={data.branch}>
        <GitBranch size={13} aria-hidden="true" />
        <span>{data.branch}</span>
      </span>
    </div>
  );
}

const NODE_W = 224;
const NODE_H = 88;
const RES_W = 150;
const RES_H = 28;
/** Lo que ocupan las fichas de archivos colgadas bajo el nodo [R54.1]. */
const FILES_H = 64;

interface Placed {
  id: string;
  type?: string | undefined;
  position: { x: number; y: number };
  parentId?: string | undefined;
  measured?: { width?: number | undefined; height?: number | undefined } | undefined;
  data: Record<string, unknown>;
}

/** Sitio de cada paso, con sus enchufes y sus fichas de archivos [R58.8]. */
function stepRects(nodes: readonly Placed[]): Map<string, Rect> {
  const rects = new Map<string, Rect>();
  for (const n of nodes) {
    if (n.parentId) continue;
    const files = ((n.data['files'] as readonly unknown[] | undefined)?.length ?? 0) > 0 ? FILES_H : 0;
    rects.set(n.id, { x: n.position.x, y: n.position.y, width: n.measured?.width ?? NODE_W, height: (n.measured?.height ?? NODE_H) + files });
  }
  for (const n of nodes) {
    const parent = n.parentId ? rects.get(n.parentId) : undefined;
    const origin = nodes.find((p) => p.id === n.parentId)?.position;
    if (!parent || !origin) continue;
    const x = origin.x + n.position.x;
    const y = origin.y + n.position.y;
    const left = Math.min(parent.x, x);
    const top = Math.min(parent.y, y);
    rects.set(n.parentId!, { x: left, y: top, width: Math.max(parent.x + parent.width, x + RES_W) - left, height: Math.max(parent.y + parent.height, y + RES_H) - top });
  }
  return rects;
}

/**
 * Quita los cambios de los recuadros, que no son estado del lienzo: se calculan a partir de los pasos. Si sus medidas
 * volvieran al estado, se recalcularían, React Flow los mediría otra vez y el lienzo entraría en bucle [R58.8].
 */
export function withoutBranchBoxes<T extends object>(changes: readonly T[]): T[] {
  return changes.filter((c) => !('id' in c && typeof c.id === 'string' && c.id.startsWith('branch:')));
}

/** Recuadros de las ramas para React Flow: detrás de los pasos y sin ratón [R58.8]. */
export function branchFlowNodes(level: Parameters<typeof branchBoxes>[0], path: readonly string[], nodes: readonly Placed[], byStep: Readonly<Record<string, readonly string[]>>): BranchFlowNode[] {
  return branchBoxes(level, path, byStep, stepRects(nodes)).map((b) => ({
    id: b.id,
    type: 'branch',
    position: { x: b.x, y: b.y },
    width: b.width,
    height: b.height,
    zIndex: -1,
    draggable: false,
    selectable: false,
    connectable: false,
    focusable: false,
    deletable: false,
    style: { width: b.width, height: b.height, pointerEvents: 'none' },
    data: { branch: b.branch },
  }));
}
