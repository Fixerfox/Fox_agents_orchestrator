export type Theme = 'auto' | 'light' | 'dark';

export const THEMES: readonly Theme[] = ['auto', 'light', 'dark'];
export const THEME_KEY = 'orq-theme';

/** Siguiente tema al pulsar el selector: automático, claro, oscuro [R21.1]. */
export function nextTheme(theme: Theme): Theme {
  return THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length] ?? 'auto';
}

/** Lee el tema guardado; si el almacenamiento falla o el valor no vale, automático. */
export function loadTheme(storage: Pick<Storage, 'getItem'> | undefined = safeStorage()): Theme {
  try {
    const v = storage?.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

export function saveTheme(theme: Theme, storage: Pick<Storage, 'setItem'> | undefined = safeStorage()): void {
  try {
    storage?.setItem(THEME_KEY, theme);
  } catch {
    /* sin almacenamiento: el tema solo dura esta sesión */
  }
}

/** Aplica el tema: `data-theme` en la raíz; en automático se quita y manda el sistema. */
export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  if (theme === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}

function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}
