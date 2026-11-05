import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { BookOpen, FileText, Lock, Plug, X } from 'lucide-react';
import { t, type KnowledgeState } from '@orquestador/editor';

/** Ficha de una skill, contexto o MCP enchufada a un paso: vale solo para ese paso [R33.10]. */
export interface ResNodeData extends Record<string, unknown> {
  kind: 'skillIds' | 'contextIds' | 'mcpIds';
  itemId: string;
  label: string;
  /** Paso al que está enchufada. */
  stepId: string;
  onRemove?: (stepId: string, kind: ResNodeData['kind'], itemId: string) => void;
  /** Obligatoria en este paso (por el paso o por el diagrama) [R36.16]. */
  required?: boolean;
  /** Es obligatoria porque lo manda el diagrama; desde el paso no se puede quitar [R36.19]. */
  byDiagram?: boolean;
  /** Estado en el último intento; `unused` cuando el paso terminó sin usarla [R36.18]. */
  state?: KnowledgeState | 'unused';
  /** Skill o MCP enchufado al paso: obligatorio siempre, sin interruptor [R36.22]. */
  plugged?: boolean;
  onToggleRequired?: (stepId: string, kind: ResNodeData['kind'], itemId: string) => void;
}
export type ResFlowNode = Node<ResNodeData, 'res'>;

const ICON = { skillIds: BookOpen, contextIds: FileText, mcpIds: Plug } as const;
const KIND = { skillIds: 'res.kind.skill', contextIds: 'res.kind.context', mcpIds: 'res.kind.mcp' } as const;

export function ResNode({ data }: NodeProps<ResFlowNode>) {
  const Icon = ICON[data.kind];
  const mcp = data.kind === 'mcpIds';
  const what = t(KIND[data.kind]);
  const required = data.required === true;
  const stateText = data.state ? t(`know.state.${data.state}` as 'know.state.used') : undefined;
  const aria = [t('res.aria', { kind: what, name: data.label }), required ? t('know.required') : '', stateText ?? ''].filter(Boolean).join(' · ');
  return (
    <div className={`orq-res${mcp ? ' is-mcp' : ''}${required ? ' is-required' : ''}${data.state ? ` is-${data.state}` : ''}`} role="group" aria-label={aria} title={data.plugged ? t('know.required.plugged') : required ? t('know.required.title') : undefined}>
      <Icon size={13} strokeWidth={1.5} aria-hidden="true" />
      <span className="orq-res__name">{data.label}</span>
      {stateText && <span className="orq-res__state">{stateText}</span>}
      {data.onToggleRequired && (
        <button
          type="button"
          className={`orq-res__req nodrag nopan${required ? ' is-on' : ''}`}
          disabled={data.byDiagram === true}
          aria-pressed={required}
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          aria-label={data.byDiagram ? t('know.byDiagram') : t(required ? 'know.required.off' : 'know.required.on', { name: data.label })}
          title={data.byDiagram ? t('know.byDiagram') : t(required ? 'know.required.off' : 'know.required.on', { name: data.label })}
          onClick={(e) => {
            e.stopPropagation();
            data.onToggleRequired!(data.stepId, data.kind, data.itemId);
          }}
        >
          <Lock size={12} strokeWidth={1.5} aria-hidden="true" />
        </button>
      )}
      {!data.onToggleRequired && required && <Lock size={12} strokeWidth={1.5} aria-label={t('know.required')} className="orq-res__lock" />}
      {data.onRemove && (
        <button
          type="button"
          className="orq-res__x nodrag nopan"
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          aria-label={t('res.remove', { name: data.label })}
          title={t('res.remove', { name: data.label })}
          onClick={(e) => {
            e.stopPropagation();
            data.onRemove!(data.stepId, data.kind, data.itemId);
          }}
        >
          <X size={12} strokeWidth={1.5} aria-hidden="true" />
        </button>
      )}
      <Handle type="source" position={mcp ? Position.Top : Position.Bottom} isConnectable={false} className="orq-res__port" />
    </div>
  );
}
