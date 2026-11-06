import { type ReactNode, useState, useRef } from 'react';
import { FilePlus2, Undo2, Redo2, Save, ChevronDown, Pencil, Copy, Trash2, Workflow } from 'lucide-react';
import { t } from '@orquestador/editor';
import { useOutside } from '../common/useOutside';

/** Lo que necesitan los mandos del diagrama abierto: edición, guardado y menú [R32.28][R32.38]. */
export interface DiagramControlsProps {
  canUndo: boolean;
  canRedo: boolean;
  dirty: boolean;
  projectOpen: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onSave: () => void;
  onNew: () => void;
  /** Nombre del diagrama que se edita. */
  diagramName?: string;
  /** Diagramas del proyecto para el selector [R32.28]. */
  onListDiagrams?: () => Promise<{ id: string; name: string }[]>;
  onOpenDiagram?: (id: string) => void;
  /** Acciones sobre el diagrama abierto [R32.38]. */
  onRenameDiagram?: () => void;
  onDuplicateDiagram?: (() => void) | undefined;
  onDeleteDiagram?: (() => void) | undefined;
  /** Estado del guardado automático [R32.38]. */
  saveState?: 'saved' | 'dirty' | 'saving' | 'error' | 'no-project';
  currentDiagramId?: string;
}

const SZ = { size: 16, strokeWidth: 1.5, 'aria-hidden': true } as const;

/** Selector de diagramas desde el nombre del diagrama: abrir otro o crear uno nuevo [R32.28]. */
/** Nuevo, deshacer, rehacer y guardar el diagrama [R14.1][R14.5][R32.38]. */
export function EditButtons(p: Pick<DiagramControlsProps, 'canUndo' | 'canRedo' | 'projectOpen' | 'onNew' | 'onUndo' | 'onRedo' | 'onSave'>) {
  const icon = (label: string, onClick: () => void, node: ReactNode, disabled = false) => (
    <button type="button" className="orq-ib" aria-label={label} title={label} onClick={onClick} disabled={disabled}>
      {node}
    </button>
  );
  return (
    <span className="orq-editbtns" role="group" aria-label={t('toolbar.edit')}>
      {icon(t('toolbar.new'), p.onNew, <FilePlus2 {...SZ} />)}
      {icon(t('toolbar.undo'), p.onUndo, <Undo2 {...SZ} />, !p.canUndo)}
      {icon(t('toolbar.redo'), p.onRedo, <Redo2 {...SZ} />, !p.canRedo)}
      {icon(t('toolbar.save'), p.onSave, <Save {...SZ} />, !p.projectOpen)}
    </span>
  );
}

/** Estado del guardado del diagrama, para la cabecera del Diseñador [R32.38]. */
export function SaveStatus(p: Pick<DiagramControlsProps, 'saveState' | 'dirty'>) {
  return (
    <span className={`orq-status is-${p.saveState ?? (p.dirty ? 'dirty' : 'saved')}`} role="status">
      {p.saveState
        ? t(({ saved: 'save.state.saved', dirty: 'save.state.dirty', saving: 'save.state.saving', error: 'save.state.error', 'no-project': 'save.state.noProject' } as const)[p.saveState])
        : p.dirty
          ? t('toolbar.unsaved')
          : t('toolbar.saved')}
    </span>
  );
}

export type DiagramMenuProps = Pick<DiagramControlsProps, 'diagramName' | 'currentDiagramId' | 'onListDiagrams' | 'onOpenDiagram' | 'onRenameDiagram' | 'onDuplicateDiagram' | 'onDeleteDiagram' | 'onNew'> & {
  /** Solo la flecha: el nombre ya se ve al lado [R32.38]. */
  compact?: boolean;
};

/** Menú del diagrama abierto: renombrar, duplicar, eliminar, cambiar a otro o crear uno [R32.28][R32.38]. */
export function DiagramMenu(p: DiagramMenuProps) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<{ id: string; name: string }[]>();
  const box = useOutside<HTMLDivElement>(open, () => setOpen(false));
  const button = useRef<HTMLButtonElement>(null);
  const name = p.diagramName ?? '';
  const toggle = () => {
    if (!open) void p.onListDiagrams?.().then(setList);
    setOpen((v) => !v);
  };
  const pick = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  return (
    <div className="orq-projmenu" ref={box}>
      <button ref={button} type="button" className={`orq-projmenu__btn orq-topbar__diagram${p.compact ? ' is-compact' : ''}`} aria-haspopup="menu" aria-expanded={open} aria-label={t('topbar.diagram', { name })} title={t('topbar.diagram', { name })} onClick={toggle}>
        {!p.compact && <span>{name}</span>}
        <ChevronDown {...SZ} />
      </button>
      {open && (
        <div
          className="orq-menu orq-projmenu__list"
          role="menu"
          aria-label={t('topbar.diagram', { name })}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              setOpen(false);
              button.current?.focus();
            }
          }}
        >
          {p.onRenameDiagram && (
            <button type="button" role="menuitem" className="orq-menu__item" autoFocus onClick={pick(p.onRenameDiagram)}>
              <Pencil {...SZ} />
              {t('diagram.rename')}
            </button>
          )}
          {p.onDuplicateDiagram && (
            <button type="button" role="menuitem" className="orq-menu__item" onClick={pick(p.onDuplicateDiagram)}>
              <Copy {...SZ} />
              {t('diagram.duplicate')}
            </button>
          )}
          {p.onDeleteDiagram && (
            <button type="button" role="menuitem" className="orq-menu__item is-danger" onClick={pick(p.onDeleteDiagram)}>
              <Trash2 {...SZ} />
              {t('diagram.delete')}
            </button>
          )}
          <div className="orq-menu__sep" role="separator" />
          {(list ?? []).length > 0 && (
            <div className="orq-menu__group" aria-hidden="true">
              {t('diagram.others')}
            </div>
          )}
          {(list ?? []).map((d) => (
            <button key={d.id} type="button" role="menuitemradio" aria-checked={d.id === p.currentDiagramId} className="orq-menu__item" onClick={pick(() => p.onOpenDiagram?.(d.id))}>
              <Workflow {...SZ} />
              {d.name}
            </button>
          ))}
          <button type="button" role="menuitem" className="orq-menu__item" onClick={pick(p.onNew)}>
            <FilePlus2 {...SZ} />
            {t('topbar.diagram.new')}
          </button>
        </div>
      )}
    </div>
  );
}
