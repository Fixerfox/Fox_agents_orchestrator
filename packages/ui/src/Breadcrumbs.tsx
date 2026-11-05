import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Pencil } from 'lucide-react';
import { MAX_DIAGRAM_NAME, t, type Crumb } from '@orquestador/editor';

interface Props {
  crumbs: Crumb[];
  onGo: (path: string[]) => void;
  onUp: () => void;
  /** Renombra el diagrama desde su título (en la raíz) [R32.38]. */
  onRename?: ((name: string) => void) | undefined;
  /** Cada cambio pide editar el nombre (p. ej. tras «Nuevo» o «Renombrar»). */
  renameRequest?: number;
}

export function Breadcrumbs({ crumbs, onGo, onUp, onRename, renameRequest = 0 }: Props) {
  const [editing, setEditing] = useState(false);
  const handled = useRef(renameRequest);
  const canRename = onRename !== undefined;
  useEffect(() => {
    if (renameRequest === handled.current) return;
    handled.current = renameRequest;
    if (canRename) setEditing(true);
  }, [renameRequest, canRename]);
  const root = crumbs[0]?.label ?? '';
  return (
    <nav className="orq-crumbs" aria-label={t('crumbs.label')}>
      <button type="button" onClick={onUp} disabled={crumbs.length <= 1} aria-label={t('crumbs.up')} title={t('crumbs.up')}>
        <ArrowUp size={16} strokeWidth={1.5} aria-hidden="true" />
      </button>
      <ol>
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          if (i === 0 && editing && onRename) {
            return (
              <li key={i}>
                <NameField
                  value={root}
                  onDone={(name) => {
                    setEditing(false);
                    if (name !== undefined) onRename(name);
                  }}
                />
              </li>
            );
          }
          return (
            <li key={i}>
              {last && i === 0 && onRename ? (
                <button
                  type="button"
                  className="orq-crumbs__name"
                  aria-current="page"
                  aria-label={t('diagram.rename.field')}
                  title={t('diagram.rename')}
                  onClick={() => setEditing(true)}
                  onKeyDown={(e) => {
                    if (e.key === 'F2') setEditing(true);
                  }}
                >
                  <span>{c.label}</span>
                  <Pencil size={13} strokeWidth={1.5} aria-hidden="true" />
                </button>
              ) : last ? (
                <span aria-current="page">{c.label}</span>
              ) : (
                <button type="button" onClick={() => onGo(c.path)}>
                  {c.label}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** Campo del nombre: Intro o salir guardan; Esc cancela. */
function NameField({ value, onDone }: { value: string; onDone: (name: string | undefined) => void }) {
  const [text, setText] = useState(value);
  const done = useRef(false);
  const finish = (name: string | undefined) => {
    if (done.current) return;
    done.current = true;
    onDone(name);
  };
  return (
    <input
      className="orq-crumbs__input"
      aria-label={t('diagram.rename.field')}
      value={text}
      maxLength={MAX_DIAGRAM_NAME}
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => finish(text)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish(text);
        else if (e.key === 'Escape') finish(undefined);
      }}
    />
  );
}
