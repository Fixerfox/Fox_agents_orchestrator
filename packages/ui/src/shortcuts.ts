export type ShortcutAction = 'delete' | 'undo' | 'redo' | 'save';

export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey?: boolean;
  shiftKey: boolean;
}

/** Atajos de teclado del editor [R14.11]: Supr/Retroceso, Ctrl+Z, Ctrl+Y / Ctrl+Mayús+Z, Ctrl+S. */
export function shortcutFor(e: KeyLike): ShortcutAction | undefined {
  const mod = e.ctrlKey || e.metaKey === true;
  const key = e.key.toLowerCase();
  if (!mod) return e.key === 'Delete' || e.key === 'Backspace' ? 'delete' : undefined;
  if (key === 'z') return e.shiftKey ? 'redo' : 'undo';
  if (key === 'y') return 'redo';
  if (key === 's') return 'save';
  return undefined;
}

/** Los atajos no deben robar teclas a los campos de texto. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}
