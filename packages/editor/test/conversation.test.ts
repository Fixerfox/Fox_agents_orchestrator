import { describe, expect, it } from 'vitest';
import { conversationBlocks, toolTarget, type TranscriptItem } from '../src';

describe('SPEC-069 · conversación (editor)', () => {
  it('[R69.2] junta las herramientas seguidas y deja lo demás en su orden', () => {
    const items: TranscriptItem[] = [
      { kind: 'text', text: 'Empiezo' },
      { kind: 'tool', tool: 'Read', ok: true },
      { kind: 'tool', tool: 'Read', ok: true },
      { kind: 'tool', tool: 'Bash', ok: false },
      { kind: 'text', text: 'Sigo' },
      { kind: 'tool', tool: 'Grep', ok: true },
      { kind: 'output', status: 'succeeded', text: 'Listo' },
    ];
    const blocks = conversationBlocks(items);
    expect(blocks.map((b) => b.kind)).toEqual(['text', 'tools', 'text', 'tools', 'output']);
    expect(blocks[1]!.kind === 'tools' && blocks[1]!.tools.map((t) => t.tool)).toEqual(['Read', 'Read', 'Bash']);
    expect(blocks[3]!.kind === 'tools' && blocks[3]!.tools).toHaveLength(1);
    expect(conversationBlocks([])).toEqual([]);
  });

  it('[R69.2] el objetivo de una herramienta: fichero, comando, patrón o dirección, corto', () => {
    expect(toolTarget({ file_path: 'src/main.ts', limit: 20 })).toBe('src/main.ts');
    expect(toolTarget({ command: 'npm test\n--silent' })).toBe('npm test');
    expect(toolTarget({ pattern: 'TODO', path: '' })).toBe('TODO');
    expect(toolTarget({ url: 'https://example.com' })).toBe('https://example.com');
    expect(toolTarget({ command: 'x'.repeat(100) }, 10)).toBe('xxxxxxxxx…');
    expect(toolTarget({ other: 1 })).toBeUndefined();
    expect(toolTarget(undefined)).toBeUndefined();
    expect(toolTarget('texto')).toBeUndefined();
  });
});
