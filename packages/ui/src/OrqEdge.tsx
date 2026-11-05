import { BaseEdge, EdgeLabelRenderer, getBezierPath, type Edge, type EdgeProps } from '@xyflow/react';
import { Plus } from 'lucide-react';
import { t } from '@orquestador/editor';

/** Se llama con el id de la conexión y el punto de pantalla donde abrir el buscador. */
export type InsertHandler = (edgeId: string, at: { x: number; y: number }) => void;
export type OrqEdgeData = { onInsert: InsertHandler; fromName: string; toName: string };
export type OrqFlowEdge = Edge<OrqEdgeData, 'orq'>;

/**
 * Retorno de una revisión: sale por la derecha, baja por debajo de los nodos, cruza hacia atrás y entra por la
 * izquierda del destino. Discontinuo, con «↺ máx. N» y sin «+» [R34.21].
 */
export function OrqReturnEdge(props: EdgeProps<Edge<{ title?: string }, 'orqReturn'>>) {
  const { sourceX: sx, sourceY: sy, targetX: tx, targetY: ty } = props;
  const drop = Math.max(sy, ty) + 90;
  const out = sx + 24;
  const into = tx - 24;
  const path = `M ${sx} ${sy} L ${out - 8} ${sy} Q ${out} ${sy} ${out} ${sy + 8} L ${out} ${drop - 8} Q ${out} ${drop} ${out - 8} ${drop} L ${into + 8} ${drop} Q ${into} ${drop} ${into} ${drop - 8} L ${into} ${ty + 8} Q ${into} ${ty} ${into + 8} ${ty} L ${tx} ${ty}`;
  const x = (out + into) / 2;
  return (
    <>
      <BaseEdge id={props.id} path={path} {...(props.markerEnd ? { markerEnd: props.markerEnd } : {})} {...(props.interactionWidth !== undefined ? { interactionWidth: props.interactionWidth } : {})} />
      {props.label && (
        <EdgeLabelRenderer>
          <span className="orq-edge__label orq-edge__label--return nodrag nopan" title={props.data?.title} style={{ transform: `translate(-50%, 6px) translate(${x}px, ${drop}px)` }}>
            {props.label}
          </span>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

/** Conexión con un botón «+» en su punto medio para insertar un paso [R32.8]. */
export function OrqEdge(props: EdgeProps<OrqFlowEdge>) {
  const [path, x, y] = getBezierPath(props);
  const { data } = props;
  return (
    <>
      <BaseEdge id={props.id} path={path} {...(props.markerEnd ? { markerEnd: props.markerEnd } : {})} {...(props.style ? { style: props.style } : {})} {...(props.interactionWidth !== undefined ? { interactionWidth: props.interactionWidth } : {})} />
      {props.label && (
        <EdgeLabelRenderer>
          <span className="orq-edge__label nodrag nopan" style={{ transform: `translate(-50%, -150%) translate(${x}px, ${y}px)` }}>
            {props.label}
          </span>
        </EdgeLabelRenderer>
      )}
      {data && <InsertButton edgeId={props.id} x={x} y={y} data={data} />}
    </>
  );
}

export function InsertButton({ edgeId, x, y, data }: { edgeId: string; x: number; y: number; data: OrqEdgeData }) {
  const label = t('edge.insert', { from: data.fromName, to: data.toName });
  return (
    <EdgeLabelRenderer>
      <button
        type="button"
        className="orq-edge__plus nodrag nopan"
        style={{ transform: `translate(-50%, -50%) translate(${x}px, ${y}px)` }}
        aria-label={label}
        title={label}
        onClick={(e) => {
          e.stopPropagation();
          const r = e.currentTarget.getBoundingClientRect();
          data.onInsert(edgeId, { x: r.left + r.width / 2, y: r.bottom + 6 });
        }}
      >
        <Plus size={14} strokeWidth={2} aria-hidden="true" />
      </button>
    </EdgeLabelRenderer>
  );
}
