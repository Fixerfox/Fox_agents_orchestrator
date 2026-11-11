import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Check, Eye, KeyRound, Loader2, MessageCircleQuestion, Search, ShieldAlert, Sparkles, Square, SquarePen, Undo2, Wand2, Workflow, X } from 'lucide-react';
import { ASSISTANT_MAX_MESSAGES, t, type AssistantEvent, type AssistantMessage, type MessageKey, type ProjectApi } from '@orquestador/editor';
import { alwaysConfirms, isDestructive, isInteractive, isReadOnly, runAssistantTool, storeAssistantSecret, type AssistantHost, type ToolOutcome } from './assistantTools';
import { activeTab, closeTab, needsAnswer, openTab, tabLabel, tabOfItem, tabOfTurn, tabTitle, updateTab, type AssistantTabs, type ChatItem, type ChatTab } from './tabs';
import { Markdown } from '../common';

export type { ChatItem } from './tabs';

let seq = 0;
const nextId = (p: string) => `${p}-${Date.now().toString(36)}-${++seq}`;

/** Historial que se envía en cada turno: mensajes del usuario y respuestas finales [R29.4]. */
export function historyOf(items: ChatItem[]): AssistantMessage[] {
  const msgs: AssistantMessage[] = [];
  for (const it of items) {
    if (it.kind === 'user' || (it.kind === 'assistant' && it.text.trim())) msgs.push({ role: it.kind, text: it.text });
    // Lo respondido con botones también cuenta como mensaje del usuario en los turnos siguientes [R38.5].
    else if (it.kind === 'tool' && it.name === 'ask_user' && it.answer !== undefined)
      msgs.push({ role: 'user', text: t('as.choice.history', { question: typeof it.args['question'] === 'string' ? it.args['question'] : '', answer: it.answer }) });
  }
  return msgs.slice(-ASSISTANT_MAX_MESSAGES);
}

/** Dónde está el usuario: cambia las sugerencias y la cabecera [R38.3][R38.4]. */
export type AssistantWhere = 'diagrams' | 'library' | 'agents' | 'knowledge' | 'jobs' | 'runs' | 'versions' | 'project' | 'settings';
const SUGGESTIONS: Record<'diagrams' | 'agents' | 'knowledge' | 'versions', readonly MessageKey[]> = {
  versions: ['as.sug.v.1', 'as.sug.v.2', 'as.sug.v.3'],
  diagrams: ['as.sug.1', 'as.sug.2', 'as.sug.3'],
  agents: ['as.sug.a.1', 'as.sug.a.2', 'as.sug.a.3'],
  knowledge: ['as.sug.k.1', 'as.sug.k.2', 'as.sug.k.3'],
};
const SUG_ICON = [MessageCircleQuestion, Wand2, Workflow] as const;

interface Props {
  api: ProjectApi;
  host: AssistantHost;
  /** Todas las pestañas: los turnos de las que no se ven siguen recibiendo sus eventos [R86.10]. */
  tabs: AssistantTabs;
  setTabs: (fn: (s: AssistantTabs) => AssistantTabs) => void;
  onClose?: () => void;
  where?: AssistantWhere;
  /** Pedir «Permitir» en lo que borra o ejecuta; con «Sin preguntar nunca», no [R51.3]. */
  confirmActions?: boolean;
}

type ToolItem = Extract<ChatItem, { kind: 'tool' }>;
/** Elementos a dibujar: las consultas seguidas ya hechas van juntas en una línea [R38.3]. */
type Row = { kind: 'item'; item: ChatItem } | { kind: 'reads'; id: string; items: ToolItem[] };
export function groupRows(items: ChatItem[]): Row[] {
  const rows: Row[] = [];
  for (const it of items) {
    const read = it.kind === 'tool' && it.status === 'done' && isReadOnly(it.name);
    const last = rows[rows.length - 1];
    if (read && last?.kind === 'reads') last.items.push(it);
    else if (read) rows.push({ kind: 'reads', id: it.id, items: [it] });
    else rows.push({ kind: 'item', item: it });
  }
  return rows;
}

export function AssistantPanel({ api, host, tabs, setTabs, onClose, where = 'diagrams', confirmActions = true }: Props) {
  const state = activeTab(tabs);
  const strip = useRef<HTMLDivElement>(null);
  // La pestaña activa siempre a la vista, aunque no quepan todas [R86.7].
  useEffect(() => {
    strip.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [state.id]);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  /** Cambia la pestaña que lanzó un turno, se vea o no [R86.10]. */
  const onTurn = (turnId: string, fn: (tab: ChatTab) => ChatTab) =>
    setTabs((s) => {
      const tab = tabOfTurn(s, turnId);
      return tab ? updateTab(s, tab.id, fn) : s;
    });
  const setTab = (id: string, fn: (tab: ChatTab) => ChatTab) => setTabs((s) => updateTab(s, id, fn));
  const [draft, setDraft] = useState('');
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const hostRef = useRef(host);
  hostRef.current = host;
  const confirmRef = useRef(confirmActions);
  confirmRef.current = confirmActions;
  const busy = state.turnId !== undefined;

  useEffect(() => {
    list.current?.scrollTo?.({ top: list.current.scrollHeight });
  }, [state.items]);
  // El campo crece con el texto hasta un máximo [R38.3].
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(260, Math.max(66, el.scrollHeight))}px`;
  }, [draft]);

  // Eventos del turno en curso: texto, herramientas y fin [R29.4].
  useEffect(
    () =>
      api.onAssistantEvents((turnId, e: AssistantEvent) => {
        if (e.type === 'text') {
          onTurn(turnId, (s) => {
            const last = s.items[s.items.length - 1];
            if (last?.kind === 'assistant') return { ...s, items: [...s.items.slice(0, -1), { ...last, text: last.text + e.text }] };
            return { ...s, items: [...s.items, { kind: 'assistant', id: nextId('a'), text: e.text }] };
          });
        } else if (e.type === 'read') {
          // Una línea discreta por lectura; no va al historial [R29.9].
          onTurn(turnId, (s) => ({ ...s, items: [...s.items, { kind: 'read', id: nextId('r'), tool: e.tool, target: e.target, ok: e.ok }] }));
        } else if (e.type === 'tool') {
          // Una pestaña cerrada ya detuvo su turno: no se ejecuta nada [R86.8].
          if (!tabOfTurn(tabsRef.current, turnId)) return;
          const ask = isDestructive(e.name) && (confirmRef.current || alwaysConfirms(e.name));
          const waits = isInteractive(e.name);
          const status = waits ? (e.name === 'ask_user' ? 'choice' : 'secret') : ask ? 'ask' : 'running';
          onTurn(turnId, (s) => ({ ...s, items: [...s.items, { kind: 'tool', id: e.callId, turnId, name: e.name, args: e.args, status }] }));
          if (!ask && !waits) void execute(turnId, e.callId, e.name, e.args);
        } else if (e.type === 'done') {
          onTurn(turnId, (s) => ({ ...s, turnId: undefined }));
        } else {
          onTurn(turnId, (s) => ({ ...s, items: [...s.items, { kind: 'error', id: nextId('e'), text: e.message }], turnId: undefined }));
        }
      }),
    [api],
  );

  /** La tarjeta se actualiza en su pestaña, aunque no sea la que se ve [R86.10]. */
  const patchTool = (id: string, patch: Partial<Extract<ChatItem, { kind: 'tool' }>>) =>
    setTabs((s) => {
      const tab = tabOfItem(s, id);
      return tab ? updateTab(s, tab.id, (x) => ({ ...x, items: x.items.map((it) => (it.kind === 'tool' && it.id === id ? { ...it, ...patch } : it)) })) : s;
    });

  const execute = async (turnId: string, callId: string, name: string, args: Record<string, unknown>) => {
    patchTool(callId, { status: 'running' });
    const out: ToolOutcome = await runAssistantTool(hostRef.current, name, args);
    patchTool(callId, { status: out.ok ? 'done' : 'error', summary: out.summary, ...(out.undo ? { undo: out.undo } : {}) });
    await api.assistantToolResult({ turnId, callId, ok: out.ok, result: out.result });
  };
  /** El valor va directo al almacén cifrado; a Claude solo le llega si se guardó [R30.12]. */
  const giveSecret = async (turnId: string, callId: string, args: Record<string, unknown>, value: string | undefined) => {
    if (value === undefined) {
      patchTool(callId, { status: 'denied', summary: t('as.tool.secretSkipped', { name: typeof args['name'] === 'string' ? args['name'] : '' }) });
      await api.assistantToolResult({ turnId, callId, ok: false, result: 'El usuario no ha dado el secreto.' });
      return;
    }
    patchTool(callId, { status: 'running' });
    const out = await storeAssistantSecret(hostRef.current, args, value);
    patchTool(callId, { status: out.ok ? 'done' : 'error', summary: out.summary });
    await api.assistantToolResult({ turnId, callId, ok: out.ok, result: out.result });
  };
  /** Respuesta a una pregunta con botones: vuelve a Claude y queda en la tarjeta [R38.5]. */
  const answerChoice = async (turnId: string, callId: string, answer: string) => {
    patchTool(callId, { status: 'done', answer, summary: t('as.choice.answered', { answer }) });
    await api.assistantToolResult({ turnId, callId, ok: true, result: { answer } });
  };
  const deny = async (turnId: string, callId: string) => {
    patchTool(callId, { status: 'denied', summary: t('as.denied') });
    await api.assistantToolResult({ turnId, callId, ok: false, result: 'El usuario no lo ha permitido.' });
  };

  /** Envía un mensaje en una pestaña, con el historial de esa pestaña [R86.9]. */
  const sendIn = async (tabId: string, text: string) => {
    const clean = text.trim();
    const tab = tabsRef.current.tabs.find((x) => x.id === tabId);
    if (!clean || !tab || tab.turnId !== undefined) return;
    const turnId = nextId('t');
    const items: ChatItem[] = [...tab.items, { kind: 'user', id: nextId('u'), text: clean }];
    const start = (x: ChatTab): ChatTab => ({ ...x, items, turnId, pending: undefined, title: x.title || tabTitle(clean) });
    // La referencia se adelanta para que los eventos del turno encuentren ya su pestaña.
    tabsRef.current = updateTab(tabsRef.current, tabId, start);
    setTab(tabId, start);
    const r = await api.assistantSend({ turnId, messages: historyOf(items) });
    if (!r.ok) setTab(tabId, (x) => ({ ...x, items: [...x.items, { kind: 'error', id: nextId('e'), text: r.error.message }], turnId: undefined }));
  };
  const send = (text: string) => {
    if (!text.trim() || busy) return;
    setDraft('');
    void sendIn(state.id, text);
  };
  // Peticiones ya escritas desde otro sitio de la app: cada pestaña envía la suya en cuanto está libre [R30.10][R86.9].
  useEffect(() => {
    for (const tab of tabs.tabs) if (tab.pending !== undefined && tab.turnId === undefined) void sendIn(tab.id, tab.pending);
  }, [tabs]);
  const stop = () => {
    if (state.turnId) void api.assistantCancel(state.turnId);
  };
  /** Cerrar una pestaña que trabaja detiene su turno [R86.8]. */
  const close = (tab: ChatTab) => {
    if (tab.turnId) void api.assistantCancel(tab.turnId);
    setTabs((s) => closeTab(s, tab.id));
  };

  const suggestions = SUGGESTIONS[where === 'agents' || where === 'knowledge' || where === 'versions' ? where : 'diagrams'];
  const toolName = (name: string) => t(`as.t.${name}` as MessageKey);
  const toolCard = (it: ToolItem) => (
    <article key={it.id} className={`orq-assist__tool is-${it.status}`} aria-label={t('as.action', { name: toolName(it.name) })}>
      <div className="orq-assist__toolhead">
        <span className="orq-assist__toolicon" aria-hidden="true">
          {it.status === 'running' ? (
            <Loader2 size={13} className="orq-spin" />
          ) : it.status === 'ask' ? (
            <ShieldAlert size={13} />
          ) : it.status === 'secret' ? (
            <KeyRound size={13} />
          ) : it.status === 'choice' ? (
            <MessageCircleQuestion size={13} />
          ) : it.status === 'done' ? (
            <Check size={13} />
          ) : it.status === 'undone' ? (
            <Undo2 size={13} />
          ) : (
            <X size={13} />
          )}
        </span>
        <strong>{it.name === 'ask_user' && typeof it.args['question'] === 'string' ? it.args['question'] : toolName(it.name)}</strong>
        {it.status === 'done' && it.undo && (
          <button
            type="button"
            className="orq-btn orq-btn--small orq-btn--ghost orq-assist__undo"
            onClick={() =>
              void it
                .undo!()
                .then(() => patchTool(it.id, { status: 'undone', summary: t('as.undone') }))
                .catch((e: unknown) => patchTool(it.id, { summary: e instanceof Error ? e.message : String(e) }))
            }
          >
            <Undo2 size={13} aria-hidden="true" />
            {t('as.undo')}
          </button>
        )}
      </div>
      {it.status === 'ask' && (
        <>
          <p className="orq-assist__tooltext">{askText(it.name, it.args)}</p>
          <div className="orq-assist__ask">
            <button type="button" className="orq-btn orq-btn--small orq-btn--primary" onClick={() => void execute(it.turnId, it.id, it.name, it.args)}>
              {t('as.allow')}
            </button>
            <button type="button" className="orq-btn orq-btn--small" onClick={() => void deny(it.turnId, it.id)}>
              {t('as.deny')}
            </button>
          </div>
        </>
      )}
      {it.status === 'secret' && <SecretAsk args={it.args} onDone={(v) => void giveSecret(it.turnId, it.id, it.args, v)} />}
      {it.status === 'choice' && <ChoiceAsk args={it.args} onAnswer={(a) => void answerChoice(it.turnId, it.id, a)} />}
      {it.summary && it.status !== 'ask' && <p className="orq-assist__tooltext">{it.summary}</p>}
    </article>
  );

  return (
    <section className="orq-assist" aria-label={t('as.title')}>
      <header className="orq-assist__head">
        <span className="orq-assist__mark" aria-hidden="true">
          <Sparkles size={14} strokeWidth={1.75} />
        </span>
        <div className="orq-assist__titles">
          <h2>{t('as.title')}</h2>
          <span className="orq-assist__where">{t(`as.where.${where}` as MessageKey)}</span>
        </div>
        {state.items.length > 0 && (
          <button type="button" className="orq-ib" aria-label={t('as.clear')} title={t('as.clear')} onClick={() => setTabs((s) => openTab(s))}>
            <SquarePen size={16} aria-hidden="true" />
          </button>
        )}
        {onClose && (
          <button type="button" className="orq-ib" aria-label={t('as.close')} title={t('as.close')} onClick={onClose}>
            <X size={16} aria-hidden="true" />
          </button>
        )}
      </header>
      <div className="orq-assist__tabs" role="tablist" aria-label={t('as.tabs')} ref={strip}>
        {tabs.tabs.map((tab) => {
          const label = tabLabel(tab);
          const selected = tab.id === state.id;
          return (
            <div key={tab.id} className={`orq-assist__tab${selected ? ' is-active' : ''}`}>
              <button type="button" role="tab" aria-selected={selected} className="orq-assist__tabbtn" title={label} onClick={() => setTabs((s) => ({ ...s, activeId: tab.id }))}>
                {/* Lo que espera a la persona va delante de «trabajando» [R86.7]. */}
                {!selected && needsAnswer(tab) ? (
                  <span className="orq-assist__tabdot" role="img" aria-label={t('as.tab.needs')} />
                ) : tab.turnId !== undefined ? (
                  <Loader2 size={11} className="orq-spin" aria-label={t('as.tab.busy')} />
                ) : null}
                <span className="orq-assist__tablabel">{label}</span>
              </button>
              <button type="button" className="orq-assist__tabclose" aria-label={t('as.tab.close', { name: label })} title={t('as.tab.close', { name: label })} onClick={() => close(tab)}>
                <X size={11} aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
      <div className="orq-assist__list" ref={list} role="log" aria-live="polite" aria-label={t('as.log')}>
        {state.items.length === 0 && (
          <div className="orq-assist__empty">
            <span className="orq-assist__hero" aria-hidden="true">
              <Sparkles size={22} strokeWidth={1.5} />
            </span>
            <h3>{t('as.hello')}</h3>
            <p>{t('as.empty')}</p>
            <div className="orq-assist__sugs">
              {suggestions.map((k, i) => {
                const Icon = SUG_ICON[i] ?? Wand2;
                return (
                  <button key={k} type="button" className="orq-assist__sug" onClick={() => void send(t(k))}>
                    <Icon size={15} strokeWidth={1.5} aria-hidden="true" />
                    <span>{t(k)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {groupRows(state.items).map((row) => {
          if (row.kind === 'reads')
            return (
              <p key={row.id} className="orq-assist__reads">
                <Search size={12} aria-hidden="true" />
                {t('as.consulted', { what: [...new Set(row.items.map((x) => toolName(x.name).toLocaleLowerCase('es')))].join(', ') })}
              </p>
            );
          const it = row.item;
          if (it.kind === 'user')
            return (
              <div key={it.id} className="orq-assist__msg is-user">
                <span className="orq-sr">{t('as.you')}: </span>
                {it.text}
              </div>
            );
          if (it.kind === 'assistant')
            return (
              <div key={it.id} className="orq-assist__msg is-ai">
                <span className="orq-assist__avatar" aria-hidden="true">
                  <Sparkles size={12} strokeWidth={1.75} />
                </span>
                <Markdown text={it.text} />
              </div>
            );
          if (it.kind === 'read')
            return (
              <p key={it.id} className={`orq-assist__read${it.ok ? '' : ' is-denied'}`}>
                <Eye size={12} aria-hidden="true" /> {readText(it.tool, it.target, it.ok)}
              </p>
            );
          if (it.kind === 'error')
            return (
              <p key={it.id} className="orq-assist__msg is-error" role="alert">
                {it.text}
              </p>
            );
          return toolCard(it);
        })}
        {busy && !state.items.some((x) => x.kind === 'tool' && (x.status === 'ask' || x.status === 'secret' || x.status === 'choice')) && (
          <p className="orq-assist__thinking" role="status">
            <span className="orq-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            {t('as.thinking')}
          </p>
        )}
      </div>
      <form
        className="orq-assist__form"
        onSubmit={(e) => {
          e.preventDefault();
          void send(draft);
        }}
      >
        <div className="orq-assist__box">
          <textarea
            ref={input}
            aria-label={t('as.input')}
            placeholder={t('as.placeholder')}
            rows={3}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send(draft);
              }
            }}
          />
          {busy ? (
            <button type="button" className="orq-assist__send is-stop" aria-label={t('as.stop')} title={t('as.stop')} onClick={stop}>
              <Square size={13} fill="currentColor" aria-hidden="true" />
            </button>
          ) : (
            <button type="submit" className="orq-assist__send" aria-label={t('as.send')} title={t('as.send')} disabled={draft.trim() === ''}>
              <ArrowUp size={16} strokeWidth={2} aria-hidden="true" />
            </button>
          )}
        </div>
        <p className="orq-assist__keys">{t('as.hint.keys')}</p>
      </form>
    </section>
  );
}

/** Pregunta con botones; también se puede escribir otra respuesta [R38.5]. */
function ChoiceAsk({ args, onAnswer }: { args: Record<string, unknown>; onAnswer: (answer: string) => void }) {
  const [other, setOther] = useState('');
  const options = (Array.isArray(args['options']) ? args['options'] : []).filter((x): x is string => typeof x === 'string' && x.trim() !== '').slice(0, 6);
  const sendOther = () => {
    const v = other.trim();
    if (v) onAnswer(v);
  };
  return (
    <div className="orq-assist__choice">
      <div className="orq-assist__options" role="group" aria-label={typeof args['question'] === 'string' ? args['question'] : t('as.t.ask_user')}>
        {options.map((o) => (
          <button key={o} type="button" className="orq-assist__option" onClick={() => onAnswer(o)}>
            {o}
          </button>
        ))}
      </div>
      <div className="orq-assist__other">
        <input
          aria-label={t('as.choice.other')}
          placeholder={t('as.choice.other')}
          value={other}
          onChange={(e) => setOther(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') {
              e.preventDefault();
              sendOther();
            }
          }}
        />
        <button type="button" className="orq-btn orq-btn--small" disabled={other.trim() === ''} onClick={sendOther}>
          {t('as.choice.send')}
        </button>
      </div>
    </div>
  );
}

/** Tarjeta para escribir un secreto: el valor no sale de aquí salvo hacia el almacén cifrado [R30.12]. */
function SecretAsk({ args, onDone }: { args: Record<string, unknown>; onDone: (value: string | undefined) => void }) {
  const [value, setValue] = useState('');
  const v = (k: string) => (typeof args[k] === 'string' ? (args[k] as string) : '');
  const submit = () => {
    if (value === '') return;
    const out = value;
    setValue('');
    onDone(out);
  };
  return (
    <div className="orq-assist__secret">
      <p className="orq-assist__secret-title">{t('as.secret.title', { name: v('name'), mcp: v('mcpId') })}</p>
      {v('why') && <p className="orq-hint">{v('why')}</p>}
      <input
        type="password"
        autoComplete="off"
        spellCheck={false}
        aria-label={t('as.secret.label', { name: v('name') })}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') {
            e.preventDefault();
            submit();
          }
        }}
      />
      <p className="orq-hint">{t('as.secret.hint')}</p>
      <div className="orq-assist__ask">
        <button type="button" className="orq-btn orq-btn--small orq-btn--primary" disabled={value === ''} onClick={submit}>
          {t('as.secret.save')}
        </button>
        <button type="button" className="orq-btn orq-btn--small" onClick={() => (setValue(''), onDone(undefined))}>
          {t('as.secret.skip')}
        </button>
      </div>
    </div>
  );
}

/** Explicación de lo que pide permiso [R29.3]. */
function askText(name: string, args: Record<string, unknown>): string {
  const v = (k: string) => (typeof args[k] === 'string' ? (args[k] as string) : '');
  if (name === 'test_mcp') return t('as.ask.test', { id: v('id') });
  if (name === 'open_terminal') return v('program') === 'shell' ? t('as.ask.terminal', { program: t('term.shell') }) : v('prompt') ? t('as.ask.terminal.prompt', { prompt: v('prompt') }) : t('as.ask.terminal', { program: t('term.claude') });
  if (name === 'run_diagram') return t('as.ask.run', { input: v('input') });
  if (name === 'resume_run') return t('as.ask.resume', { id: v('runId') });
  if (name === 'accept_run') return t('as.ask.accept', { id: v('runId'), reason: v('reason') });
  if (name === 'remove_step') return t('as.ask.remove', { node: v('nodeId') });
  if (name === 'git_switch_branch') return t('as.ask.git.switch', { branch: v('name') });
  if (name === 'git_push') return t('as.ask.git.push');
  if (name === 'git_pull') return t('as.ask.git.pull');
  if (name === 'git_merge_branch') return t('as.ask.git.merge', { branch: v('name') });
  if (name === 'git_delete_branch') return t('as.ask.git.delete', { branch: v('name') });
  return t('as.ask.delete', { id: v('id') });
}

/** Texto de una lectura: solo nombre, patrón o dominio [R29.9]. */
export function readText(tool: string, target: string, ok: boolean): string {
  const known = ['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash', 'Agent'].includes(tool);
  const what = known ? t(`as.read.${tool}` as never, { target: target || '…' }) : `${tool} ${target}`.trim();
  return ok ? what : t('as.read.denied', { what });
}
