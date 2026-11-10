import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProjectApi, ProjectTrustInfo } from '@orquestador/editor';

/**
 * Confianza en la configuración de Claude Code del proyecto abierto [R88.7]: al abrirlo, si trae algo que revisar y no
 * hay decisión, se pide. Cerrar sin elegir no guarda nada: se vuelve a preguntar la próxima vez que se abra.
 */
export function useProjectTrust(api: ProjectApi, project: string | undefined, loadsConfig: boolean) {
  const [info, setInfo] = useState<ProjectTrustInfo>();
  const [open, setOpen] = useState(false);
  const asked = useRef<string | undefined>(undefined);

  const refresh = useCallback(async () => {
    const r = await api.projectTrust();
    if (r.ok) setInfo(r.value);
    return r.ok ? r.value : undefined;
  }, [api]);

  useEffect(() => {
    setInfo(undefined);
    setOpen(false);
    if (project === undefined) {
      asked.current = undefined;
      return;
    }
    if (!loadsConfig || asked.current === project) return;
    let live = true;
    void refresh().then((v) => {
      if (!live || !v) return;
      asked.current = project;
      if (v.items.length > 0 && v.decision === null) setOpen(true);
    });
    return () => {
      live = false;
    };
  }, [project, loadsConfig, refresh]);

  const decide = async (decision: 'trusted' | 'ignored') => {
    await api.setProjectTrust(decision);
    setOpen(false);
    await refresh();
  };
  return { info, open, setOpen, decide, refresh };
}
