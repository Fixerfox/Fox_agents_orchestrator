import { useEffect, useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { t, type MessageKey } from '@orquestador/editor';
import { applyTheme, loadTheme, nextTheme, saveTheme, type Theme } from './theme';

const ICON = { auto: Monitor, light: Sun, dark: Moon } as const;

/** Selector de tema de la barra superior; recuerda la elección [R21.1]. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => loadTheme());
  useEffect(() => applyTheme(theme), [theme]);
  const Icon = ICON[theme];
  const label = t('theme.switch', { name: t(`theme.${theme}` as MessageKey) });
  return (
    <button
      type="button"
      className="orq-btn orq-btn--icon"
      aria-label={label}
      title={label}
      onClick={() => {
        const next = nextTheme(theme);
        setTheme(next);
        saveTheme(next);
      }}
    >
      <Icon size={16} strokeWidth={1.5} aria-hidden="true" />
    </button>
  );
}
