import { Fragment, useEffect, useRef, type ReactNode } from 'react';
import { t } from '@orquestador/editor';

export interface MenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  /** Grupo: al cambiar se pinta un separador y, si no está vacío, su título [R32.34]. */
  group?: string;
  onSelect: () => void;
}

interface Props {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}

/** Menú contextual accesible: flechas, Intro, Esc y clic fuera [R21.12]. */
export function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const buttons = () => Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);

  useEffect(() => {
    buttons()[0]?.focus();
    const away = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [onClose]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const list = buttons();
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const d = e.key === 'ArrowDown' ? 1 : -1;
      list[(i + d + list.length) % list.length]?.focus();
    } else if (e.key === 'Home') list[0]?.focus();
    else if (e.key === 'End') list[list.length - 1]?.focus();
    else if (e.key === 'Tab') {
      e.preventDefault();
      onClose();
    }
  };

  // Evita salirse de la ventana.
  const left = Math.max(4, Math.min(x, window.innerWidth - 220));
  const groups = new Set(items.map((it) => it.group ?? '')).size;
  const top = Math.max(4, Math.min(y, window.innerHeight - 8 - items.length * 36 - groups * 30));

  return (
    <div
      ref={ref}
      className="orq-menu"
      role="menu"
      aria-label={t('menu.label')}
      style={{ left, top }}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((it, i) => (
        <Fragment key={it.id}>
          {i > 0 && (it.group ?? '') !== (items[i - 1]!.group ?? '') && <div className="orq-menu__sep" role="separator" />}
          {it.group?.trim() && (i === 0 || it.group !== items[i - 1]!.group) && (
            <div className="orq-menu__group" aria-hidden="true">
              {it.group}
            </div>
          )}
        <button
          type="button"
          role="menuitem"
          className={`orq-menu__item${it.danger ? ' is-danger' : ''}`}
          disabled={it.disabled}
          onClick={() => {
            onClose();
            it.onSelect();
          }}
        >
          <span className="orq-menu__icon" aria-hidden="true">
            {it.icon}
          </span>
          {it.label}
        </button>
        </Fragment>
      ))}
    </div>
  );
}
