import { useMemo, useState } from 'react';
import { BookOpen, Bot, Braces, ChevronRight, Eye, FileText, GitFork, Plug, Plus, Repeat2, Search, ShieldCheck, Split, Workflow } from 'lucide-react';
import { DRAG_TYPE } from './Canvas';
import { ContextMenu, type MenuItem } from './ContextMenu';
import { t, type AgentUsage, type ExampleTemplate } from '@orquestador/editor';
import type { AgentIcon, AgentTone, PermissionLevel } from '@orquestador/core';
import { AgentAvatar, AskFirstMark, HandMark } from './agentLook';

export interface AgentOption {
  id: string;
  name: string;
  description?: string;
  /** Modelo, skills y contextos (por nombre) para el inspector [R32.22]. */
  model?: string;
  skills?: string[];
  contexts?: string[];
  /** Ids y nombres, para abrirlos desde el menú del agente [R32.34]. */
  skillRefs?: { id: string; name: string }[];
  contextRefs?: { id: string; name: string }[];
  /** Es un agente del proyecto (se puede editar). */
  editable?: boolean;
  /** Icono, tono y «pregunta antes de actuar» [R39.5][R39.9]. */
  icon?: AgentIcon | undefined;
  tone?: AgentTone | undefined;
  askFirst?: boolean | undefined;
  /** Permisos propios del agente [R47.12]. */
  permissions?: PermissionLevel | undefined;
}

export type NodeSpec = { kind: 'agent'; agentId: string } | { kind: 'router' } | { kind: 'loop' } | { kind: 'review' } | { kind: 'transform' };
type Kind = 'agent' | 'router' | 'loop' | 'review' | 'transform' | 'humanReview' | 'parallel';

interface Props {
  agents: AgentOption[];
  examples: ExampleTemplate[];
  usage: AgentUsage[];
  /** Pulsar «Tarea de agente» abre la galería; router y bucle se añaden directamente. */
  onAdd: (spec: { kind: 'router' } | { kind: 'loop' } | { kind: 'review'; human?: boolean } | { kind: 'transform' }) => void;
  /** «Varios a la vez»: ramas en paralelo [R32.36]. */
  onParallel?: () => void;
  /** Ejecución en curso: no se añade nada [R32.37]. */
  locked?: boolean;
  onPickAgent: () => void;
  onAddAgent: (agentId: string) => void;
  onSelectUse: (use: AgentUsage['uses'][number]) => void;
  /** Botón derecho sobre un agente [R32.34]. */
  agentMenu?: (agentId: string) => MenuItem[];
  onLoadExample: (example: ExampleTemplate) => void;
  /** Diagramas del proyecto: abrir, menú y arrastrar como subdiagrama [R33.8]. */
  diagrams?: { id: string; name: string }[];
  currentDiagramId?: string;
  /** Diagramas con una ejecución en marcha [R38.11]. */
  runningIds?: string[];
  /** Diagramas con una pregunta de un agente sin responder [R39.6]. */
  askingIds?: string[];
  onOpenDiagram?: (id: string) => void;
  diagramMenu?: (id: string) => MenuItem[];
  /** Skills, contextos y MCP que se arrastran sobre un agente [R33.11]. */
  resources?: { kind: 'skillIds' | 'contextIds' | 'mcpIds'; id: string; name: string }[];
  /** «+ Nuevo agente»: abre Agentes con un formulario vacío. */
  onNewAgent?: () => void;
  open?: boolean;
}

const SZ = { size: 16, strokeWidth: 1.5, 'aria-hidden': true } as const;
const norm = (s: string) => s.toLocaleLowerCase('es').normalize('NFD').replace(/\p{M}/gu, '');

/**
 * Panel izquierdo de Diagramas (prototipo «Editor A»): buscador, pasos que se arrastran o se pulsan,
 * tus agentes con sus usos en este diagrama y plantillas [R21.15][R21.18][R32.21].
 */
export function Palette({ agents, examples, usage, onAdd, onPickAgent, onAddAgent, onSelectUse, onLoadExample, onNewAgent, agentMenu, onParallel, locked = false, open = true, diagrams, currentDiagramId, runningIds = [], askingIds = [], onOpenDiagram, diagramMenu, resources }: Props) {
  const [q, setQ] = useState('');
  const [menu, setMenu] = useState<{ x: number; y: number; id: string; kind?: 'diagram' }>();
  const needle = norm(q.trim());
  const match = (text: string) => needle === '' || norm(text).includes(needle);
  const drag = (kind: Kind) => (e: React.DragEvent) => {
    e.dataTransfer.setData(DRAG_TYPE, kind);
    e.dataTransfer.effectAllowed = 'copy';
  };
  const steps = useMemo(
    () =>
      (
        [
          { kind: 'agent', icon: Bot, label: t('pal.step.agent'), aria: `+ ${t('palette.agent')}`, hint: t('palette.agent.hint') },
          { kind: 'router', icon: GitFork, label: t('pal.step.router'), aria: `+ ${t('palette.router')}`, hint: t('palette.router.hint') },
          { kind: 'loop', icon: Repeat2, label: t('pal.step.loop'), aria: `+ ${t('palette.loop')}`, hint: t('palette.loop.hint') },
          { kind: 'transform', icon: Braces, label: t('pal.step.transform'), aria: `+ ${t('palette.transform')}`, hint: t('palette.transform.hint') },
          { kind: 'review', icon: ShieldCheck, label: t('pal.step.review'), aria: `+ ${t('palette.review')}`, hint: t('palette.review.hint') },
          // Acceso directo: una Revisión ya en modo «Lo reviso yo» [R53.16].
          { kind: 'humanReview', icon: Eye, label: t('pal.step.humanReview'), aria: `+ ${t('palette.humanReview')}`, hint: t('palette.humanReview.hint') },
          { kind: 'parallel', icon: Split, label: t('pal.step.parallel'), aria: t('pal.step.parallel.aria'), hint: t('insert.parallel.hint') },
        ] as const
      ).filter((s) => s.kind !== 'parallel' || onParallel).filter((s) => needle === '' || norm(`${s.label} ${s.aria} ${s.hint}`).includes(needle)),
    [needle, onParallel],
  );
  const usesOf = (id: string) => usage.find((u) => u.agentId === id)?.uses ?? [];
  const shownAgents = agents.filter((a) => match(`${a.name} ${a.description ?? ''}`));
  const shownExamples = examples.filter((e) => match(`${e.name} ${e.description}`));
  const shownDiagrams = (diagrams ?? []).filter((d) => match(d.name));
  const shownRes = (resources ?? []).filter((r) => match(r.name));
  const nothing = steps.length === 0 && shownAgents.length === 0 && shownExamples.length === 0 && shownDiagrams.length === 0 && shownRes.length === 0;
  const [folds, setFolds] = useState<Record<string, boolean>>(readFolds);
  const hasProject = agents.some((a) => a.editable);
  /** Plegado de cada sección; al buscar se despliega todo para ver los resultados [R32.39]. */
  const isOpen = (key: string) => needle !== '' || !(folds[key] ?? (key === 'agents-examples' && hasProject));
  const toggle = (key: string) =>
    setFolds((f) => {
      const next = { ...f, [key]: isOpen(key) };
      try {
        localStorage.setItem(FOLDS_KEY, JSON.stringify(next));
      } catch {
        /* sin almacenamiento: el plegado dura lo que la sesión */
      }
      return next;
    });
  const [cursor, setCursor] = useState<Record<string, number>>({});
  /** Pulsar el contador de usos lleva al siguiente nodo que usa el agente [R32.39]. */
  const goToUse = (id: string) => {
    const uses = usesOf(id);
    if (uses.length === 0) return;
    const i = (cursor[id] ?? -1) + 1;
    setCursor((c) => ({ ...c, [id]: i % uses.length }));
    onSelectUse(uses[i % uses.length]!);
  };
  const used = shownAgents.filter((a) => usesOf(a.id).length > 0);
  const own = shownAgents.filter((a) => usesOf(a.id).length === 0 && a.editable);
  const demo = shownAgents.filter((a) => usesOf(a.id).length === 0 && !a.editable);
  const agentRow = (a: AgentOption) => {
    const uses = usesOf(a.id);
    return (
      <div key={a.id} className="orq-pal__agent">
        <button
          type="button"
          className="orq-pal__row"
          aria-label={t('pal.agents.add', { name: a.name })}
          title={a.description}
          onClick={() => onAddAgent(a.id)}
          onContextMenu={(e) => {
            if (!agentMenu) return;
            e.preventDefault();
            setMenu({ x: e.clientX, y: e.clientY, id: a.id });
          }}
          onKeyDown={(e) => {
            if (!agentMenu || !((e.shiftKey && e.key === 'F10') || e.key === 'ContextMenu')) return;
            e.preventDefault();
            const r = e.currentTarget.getBoundingClientRect();
            setMenu({ x: r.left + 16, y: r.bottom, id: a.id });
          }}
        >
          {a.icon ? <AgentAvatar name={a.name} icon={a.icon} tone={a.tone} size="sm" className={uses.length > 0 ? 'is-used' : ''} /> : <span className={`orq-pal__dot${uses.length > 0 ? ' is-used' : ''}`} aria-hidden="true" />}
          <span className="orq-pal__name">{a.name}</span>
          {a.askFirst && <AskFirstMark size={13} />}
        </button>
        {uses.length > 0 && (
          <button
            type="button"
            className="orq-pal__count"
            aria-label={t('pal.agents.goto', { name: a.name, count: uses.length })}
            title={uses.map((u) => u.label).join(', ')}
            onClick={() => goToUse(a.id)}
          >
            {uses.length === 1 ? t('pal.agents.uses.one') : t('pal.agents.uses.many', { count: uses.length })}
          </button>
        )}
      </div>
    );
  };
  const group = (key: string, label: string, list: AgentOption[]) =>
    list.length > 0 && (
      <div className="orq-pal__group">
        <Fold id={key} label={label} count={list.length} open={isOpen(key)} onToggle={() => toggle(key)} small />
        {isOpen(key) && <div id={`pal-${key}`}>{list.map(agentRow)}</div>}
      </div>
    );
  if (!open) return null;
  return (
    <aside className="orq-pal" aria-label={t('palette.title')}>
      {locked && (
        <p className="orq-locked" role="status">
          {t('run.locked')}
        </p>
      )}
      <label className="orq-pal__search">
        <Search {...SZ} />
        <input type="search" value={q} placeholder={t('pal.search')} aria-label={t('palette.search.label')} onChange={(e) => setQ(e.target.value)} />
      </label>
      {nothing && (
        <div className="orq-empty">
          <p>{t('palette.noMatch', { q })}</p>
          <button type="button" className="orq-btn orq-btn--small" onClick={() => setQ('')}>
            {t('palette.clear')}
          </button>
        </div>
      )}
      {diagrams && (shownDiagrams.length > 0 || needle === '') && (
        <section aria-label={t('pal.diagrams')}>
          <Fold id="diagrams" label={t('pal.diagrams')} count={shownDiagrams.length} open={isOpen('diagrams')} onToggle={() => toggle('diagrams')} />
          {isOpen('diagrams') && (
            <ul id="pal-diagrams" className="orq-pal__diagrams">
              {shownDiagrams.map((d) => {
                const current = d.id === currentDiagramId;
                const running = runningIds.includes(d.id);
                const asking = askingIds.includes(d.id);
                return (
                  <li key={d.id}>
                    <button
                      type="button"
                      className={`orq-pal__row${current ? ' is-current' : ''}${running ? ' is-running' : ''}`}
                      aria-current={current ? 'page' : undefined}
                      aria-label={running ? t('pal.diagram.runningAria', { name: t('pal.diagram.open', { name: d.name }) }) : t('pal.diagram.open', { name: d.name })}
                      title={current ? t('pal.diagram.current') : t('pal.diagram.drag')}
                      draggable={!current && !locked}
                      onDragStart={(e) => {
                        e.dataTransfer.setData(DRAG_TYPE, `diagram:${d.id}`);
                        e.dataTransfer.effectAllowed = 'copy';
                      }}
                      onClick={() => !current && onOpenDiagram?.(d.id)}
                      onContextMenu={(e) => {
                        if (!diagramMenu) return;
                        e.preventDefault();
                        setMenu({ x: e.clientX, y: e.clientY, id: d.id, kind: 'diagram' });
                      }}
                      onKeyDown={(e) => {
                        if (!diagramMenu || !((e.shiftKey && e.key === 'F10') || e.key === 'ContextMenu')) return;
                        e.preventDefault();
                        const r = e.currentTarget.getBoundingClientRect();
                        setMenu({ x: r.left + 16, y: r.bottom, id: d.id, kind: 'diagram' });
                      }}
                    >
                      <Workflow {...SZ} />
                      <span className="orq-pal__name">{d.name}</span>
                      {asking && <HandMark size={13} label={t('hand.diagram')} />}
                      {running && (
                        <span className="orq-pal__running" aria-hidden="true">
                          <i />
                          {t('pal.diagram.running')}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
      {steps.length > 0 && (
        <section aria-label={t('pal.steps')}>
          <Fold id="steps" label={t('pal.steps')} count={steps.length} open={isOpen('steps')} onToggle={() => toggle('steps')} />
          {isOpen('steps') && (
            <fieldset id="pal-steps" className="orq-pal__lock" disabled={locked}>
              {steps.map(({ kind, icon: Icon, label, aria, hint }) => (
                <button
                  key={kind}
                  type="button"
                  className="orq-pal__row"
                  aria-label={aria}
                  title={hint}
                  draggable
                  onDragStart={drag(kind)}
                  onClick={() => (kind === 'agent' ? onPickAgent() : kind === 'parallel' ? onParallel?.() : kind === 'humanReview' ? onAdd({ kind: 'review', human: true }) : onAdd({ kind }))}
                >
                  <Icon {...SZ} />
                  <span>{label}</span>
                </button>
              ))}
            </fieldset>
          )}
        </section>
      )}
      {RES_GROUPS.map((g, gi) => {
        const list = shownRes.filter((r) => r.kind === g.kind);
        if (list.length === 0) return null;
        const key = `res-${g.kind}`;
        // la explicación va solo en el primer grupo que se ve [R33.11]
        const first = RES_GROUPS.findIndex((x) => shownRes.some((r) => r.kind === x.kind)) === gi;
        return (
          <section key={g.kind} aria-label={t(g.label)}>
            <Fold id={key} label={t(g.label)} count={list.length} open={isOpen(key)} onToggle={() => toggle(key)} />
            {isOpen(key) && (
              <div id={`pal-${key}`} role="list">
                {first && <p className="orq-hint orq-pal__note">{t('pal.res.hint')}</p>}
                {list.map((r) => (
                  <div
                    key={`${r.kind}:${r.id}`}
                    className={`orq-pal__row orq-pal__res${r.kind === 'mcpIds' ? ' is-mcp' : ''}`}
                    role="listitem"
                    aria-label={t('pal.res.drag', { name: r.name })}
                    draggable={!locked}
                    onDragStart={(e) => {
                      e.dataTransfer.setData(DRAG_TYPE, `res:${r.kind}:${r.id}`);
                      e.dataTransfer.effectAllowed = 'copy';
                    }}
                  >
                    <g.icon {...SZ} />
                    <span className="orq-pal__name">{r.name}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        );
      })}
      {(shownAgents.length > 0 || needle === '') && (
        <section aria-label={t('pal.agents')}>
          <Fold id="agents" label={t('pal.agents')} count={shownAgents.length} open={isOpen('agents')} onToggle={() => toggle('agents')} />
          {isOpen('agents') && (
            <div id="pal-agents">
              {agents.length === 0 && <p className="orq-hint orq-pal__note">{t('pal.agents.none')}</p>}
              {group('agents-used', t('pal.agents.used'), used)}
              {group('agents-own', t('pal.agents.own'), own)}
              {group('agents-examples', t('pal.agents.examples'), demo)}
              {onNewAgent && (
                <button type="button" className="orq-btn orq-btn--ghost orq-btn--small orq-pal__new" onClick={onNewAgent}>
                  <Plus {...SZ} />
                  {t('pal.agents.new').replace(/^\+ /, '')}
                </button>
              )}
            </div>
          )}
        </section>
      )}
      {shownExamples.length > 0 && (
        <section aria-label={t('pal.templates')}>
          <Fold id="templates" label={t('pal.templates')} count={shownExamples.length} open={isOpen('templates')} onToggle={() => toggle('templates')} />
          {isOpen('templates') && (
            <fieldset id="pal-templates" className="orq-pal__lock" disabled={locked}>
              {shownExamples.map((ex) => (
                <button key={ex.id} type="button" className="orq-tpl" aria-label={ex.name} title={ex.description} onClick={() => onLoadExample(ex)}>
                  <span className="orq-tpl__name">
                    <FileText {...SZ} />
                    {ex.name}
                  </span>
                  <span className="orq-tpl__desc">{ex.description}</span>
                  <span className="orq-tpl__cta">{t('templates.load')}</span>
                </button>
              ))}
            </fieldset>
          )}
        </section>
      )}
      <p className="orq-hint orq-pal__hint">{t('pal.hint')}</p>
      {menu && menu.kind === 'diagram' && diagramMenu && <ContextMenu x={menu.x} y={menu.y} items={diagramMenu(menu.id)} onClose={() => setMenu(undefined)} />}
      {menu && menu.kind !== 'diagram' && agentMenu && <ContextMenu x={menu.x} y={menu.y} items={agentMenu(menu.id)} onClose={() => setMenu(undefined)} />}
    </aside>
  );
}

/** Skills, contextos y MCP para arrastrar, cada uno en su desplegable [R33.11]. */
const RES_GROUPS = [
  { kind: 'skillIds', label: 'pal.res.skills', icon: BookOpen },
  { kind: 'contextIds', label: 'pal.res.contexts', icon: FileText },
  { kind: 'mcpIds', label: 'pal.res.mcp', icon: Plug },
] as const;
const FOLDS_KEY = 'orq-pal-folds';
function readFolds(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(FOLDS_KEY);
    const v: unknown = raw ? JSON.parse(raw) : {};
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

/** Cabecera plegable de una sección del panel [R32.39]. */
function Fold({ id, label, count, open, onToggle, small = false }: { id: string; label: string; count: number; open: boolean; onToggle: () => void; small?: boolean }) {
  return (
    <button type="button" className={`orq-pal__fold${small ? ' is-small' : ''}`} aria-expanded={open} aria-controls={`pal-${id}`} onClick={onToggle}>
      <ChevronRight size={14} strokeWidth={1.75} aria-hidden="true" className="orq-pal__chev" />
      <span>{label}</span>
      <em>{count}</em>
    </button>
  );
}
