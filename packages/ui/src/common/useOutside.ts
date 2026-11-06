import { useRef, useEffect } from 'react';

export function useOutside<T extends HTMLElement>(open: boolean, close: () => void) {
  const box = useRef<T>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) close();
    };
    window.addEventListener('pointerdown', away);
    return () => window.removeEventListener('pointerdown', away);
  }, [open, close]);
  return box;
}
