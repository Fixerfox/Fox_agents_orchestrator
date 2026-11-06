import { ResizeHandle } from './ResizeHandle';

const SIDE_KEY = 'orq.sideWidth';
const SIDE_DEFAULT = 340;
const SIDE_MIN = 288;

export const readSideWidth = () => {
  try {
    const n = Number(window.localStorage.getItem(SIDE_KEY));
    return Number.isFinite(n) && n >= SIDE_MIN ? n : SIDE_DEFAULT;
  } catch {
    return SIDE_DEFAULT;
  }
};

const saveSideWidth = (w: number) => {
  try {
    window.localStorage.setItem(SIDE_KEY, String(w));
  } catch {
    /* sin almacenamiento: el ancho vale solo para esta sesión */
  }
};

/** Borde del panel derecho, el mismo en el Diseñador y en el panel acoplado [R21.22]. */
export function SideResizeHandle({ width, onChange }: { width: number; onChange: (width: number) => void }) {
  return <ResizeHandle width={width} min={SIDE_MIN} max={Math.max(SIDE_MIN, Math.min(760, window.innerWidth - 520))} reset={SIDE_DEFAULT} onChange={onChange} onCommit={saveSideWidth} />;
}
