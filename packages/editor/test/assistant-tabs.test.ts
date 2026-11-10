import { describe, expect, it } from 'vitest';
import { ASSISTANT_MAX_SAVED_ITEMS, ASSISTANT_MAX_TABS, CHANNELS, ContractError, parseRequest, type SavedAssistantTabs } from '../src';

const doc = (over: Partial<SavedAssistantTabs> = {}): SavedAssistantTabs => ({
  activeId: 'tab-1',
  tabs: [{ id: 'tab-1', title: 'MCP de Notion', updatedAt: 1, items: [{ kind: 'user', id: 'u1', text: 'hola' }, { kind: 'tool', id: 'c1', turnId: 't1', name: 'create_mcp', args: { name: 'Notion' }, status: 'done' }, { kind: 'read', id: 'r1', tool: 'Glob', target: '*', ok: true }] }],
  ...over,
});
const tab = (i: number) => ({ id: `tab-${i}`, title: 't', updatedAt: i, items: [] });

describe('SPEC-086 · contrato de las pestañas', () => {
  it('[R86.12] acepta pestañas válidas y load no admite argumentos', () => {
    expect(parseRequest(CHANNELS.assistantTabsSave, doc())).toEqual(doc());
    expect(parseRequest(CHANNELS.assistantTabsLoad, undefined)).toBeUndefined();
    expect(() => parseRequest(CHANNELS.assistantTabsLoad, { x: 1 })).toThrow(ContractError);
  });

  it('[R86.12] rechaza demasiadas pestañas o elementos, ids inseguros, títulos largos y elementos desconocidos', () => {
    const bad = [
      doc({ tabs: Array.from({ length: ASSISTANT_MAX_TABS + 1 }, (_, i) => tab(i)) }),
      doc({ tabs: [{ ...tab(1), items: Array.from({ length: ASSISTANT_MAX_SAVED_ITEMS + 1 }, (_, i) => ({ kind: 'user' as const, id: `u${i}`, text: 'x' })) }] }),
      doc({ activeId: '../x' }),
      doc({ tabs: [{ ...tab(1), id: 'a/b' }] }),
      doc({ tabs: [{ ...tab(1), title: 'x'.repeat(81) }] }),
      doc({ tabs: [{ ...tab(1), items: [{ kind: 'raro', id: 'u1', text: 'x' } as never] }] }),
      doc({ tabs: [{ ...tab(1), items: [{ kind: 'tool', id: 'c1', turnId: 't', name: 'x', args: {}, status: 'inventado' } as never] }] }),
      { ...doc(), extra: true },
    ];
    for (const b of bad) expect(() => parseRequest(CHANNELS.assistantTabsSave, b)).toThrow(ContractError);
  });
});
