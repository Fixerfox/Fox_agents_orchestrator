import { useEffect, useRef, useState } from 'react';
import type { ProjectApi } from '@orquestador/editor';
import { emptyTabs, fromSaved, openTab, toSaved, type AssistantTabs } from './tabs';

/** Espera tras el último cambio antes de guardar [R86.14]. */
export const TABS_SAVE_MS = 500;

/**
 * Pestañas del asistente del proyecto abierto: se cargan al abrirlo (vaciando las del anterior) y se guardan medio
 * segundo después de cada cambio [R86.14].
 */
export function useAssistantTabs(api: ProjectApi, project: string | undefined) {
  const [tabs, setTabs] = useState<AssistantTabs>(() => emptyTabs());
  /** Solo se guarda lo cargado del proyecto abierto, nunca lo del anterior. */
  const loaded = useRef<string | undefined>(undefined);

  useEffect(() => {
    loaded.current = undefined;
    setTabs(emptyTabs());
    if (project === undefined) return;
    let live = true;
    void api.assistantTabsLoad().then((r) => {
      if (!live) return;
      // Lo que se haya abierto mientras cargaba se conserva delante de lo guardado.
      setTabs((now) => {
        const saved = fromSaved(r.ok ? r.value : null);
        const fresh = now.tabs.filter((x) => x.items.length > 0 || x.pending !== undefined || x.turnId !== undefined);
        return fresh.length === 0 ? saved : { tabs: [...saved.tabs, ...fresh], activeId: now.activeId };
      });
      loaded.current = project;
    });
    return () => {
      live = false;
    };
  }, [api, project]);

  useEffect(() => {
    if (project === undefined || loaded.current !== project) return;
    const timer = setTimeout(() => void api.assistantTabsSave(toSaved(tabs)), TABS_SAVE_MS);
    return () => clearTimeout(timer);
  }, [api, project, tabs]);

  /** Petición desde un botón de la app: pestaña nueva con la petición pendiente y el título del botón [R86.9][R86.15]. */
  const ask = (text: string, title?: string) => setTabs((s) => openTab(s, { pending: text, ...(title ? { title } : {}) }));
  return { tabs, setTabs, ask };
}
