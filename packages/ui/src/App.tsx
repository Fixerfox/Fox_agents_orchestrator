import { AppAlert, AppDialogs, AppNav, AppRunModal, AppSections, AppToolbar, AssistantDock, StartView, TerminalDock, useApp, type AppProps } from './shell';

export type { AppProps };

/** Aplicación: rail global con secciones a pantalla completa (prototipos de la revisión UX) [R32.13]. */
export function App(props: AppProps) {
  const app = useApp(props);
  if (app.project === undefined) return <StartView app={app} />;
  return (
    <div className="orq-app orq-shell">
      <AppNav app={app} />
      <div className="orq-shell__main">
        <AppToolbar app={app} />
        <AppRunModal app={app} />
        <AppAlert app={app} />
        <div className="orq-shell__work">
          <AppSections app={app} />
          <AssistantDock app={app} />
        </div>
        <TerminalDock app={app} />
      </div>
      <AppDialogs app={app} />
    </div>
  );
}
