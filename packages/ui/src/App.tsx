import { AppAlert, ErrorBoundary, AppDialogs, AppNav, AppRunModal, AppSections, AppToolbar, AssistantDock, StartView, TerminalDock, useApp, type AppProps } from './shell';

export type { AppProps };

/** Aplicación: rail global con secciones a pantalla completa (prototipos de la revisión UX) [R32.13]. */
export function App(props: AppProps) {
  return (
    <ErrorBoundary>
      <Shell {...props} />
    </ErrorBoundary>
  );
}

function Shell(props: AppProps) {
  const app = useApp(props);
  if (app.project === undefined) return <StartView app={app} />;
  return (
    <div className="orq-app orq-shell">
      <AppNav app={app} />
      <div className="orq-shell__main">
        <AppToolbar app={app} />
        <ErrorBoundary>
          <AppRunModal app={app} />
        </ErrorBoundary>
        <AppAlert app={app} />
        <div className="orq-shell__work">
          <ErrorBoundary>
            <AppSections app={app} />
          </ErrorBoundary>
          <AssistantDock app={app} />
        </div>
        <TerminalDock app={app} />
      </div>
      <AppDialogs app={app} />
    </div>
  );
}
