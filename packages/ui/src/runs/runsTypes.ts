import { type ProjectApi, type RunSnapshot, type RunAction } from '@orquestador/editor';
import type { RunsIndex } from './useRunsIndex';

export type RunsSection = 'live' | 'inbox' | 'history';

/** Dónde está el usuario dentro de Ejecuciones: un apartado o una ejecución abierta desde él [R35.4][R35.8]. */
export interface RunsNav {
  section: RunsSection;
  runId?: string;
  /** Historial filtrado por un diagrama, desde Trabajos [R52.6]. */
  diagramId?: string;
  /** Paso que se abre en el lateral, desde el modal [R44.2]. */
  step?: string;
}

export interface RunsScreenProps {
  api: ProjectApi;
  /** Ejecución que se sigue en vivo (la que se lanzó con «Ejecutar»). */
  main: RunSnapshot;
  index: RunsIndex;
  nav: RunsNav;
  onNav: (nav: RunsNav) => void;
  subOpen: boolean;
  onToggleSub: () => void;
  onControlMain: (action: RunAction) => void;
  onAnswerMain: (questionId: string, text: string) => void;
  agentNames: Readonly<Record<string, string>>;
  onExport: (runId: string, jsonl: string) => void;
  /** Reloj inyectable para los tests. */
  now?: () => number;
}
