import { describe, expect, it } from 'vitest';
import { ASSISTANT_MAX_SAVED_ITEMS, ASSISTANT_MAX_TABS } from '@orquestador/editor';
import { INTERRUPTED, activeTab, closeTab, emptyTabs, fromSaved, needsAnswer, openTab, tabLabel, tabOfItem, tabOfTurn, tabTitle, toSaved, updateTab, type AssistantTabs, type ChatItem } from '../src/assistant/tabs';

const user = (id: string, text = 'hola'): ChatItem => ({ kind: 'user', id, text });
const withItems = (s: AssistantTabs, id: string, items: ChatItem[], extra = {}) => updateTab(s, id, (x) => ({ ...x, items, ...extra }), 1);

describe('SPEC-086 · pestañas del asistente (lógica)', () => {
  it('[R86.1] empieza con una pestaña vacía y activa', () => {
    const s = emptyTabs(5);
    expect(s.tabs).toHaveLength(1);
    expect(s.activeId).toBe(s.tabs[0]!.id);
    expect(activeTab(s)).toMatchObject({ title: '', items: [], updatedAt: 5 });
  });

  it('[R86.2] abre una pestaña nueva y la activa; si la activa está vacía, la reutiliza', () => {
    const s0 = emptyTabs();
    const reused = openTab(s0, { pending: 'Da de alta el MCP de Notion' });
    expect(reused.tabs).toHaveLength(1);
    expect(activeTab(reused)).toMatchObject({ pending: 'Da de alta el MCP de Notion', title: 'Da de alta el MCP de Notion' });
    const busy = withItems(reused, reused.activeId, [user('u1')], { pending: undefined });
    const next = openTab(busy, { pending: 'Crea una skill' });
    expect(next.tabs).toHaveLength(2);
    expect(next.activeId).not.toBe(busy.activeId);
    expect(activeTab(next).pending).toBe('Crea una skill');
  });

  it('[R86.3] con el máximo, cierra la más antigua que no esté activa ni trabajando; si todas trabajan, ninguna', () => {
    let s = emptyTabs(0);
    s = withItems(s, s.activeId, [user('u0')]);
    for (let i = 1; i < ASSISTANT_MAX_TABS; i++) {
      s = openTab(s, { title: `t${i}` }, i * 10);
      s = updateTab(s, s.activeId, (x) => ({ ...x, items: [user(`u${i}`)] }), i * 10);
    }
    expect(s.tabs).toHaveLength(ASSISTANT_MAX_TABS);
    const first = s.tabs[0]!;
    const working = updateTab(s, first.id, (x) => ({ ...x, turnId: 't-0' }), 0);
    const opened = openTab(working, { title: 'nueva' }, 999);
    expect(opened.tabs).toHaveLength(ASSISTANT_MAX_TABS);
    expect(opened.tabs.some((x) => x.id === first.id)).toBe(true);
    expect(opened.tabs.some((x) => x.title === 't1')).toBe(false);
    let allBusy = s;
    for (const tab of s.tabs) allBusy = updateTab(allBusy, tab.id, (x) => ({ ...x, turnId: `t-${tab.id}` }), 1);
    expect(openTab(allBusy, {}, 2).tabs).toHaveLength(ASSISTANT_MAX_TABS + 1);
  });

  it('[R86.4] cerrar activa la de al lado; cerrar la última deja una vacía', () => {
    let s = withItems(emptyTabs(), emptyTabs().activeId, []);
    s = withItems(s, s.activeId, [user('a')]);
    s = openTab(s, { title: 'B' });
    s = withItems(s, s.activeId, [user('b')]);
    s = openTab(s, { title: 'C' });
    const [a, b, c] = s.tabs;
    const afterB = closeTab({ ...s, activeId: b!.id }, b!.id);
    expect(afterB.activeId).toBe(c!.id);
    expect(closeTab({ ...s, activeId: a!.id }, c!.id).activeId).toBe(a!.id);
    const last = closeTab(emptyTabs(), emptyTabs().activeId);
    expect(last.tabs).toHaveLength(1);
    const only = emptyTabs();
    expect(closeTab(only, only.activeId).tabs[0]!.id).not.toBe(only.activeId);
  });

  it('[R86.5] el título es la primera línea recortada a 32 caracteres; sin título se llama «Nueva conversación»', () => {
    expect(tabTitle('\n  Dar de alta   el MCP  \nsegunda línea')).toBe('Dar de alta el MCP');
    expect(tabTitle('a'.repeat(40))).toBe(`${'a'.repeat(32)}…`);
    expect(tabLabel(activeTab(emptyTabs()))).toBe('Nueva conversación');
  });

  it('[R86.6] encuentra la pestaña de un turno y de una tarjeta, y sabe si espera respuesta', () => {
    let s = emptyTabs();
    const tool: ChatItem = { kind: 'tool', id: 'c1', turnId: 't1', name: 'delete_agent', args: {}, status: 'ask' };
    s = withItems(s, s.activeId, [user('u1'), tool], { turnId: 't1' });
    expect(tabOfTurn(s, 't1')?.id).toBe(s.activeId);
    expect(tabOfTurn(s, 'otro')).toBeUndefined();
    expect(tabOfItem(s, 'c1')?.id).toBe(s.activeId);
    expect(needsAnswer(activeTab(s))).toBe(true);
    const done = updateTab(s, s.activeId, (x) => ({ ...x, items: [user('u1'), { ...tool, status: 'done' }] }));
    expect(needsAnswer(activeTab(done))).toBe(false);
  });

  it('[R86.13] se guarda sin turno, sin envío pendiente ni deshacer, con los últimos 200 elementos; al recuperar, lo que esperaba queda interrumpido', () => {
    let s = emptyTabs();
    const items: ChatItem[] = Array.from({ length: ASSISTANT_MAX_SAVED_ITEMS + 5 }, (_, i) => user(`u${i}`));
    items.push({ kind: 'tool', id: 'c1', turnId: 't1', name: 'create_agent', args: {}, status: 'done', undo: async () => undefined });
    items.push({ kind: 'tool', id: 'c2', turnId: 't1', name: 'delete_agent', args: {}, status: 'ask' });
    s = withItems(s, s.activeId, items, { turnId: 't1', pending: 'x', title: 'Agentes' });
    const saved = toSaved(s);
    const tab = saved.tabs[0]!;
    expect(tab.items).toHaveLength(ASSISTANT_MAX_SAVED_ITEMS);
    expect(JSON.stringify(saved)).not.toContain('undo');
    expect(tab).not.toHaveProperty('turnId');
    expect(tab).not.toHaveProperty('pending');
    const back = fromSaved(JSON.parse(JSON.stringify(saved)));
    const c2 = activeTab(back).items.find((it) => it.id === 'c2');
    expect(c2).toMatchObject({ status: 'denied', summary: INTERRUPTED });
    expect(activeTab(back).items.find((it) => it.id === 'c1')).toMatchObject({ status: 'done' });
    expect(fromSaved(null).tabs).toHaveLength(1);
  });

  it('[R86.12] nunca guarda más del máximo de pestañas: las más recientes y siempre la activa', () => {
    const tabs = Array.from({ length: ASSISTANT_MAX_TABS + 2 }, (_, i) => ({ id: `tab-${i}`, title: `t${i}`, items: [user(`u${i}`)], updatedAt: i }));
    const saved = toSaved({ tabs, activeId: 'tab-0' });
    expect(saved.tabs).toHaveLength(ASSISTANT_MAX_TABS);
    expect(saved.tabs.map((x) => x.id)).toContain('tab-0');
    expect(saved.tabs.map((x) => x.id)).not.toContain('tab-1');
  });
});
