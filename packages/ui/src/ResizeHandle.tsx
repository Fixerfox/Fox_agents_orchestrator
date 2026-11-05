import { useRef } from 'react';
import { t } from '@orquestador/editor';

interface Props {
  width: number;
  min: number;
  max: number;
  /** Ancho al que vuelve con doble clic. */
  reset: number;
  onChange: (width: number) => void;
  /** Se llama al terminar de arrastrar o de usar el teclado, para recordar el ancho. */
  onCommit?: (width: number) => void;
}

const STEP = 24;

/** Borde de un panel derecho que se arrastra (o se mueve con las flechas) para ensancharlo o estrecharlo [R21.22]. */
export function ResizeHandle({ width, min, max, reset, onChange, onCommit }: Props) {
  const start = useRef<{ x: number; w: number } | null>(null);
  const clamp = (w: number) => Math.round(Math.min(max, Math.max(min, w)));
  const set = (w: number, commit = false) => {
    const next = clamp(w);
    onChange(next);
    if (commit) onCommit?.(next);
  };
  return (
    <div
      className="orq-resize"
      role="separator"
      aria-orientation="vertical"
      aria-label={t('resize.label')}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title={t('resize.hint')}
      onPointerDown={(e) => {
        e.preventDefault();
        start.current = { x: e.clientX, w: width };
        e.currentTarget.setPointerCapture?.(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (start.current) set(start.current.w + (start.current.x - e.clientX));
      }}
      onPointerUp={(e) => {
        if (!start.current) return;
        const w = clamp(start.current.w + (start.current.x - e.clientX));
        start.current = null;
        set(w, true);
      }}
      onDoubleClick={() => set(reset, true)}
      onKeyDown={(e) => {
        const to = e.key === 'ArrowLeft' ? width + STEP : e.key === 'ArrowRight' ? width - STEP : e.key === 'Home' ? min : e.key === 'End' ? max : undefined;
        if (to === undefined) return;
        e.preventDefault();
        set(to, true);
      }}
    />
  );
}
