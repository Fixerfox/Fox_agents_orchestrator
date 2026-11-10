import { t, type AppInfo } from '@orquestador/editor';

/** «Orquestador 0.9.0» y la licencia, al pie de Apariencia [R91.11]. */
export function AboutLine({ app }: { app: AppInfo | undefined }) {
  if (!app) return null;
  return (
    <p className="orq-hint orq-about" data-testid="settings-about">
      {t('settings.about', { version: app.version })} · {t('settings.about.license')}
    </p>
  );
}
