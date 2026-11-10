import { useEffect, useState } from 'react';
import type { AppSettings, ProjectPermission } from '@orquestador/core';
import { t, type ProjectApi, type SettingsView } from '@orquestador/editor';

/** Solo los campos de ajustes: `apiKeyStored` es del estado de la vista y el contrato lo rechaza. */
const toSettings = (v: SettingsView): AppSettings => ({
  schemaVersion: v.schemaVersion,
  authMode: v.authMode,
  engine: v.engine,
  defaultModel: v.defaultModel,
  maxParallel: v.maxParallel,
  ...(v.defaultMaxTokens !== undefined ? { defaultMaxTokens: v.defaultMaxTokens } : {}),
  ...(v.permissions ? { permissions: v.permissions } : {}),
  ...(v.supervisorReview !== undefined ? { supervisorReview: v.supervisorReview } : {}),
  ...(v.supervisorModel !== undefined ? { supervisorModel: v.supervisorModel } : {}),
});

/** Ajustes de la aplicación y carpeta de trabajo del proyecto; `section` hace que la carpeta se relea al navegar. */
export function useAppSettings(api: ProjectApi, project: string | undefined, section: string, fail: (message: string) => void) {
  const [settings, setSettings] = useState<SettingsView>();
  const engine = settings?.engine ?? 'simulated';
  useEffect(() => {
    void api.getSettings().then((r) => r.ok && setSettings(r.value));
  }, [api]);
  // Ajustes dañados: se avisa, ya con el proyecto abierto, de que se vuelve a «Preguntar» [R89.6].
  const recovered = settings?.recovered === true;
  useEffect(() => {
    if (recovered && project !== undefined) fail(t('settings.recovered'));
  }, [recovered, project]);
  const [workFolder, setWorkFolder] = useState<string>();
  useEffect(() => {
    if (project === undefined) return setWorkFolder(undefined);
    void api.getWorkFolder().then((r) => setWorkFolder(r.ok && r.value ? r.value.name : undefined));
  }, [api, project, section]);
  /** Permisos de los agentes desde el bloque «Archivos» del paso: guarda el ajuste al momento [R32.29][R47.11]. */
  const setPermissions = async (level: ProjectPermission) => {
    if (!settings) return;
    const next = { ...settings, permissions: level };
    const res = await api.saveSettings(toSettings(next));
    if (res.ok) setSettings(next);
    else fail(res.error.message);
  };
  const setEngine = async (next: 'simulated' | 'claude') => {
    if (!settings) return;
    const res = await api.saveSettings({ ...toSettings(settings), engine: next });
    if (res.ok) setSettings(res.value);
    else fail(res.error.message);
  };
  return { settings, setSettings, engine, workFolder, setPermissions, setEngine };
}
