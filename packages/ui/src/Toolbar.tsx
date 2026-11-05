import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, ChevronDown, Copy, Pencil, Sparkles, Trash2, Workflow, Cpu, FilePlus2, FolderOpen, FolderPlus, FolderX, MessageCircleQuestion, PanelRight, Pause, Play, Redo2, Save, Square, Undo2 } from 'lucide-react';
import { EMPTY_LIVE, budgetRemaining, t, type LiveView, type MessageKey, type ProblemsView } from '@orquestador/editor';
import { ProblemsPanel } from './ProblemsPanel';

interface Props {
  canUndo: boolean;
  canRedo: boolean;
  dirty: boolean;
  projectOpen: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onSave: () => void;
  onNew: () => void;
  onCloseProject?: () => void;
  onOpenProject: () => void;
  onCreateProject: () => void;
  onOpenSettings?: () => void;
  /** Nombre del proyecto abierto: abre el menú de proyecto [R32.12]. */
  projectName?: string;
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
  /** Motor activo, siempre visible [R32.11]. */
  engine?: 'simulated' | 'claude';
  /** Problemas del diagrama: contador junto a Ejecutar con la lista desplegable [R32.23]. */
  problems?: ProblemsView;
  /** Estado de la ejecución: medidor, preguntas y controles [R32.20]. */
  live?: LiveView;
  maxTokens?: number | undefined;
  /** «Lanzar…»: abre el diálogo de lanzar el diagrama abierto; solo en el Diseñador [R32.19][R52.8]. */
  onRun?: () => void;
  /** Ejecuciones en marcha en el proyecto: «N en marcha» abre En directo [R52.8]. */
  running?: number;
  onOpenLive?: () => void;
  /** Preguntas sin responder de todas las ejecuciones, cuando no se pasa `live` [R52.8]. */
  pendingCount?: number;
  onControl?: (action: 'pause' | 'resume' | 'cancel') => void;
  /** Abre Ejecuciones (bandeja de preguntas) [R32.18]. */
  onOpenRuns?: () => void;
  /** Con la ejecución ya terminada, su estado abre el modal de la ejecución [R44.4]. */
  onShowSummary?: () => void;
  rightOpen?: boolean;
  onToggleRight?: () => void;
  runError?: string | undefined;
  /** «✦ Asistente» abre el chat en el lateral derecho [R29.5]. */
  onAssistant?: () => void;
  assistantOpen?: boolean;
}

const SZ = { size: 16, strokeWidth: 1.5, 'aria-hidden': true } as const;

/** Barra superior del prototipo «Editor A»: proyecto y diagrama, guardado, motor, avisos y Ejecutar [R21.3][R32.11][R32.12]. */
export function Toolbar(p: Props) {
  const live = p.live ?? EMPTY_LIVE;
  const icon = (label: string, onClick: (() => void) | undefined, node: ReactNode, disabled = false) => (
    <button type="button" className="orq-ib" aria-label={label} title={label} onClick={onClick} disabled={disabled}>
      {node}
    </button>
  );
  const running = live.status === 'running';
  const tokens = live.usage.inputTokens + live.usage.outputTokens;
  const left = p.maxTokens !== undefined ? budgetRemaining(live, { maxTokens: p.maxTokens }).tokens : undefined;
  const statusKey: MessageKey = live.paused && running ? 'run.status.paused' : (`run.status.${live.status}` as MessageKey);
  const engineName = t(p.engine === 'claude' ? 'engine.claude' : 'engine.simulated');
  const runnable = p.problems?.runnable ?? true;
  const pending = p.pendingCount ?? live.pending.length;
  const runInfo = (
    <>
      <span className="orq-runstatus" role="status" aria-live="polite">
        {t(statusKey)}
      </span>
      <span className="orq-usage">
        {t('run.usage', { tokens, cost: live.usage.costUsd.toFixed(3).replace('.', ',') })}
        {left !== undefined && ` · ${live.budgetReached ? t('run.budget.reached') : left === 1 ? t('run.budget.left.one') : t('run.budget.left', { tokens: left })}`}
      </span>
      {p.maxTokens !== undefined && (
        <span className="orq-meter__bar" role="presentation" aria-hidden="true">
          <i style={{ width: `${Math.min(100, Math.round((tokens / p.maxTokens) * 100))}%` }} />
        </span>
      )}
    </>
  );
  return (
    <header className="orq-topbar" role="toolbar" aria-label={t('app.title')}>
      <ProjectMenu {...p} />
      {p.diagramName !== undefined && (
        <>
          <span className="orq-topbar__sep" aria-hidden="true">
            /
          </span>
          <DiagramMenu {...p} />
        </>
      )}
      <span className={`orq-status is-${p.saveState ?? (p.dirty ? 'dirty' : 'saved')}`} role="status">
        {p.saveState
          ? t(({ saved: 'save.state.saved', dirty: 'save.state.dirty', saving: 'save.state.saving', error: 'save.state.error', 'no-project': 'save.state.noProject' } as const)[p.saveState])
          : p.dirty
            ? t('toolbar.unsaved')
            : t('toolbar.saved')}
      </span>
      <span className="orq-topbar__gap" />
      {icon(t('toolbar.new'), p.onNew, <FilePlus2 {...SZ} />)}
      {icon(t('toolbar.undo'), p.onUndo, <Undo2 {...SZ} />, !p.canUndo)}
      {icon(t('toolbar.redo'), p.onRedo, <Redo2 {...SZ} />, !p.canRedo)}
      {icon(t('toolbar.save'), p.onSave, <Save {...SZ} />, !p.projectOpen)}
      {p.engine && (
        <button type="button" className={`orq-engine is-${p.engine}`} aria-label={t('engine.title', { name: engineName })} title={t('engine.title', { name: engineName })} onClick={p.onOpenSettings}>
          <Cpu {...SZ} />
          {engineName}
        </button>
      )}
      {live.status !== 'idle' &&
        (p.onShowSummary && !running ? (
          <button type="button" className="orq-topbar__run is-btn" aria-label={t('rmodal.status')} title={t('rmodal.status')} onClick={p.onShowSummary}>
            {runInfo}
          </button>
        ) : (
          <span className="orq-topbar__run">{runInfo}</span>
        ))}
      {(p.running ?? 0) > 0 && p.onOpenLive && (
        <button type="button" className="orq-chipbtn orq-topbar__live" onClick={p.onOpenLive}>
          <span className="orq-dot is-running" aria-hidden="true" />
          {t('topbar.running', { n: p.running! })}
        </button>
      )}
      {pending > 0 && (
        <button type="button" className="orq-chipbtn is-attention" onClick={p.onOpenRuns}>
          <MessageCircleQuestion {...SZ} />
          <span role="status">{pending === 1 ? t('topbar.pending.one') : t('topbar.pending.many', { count: pending })}</span>
        </button>
      )}
      {live.needsAttention && <span className="orq-attention">{t('run.needsAttention')}</span>}
      {running && (
        <>
          {live.paused ? (
            <button type="button" className="orq-btn orq-btn--small" onClick={() => p.onControl?.('resume')}>
              <Play {...SZ} />
              {t('run.resume')}
            </button>
          ) : (
            <button type="button" className="orq-btn orq-btn--small" onClick={() => p.onControl?.('pause')}>
              <Pause {...SZ} />
              {t('run.pause')}
            </button>
          )}
          <button type="button" className="orq-btn orq-btn--small" onClick={() => p.onControl?.('cancel')}>
            <Square {...SZ} />
            {t('run.cancel')}
          </button>
        </>
      )}
      {p.onAssistant && (
        <button type="button" className={`orq-chipbtn orq-topbar__assist${p.assistantOpen ? ' is-on' : ''}`} aria-pressed={p.assistantOpen === true} onClick={p.onAssistant}>
          <Sparkles {...SZ} />
          {t('as.open')}
        </button>
      )}
      {p.problems && p.problems.count > 0 && <ProblemsButton problems={p.problems} />}
      {p.onRun && (
        <button type="button" className="orq-btn orq-btn--primary" title={runnable ? undefined : t('toolbar.run.blocked')} onClick={p.onRun}>
          <Play size={14} strokeWidth={2} aria-hidden="true" />
          {t('toolbar.launch')}
        </button>
      )}
      {p.runError && (
        <span className="orq-runerror" role="alert">
          {p.runError}
        </span>
      )}
      {p.onToggleRight && icon(p.rightOpen === false ? t('panel.expand.right') : t('panel.collapse.right'), p.onToggleRight, <PanelRight {...SZ} />)}
    </header>
  );
}

/** Selector de diagramas desde el nombre del diagrama: abrir otro o crear uno nuevo [R32.28]. */
function DiagramMenu(p: Props) {
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
      <button ref={button} type="button" className="orq-projmenu__btn orq-topbar__diagram" aria-haspopup="menu" aria-expanded={open} aria-label={t('topbar.diagram', { name })} title={t('topbar.diagram', { name })} onClick={toggle}>
        <span>{name}</span>
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

/** Contador de problemas junto a Ejecutar con la lista desplegable [R32.10][R32.23]. */
function ProblemsButton({ problems }: { problems: ProblemsView }) {
  const [open, setOpen] = useState(false);
  const box = useOutside<HTMLDivElement>(open, () => setOpen(false));
  const label = problems.errors > 0 ? t('topbar.problems.errors', { count: problems.errors }) : problems.warnings === 1 ? t('topbar.problems.one') : t('topbar.problems.many', { count: problems.warnings });
  return (
    <div className="orq-pop" ref={box}>
      <button type="button" className={`orq-chipbtn ${problems.errors > 0 ? 'is-error' : 'is-warning'}`} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <AlertTriangle {...SZ} />
        {label}
      </button>
      {open && (
        <div className="orq-pop__panel" onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}>
          <ProblemsPanel problems={problems} />
        </div>
      )}
    </div>
  );
}

function useOutside<T extends HTMLElement>(open: boolean, close: () => void) {
  const box = useRef<T>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) close();
    };
    window.addEventListener('pointerdown', away);
    return () => window.removeEventListener('pointerdown', away);
  }, [open, close]);
  return box;
}

/** Menú de proyecto desde su nombre: crear, abrir y cerrar [R32.12]. */
function ProjectMenu(p: Props) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const box = useOutside<HTMLDivElement>(open, () => setOpen(false));
  const name = p.projectName ?? t('app.title');
  const pick = (fn: (() => void) | undefined) => () => {
    setOpen(false);
    fn?.();
  };
  return (
    <div className="orq-projmenu" ref={box}>
      <button
        ref={button}
        type="button"
        className="orq-projmenu__btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('project.menu', { name })}
        title={t('project.menu', { name })}
        onClick={() => setOpen((v) => !v)}
      >
        <span>{name}</span>
        <ChevronDown {...SZ} />
      </button>
      {open && (
        <div
          className="orq-menu orq-projmenu__list"
          role="menu"
          aria-label={t('project.menu', { name })}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              setOpen(false);
              button.current?.focus();
            }
          }}
        >
          <button type="button" role="menuitem" className="orq-menu__item" autoFocus onClick={pick(p.onCreateProject)}>
            <FolderPlus {...SZ} />
            {t('project.create')}
          </button>
          <button type="button" role="menuitem" className="orq-menu__item" onClick={pick(p.onOpenProject)}>
            <FolderOpen {...SZ} />
            {t('project.open')}
          </button>
          {p.onCloseProject && p.projectOpen && (
            <button type="button" role="menuitem" className="orq-menu__item" onClick={pick(p.onCloseProject)}>
              <FolderX {...SZ} />
              {t('project.close')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
