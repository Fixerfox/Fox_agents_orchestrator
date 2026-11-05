import { describe, expect, it } from 'vitest';
import { ASSISTANT_TOOLS, CHANNELS, ContractError, parseInline, parseMarkdown, parseRequest } from '../src';
import { emptyLibraryFolders } from '@orquestador/core';

describe('SPEC-038 · Markdown del asistente', () => {
  it('[R38.2] párrafos, encabezados, listas numeradas con continuación y bloques de código', () => {
    const md = '¿Qué servicio quieres conectar?\nDime también:\n\n1. **Alcance**: ¿solo aquí?\n2. **Cómo se arranca**, p. ej. `npx -y paquete`\n   o dirección web.\n\n## Siguiente\n- uno\n- dos\n\n```bash\nnpx -y x\n```';
    const b = parseMarkdown(md);
    expect(b.map((x) => x.t)).toEqual(['p', 'ol', 'h', 'ul', 'code']);
    expect(b[0]).toEqual({ t: 'p', c: [{ t: 'text', v: '¿Qué servicio quieres conectar?' }, { t: 'br' }, { t: 'text', v: 'Dime también:' }] });
    const ol = b[1] as Extract<(typeof b)[number], { t: 'ol' }>;
    expect(ol.start).toBe(1);
    expect(ol.items[0]).toEqual([{ t: 'strong', c: [{ t: 'text', v: 'Alcance' }] }, { t: 'text', v: ': ¿solo aquí?' }]);
    expect(ol.items[1]).toContainEqual({ t: 'code', v: 'npx -y paquete' });
    expect(ol.items[1]).toContainEqual({ t: 'text', v: 'o dirección web.' });
    expect(b[4]).toEqual({ t: 'code', lang: 'bash', v: 'npx -y x' });
  });

  it('[R38.2] cursiva, enlaces y nada de HTML; lo que no se cierra queda como texto', () => {
    expect(parseInline('*hola* y [docs](https://x.dev/a)')).toEqual([
      { t: 'em', c: [{ t: 'text', v: 'hola' }] },
      { t: 'text', v: ' y ' },
      { t: 'link', text: 'docs', url: 'https://x.dev/a' },
    ]);
    expect(parseInline('<b>no</b>')).toEqual([{ t: 'text', v: '<b>no</b>' }]);
    expect(parseInline('**sin cerrar')).toEqual([{ t: 'text', v: '**sin cerrar' }]);
    expect(parseInline('GITHUB_PERSONAL_TOKEN y snake_case')).toEqual([{ t: 'text', v: 'GITHUB_PERSONAL_TOKEN y snake_case' }]);
    expect(parseInline('2 * 3 * 4')).toEqual([{ t: 'text', v: '2 * 3 * 4' }]);
    expect(parseMarkdown('```\nabierto')).toEqual([{ t: 'code', lang: '', v: 'abierto' }]);
  });

  it('[R38.5] ask_user es interactiva y pide pregunta y opciones', () => {
    const ask = ASSISTANT_TOOLS.find((t) => t.name === 'ask_user')!;
    expect(ask.interactive).toBe(true);
    expect(ask.destructive).toBeUndefined();
    expect(Object.keys(ask.params)).toEqual(['question', 'options']);
    expect(ask.params['options']!.type).toBe('string[]');
  });

  it('[R38.13] el contrato valida el documento de carpetas', () => {
    expect(parseRequest(CHANNELS.getLibraryFolders, undefined)).toBeUndefined();
    expect(parseRequest(CHANNELS.saveLibraryFolders, emptyLibraryFolders())).toBeTruthy();
    const bad = emptyLibraryFolders() as unknown as { kinds: { mcp: { items: Record<string, string> } } };
    bad.kinds.mcp.items = { '../x': 'a' };
    expect(() => parseRequest(CHANNELS.saveLibraryFolders, bad)).toThrow(ContractError);
    expect(() => parseRequest(CHANNELS.saveLibraryFolders, { schemaVersion: 1, kinds: { otros: {} } })).toThrow(ContractError);
  });
});
