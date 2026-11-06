import { useEffect, useState } from 'react';
import { readSideWidth } from '../common';

/** Por debajo de este ancho (px) el panel derecho empieza cerrado [R21.16]. */
const NARROW_PX = 1100;

/** Paneles de la aplicación: paleta, submenú de Ejecuciones y lateral derecho [R21.16][R29.5][R33.6]. */
export function useShellLayout(hasSelection: boolean) {
  const [leftOpen, setLeftOpen] = useState(true);
  const [runsSub, setRunsSub] = useState(true);
  const [sideWidth, setSideWidth] = useState(readSideWidth);
  const [rightOpen, setRightOpen] = useState(true);
  /** «Ajustes del diagrama»: el panel derecho sin nada seleccionado [R33.6]. */
  const [diagramPanel, setDiagramPanel] = useState(false);
  /** Asistente abierto: en Diagramas ocupa el lateral derecho; en el resto, un panel acoplado [R29.5][R38.1]. */
  const [assistOpen, setAssistOpen] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const q = window.matchMedia(`(max-width: ${NARROW_PX}px)`);
    const narrow = () => {
      setRightOpen(false);
      setRunsSub(false);
    };
    if (q.matches) narrow();
    const on = (e: MediaQueryListEvent) => {
      if (e.matches) narrow();
    };
    q.addEventListener('change', on);
    return () => q.removeEventListener('change', on);
  }, []);
  // Sin nada seleccionado, el panel derecho no se ve salvo que se pidan los ajustes del diagrama o el asistente [R33.6].
  const sideVisible = rightOpen && (assistOpen || hasSelection || diagramPanel);
  useEffect(() => {
    if (hasSelection) setDiagramPanel(false);
  }, [hasSelection]);
  const toggleRight = () => {
    if (sideVisible) {
      setRightOpen(false);
      setDiagramPanel(false);
    } else {
      setRightOpen(true);
      if (!hasSelection && !assistOpen) setDiagramPanel(true);
    }
  };
  /** «Ajustes del diagrama»: cierra el asistente y enseña el panel; `deselect` quita la selección actual [R33.6]. */
  const toggleDiagramPanel = (deselect: () => void) => {
    if (diagramPanel && sideVisible) return setDiagramPanel(false);
    deselect();
    setAssistOpen(false);
    setRightOpen(true);
    setDiagramPanel(true);
  };
  return { leftOpen, setLeftOpen, runsSub, setRunsSub, sideWidth, setSideWidth, rightOpen, setRightOpen, diagramPanel, setDiagramPanel, assistOpen, setAssistOpen, sideVisible, toggleRight, toggleDiagramPanel };
}
