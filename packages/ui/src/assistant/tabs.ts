import { ASSISTANT_MAX_SAVED_ITEMS, ASSISTANT_MAX_TABS, ASSISTANT_TAB_TITLE_MAX, t, type SavedAssistantTabs, type SavedChatItem } from '@orquestador/editor';

/** Un elemento de la conversación: mensaje o tarjeta de acción; las acciones hechas pueden deshacerse [R29.5]. */
export type ChatItem = Exclude<SavedChatItem, { kind: 'tool' }> | (Extract<SavedChatItem, { kind: 'tool' }> & { undo?: () => Promise<void> });

/** Una pestaña del asistente: su conversación y, si trabaja o espera enviar, su turno y su petición [R86.1]. */
export interface ChatTab {
  id: string;
  /** Vacío hasta el primer mensaje; se muestra con `tabLabel`. */
  title: string;
  items: ChatItem[];
  updatedAt: number;
  turnId?: string | undefined;
  /** Petición ya escrita que se envía en cuanto la pestaña está libre [R30.10]. */
  pending?: string | undefined;
}

export interface AssistantTabs {
  tabs: ChatTab[];
  activeId: string;
}

export const TITLE_CHARS = 32;
export const INTERRUPTED = 'Interrumpida al cerrar la app';
const WAITING = new Set(['running', 'ask', 'secret', 'choice']);

let seq = 0;
export const newTabId = () => `tab-${Date.now().toString(36)}-${++seq}`;

const blank = (now = Date.now()): ChatTab => ({ id: newTabId(), title: '', items: [], updatedAt: now });

/** Una pestaña vacía y activa [R86.1]. */
export function emptyTabs(now = Date.now()): AssistantTabs {
  const tab = blank(now);
  return { tabs: [tab], activeId: tab.id };
}

export const activeTab = (s: AssistantTabs): ChatTab => s.tabs.find((x) => x.id === s.activeId) ?? s.tabs[0]!;
const isEmpty = (tab: ChatTab) => tab.items.length === 0 && tab.turnId === undefined && tab.pending === undefined;

/** Título de una pestaña a partir de un texto: primera línea, recortada [R86.5]. */
export function tabTitle(text: string): string {
  const line = (text.split('\n').find((l) => l.trim()) ?? '').replace(/\s+/g, ' ').trim();
  return line.length > TITLE_CHARS ? `${line.slice(0, TITLE_CHARS).trimEnd()}…` : line;
}

/** Lo que se ve en la pestaña [R86.5]. */
export const tabLabel = (tab: ChatTab): string => tab.title || t('as.tab.new');

/**
 * Abre una pestaña y la activa; reutiliza la activa si está vacía [R86.2]. Con el máximo, cierra antes la más antigua
 * que no esté activa ni trabajando [R86.3].
 */
export function openTab(s: AssistantTabs, o: { pending?: string; title?: string } = {}, now = Date.now()): AssistantTabs {
  const title = (o.title ?? (o.pending !== undefined ? tabTitle(o.pending) : '')).slice(0, ASSISTANT_TAB_TITLE_MAX);
  const current = activeTab(s);
  if (isEmpty(current)) {
    const reused: ChatTab = { ...current, title, updatedAt: now, ...(o.pending !== undefined ? { pending: o.pending } : {}) };
    return { tabs: s.tabs.map((x) => (x.id === current.id ? reused : x)), activeId: current.id };
  }
  let tabs = s.tabs;
  if (tabs.length >= ASSISTANT_MAX_TABS) {
    const oldest = [...tabs].filter((x) => x.id !== s.activeId && x.turnId === undefined).sort((a, b) => a.updatedAt - b.updatedAt)[0];
    if (oldest) tabs = tabs.filter((x) => x.id !== oldest.id);
  }
  const tab: ChatTab = { ...blank(now), title, ...(o.pending !== undefined ? { pending: o.pending } : {}) };
  return { tabs: [...tabs, tab], activeId: tab.id };
}

/** Quita una pestaña y activa la de al lado; si era la última, deja una vacía [R86.4]. */
export function closeTab(s: AssistantTabs, id: string, now = Date.now()): AssistantTabs {
  const i = s.tabs.findIndex((x) => x.id === id);
  if (i < 0) return s;
  const tabs = s.tabs.filter((x) => x.id !== id);
  if (tabs.length === 0) return emptyTabs(now);
  const activeId = s.activeId === id ? tabs[Math.min(i, tabs.length - 1)]!.id : s.activeId;
  return { tabs, activeId };
}

/** Cambia una pestaña; la marca como usada ahora [R86.1]. */
export function updateTab(s: AssistantTabs, id: string, fn: (tab: ChatTab) => ChatTab, now = Date.now()): AssistantTabs {
  let changed = false;
  const tabs = s.tabs.map((x) => {
    if (x.id !== id) return x;
    const next = fn(x);
    if (next === x) return x;
    changed = true;
    return { ...next, updatedAt: now };
  });
  return changed ? { ...s, tabs } : s;
}

/** La pestaña que lanzó un turno [R86.6]. */
export const tabOfTurn = (s: AssistantTabs, turnId: string): ChatTab | undefined => s.tabs.find((x) => x.turnId === turnId);

/** La pestaña que tiene una tarjeta, por su id [R86.10]. */
export const tabOfItem = (s: AssistantTabs, itemId: string): ChatTab | undefined => s.tabs.find((x) => x.items.some((it) => it.id === itemId));

/** ¿Tiene la pestaña una acción esperando a la persona? [R86.6] */
export const needsAnswer = (tab: ChatTab): boolean => tab.items.some((it) => it.kind === 'tool' && (it.status === 'ask' || it.status === 'secret' || it.status === 'choice'));

/** Lo que se guarda: sin turnos, sin envíos pendientes, sin funciones y con los últimos elementos [R86.13]. */
export function toSaved(s: AssistantTabs): SavedAssistantTabs {
  // Como mucho el máximo: las más recientes y siempre la activa [R86.12].
  const keep = new Set([s.activeId, ...[...s.tabs].sort((a, b) => b.updatedAt - a.updatedAt).map((x) => x.id)].slice(0, ASSISTANT_MAX_TABS));
  return {
    activeId: s.activeId,
    tabs: s.tabs.filter((x) => keep.has(x.id)).map((tab) => ({
      id: tab.id,
      title: tab.title.slice(0, ASSISTANT_TAB_TITLE_MAX),
      updatedAt: tab.updatedAt,
      items: tab.items.slice(-ASSISTANT_MAX_SAVED_ITEMS).map((it) => {
        if (it.kind !== 'tool') return it;
        const { undo: _undo, ...rest } = it;
        void _undo;
        return rest;
      }),
    })),
  };
}

/** Recupera lo guardado; lo que estaba trabajando o esperando queda interrumpido [R86.13]. */
export function fromSaved(doc: SavedAssistantTabs | null | undefined, now = Date.now()): AssistantTabs {
  if (!doc || doc.tabs.length === 0) return emptyTabs(now);
  const tabs: ChatTab[] = doc.tabs.map((tab) => ({
    id: tab.id,
    title: tab.title,
    updatedAt: tab.updatedAt,
    items: tab.items.map((it) => (it.kind === 'tool' && WAITING.has(it.status) ? { ...it, status: 'denied' as const, summary: INTERRUPTED } : it)),
  }));
  return { tabs, activeId: tabs.some((x) => x.id === doc.activeId) ? doc.activeId : tabs[0]!.id };
}
