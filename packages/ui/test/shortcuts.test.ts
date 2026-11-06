import { describe, expect, it } from 'vitest';
import { shortcutFor } from '../src/diagrams/shortcuts';

const k = (key: string, o: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }> = {}) =>
  shortcutFor({ key, ctrlKey: false, shiftKey: false, ...o });

describe('atajos de teclado [R14.11]', () => {
  it('[R14.11] Supr borra', () => expect(k('Delete')).toBe('delete'));
  it('[R21.13] Retroceso también borra', () => expect(k('Backspace')).toBe('delete'));
  it('[R14.11] Ctrl+Z deshace y Ctrl+Mayús+Z rehace', () => {
    expect(k('z', { ctrlKey: true })).toBe('undo');
    expect(k('Z', { ctrlKey: true, shiftKey: true })).toBe('redo');
  });
  it('[R14.11] Ctrl+Y rehace y Ctrl+S guarda (también con Cmd)', () => {
    expect(k('y', { ctrlKey: true })).toBe('redo');
    expect(k('s', { ctrlKey: true })).toBe('save');
    expect(k('s', { metaKey: true })).toBe('save');
  });
  it('[R14.11] otras teclas no hacen nada', () => {
    expect(k('a')).toBeUndefined();
    expect(k('z')).toBeUndefined();
    expect(k('q', { ctrlKey: true })).toBeUndefined();
  });
});
