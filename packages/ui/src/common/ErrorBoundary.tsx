import { Component, type ErrorInfo, type ReactNode } from 'react';
import { t } from '@orquestador/editor';

type State = { error: Error | undefined; where?: string | undefined; copied?: boolean };

/** El texto de los detalles: mensaje, traza y componentes en los que estaba [R19.12]. */
export const crashDetails = (error: Error, where?: string): string => [error.stack ?? `${error.name}: ${error.message}`, where ? `\nComponentes:${where}` : ''].join('').trim();

/** Un error al pintar deja un mensaje en su sitio, no la ventana vacía [R19.10], con lo necesario para arreglarlo [R19.12]. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: undefined };

  static getDerivedStateFromError(error: Error) {
    return { error, copied: false };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    const where = info.componentStack ?? undefined;
    this.setState({ where });
    // Una sola línea en la consola: el proceso principal la apunta en crash.log [R19.12].
    console.error(`[orquestador:interfaz] ${crashDetails(error, where)}`);
  }

  override render(): ReactNode {
    const { error, where, copied } = this.state;
    if (!error) return this.props.children;
    const details = crashDetails(error, where);
    return (
      <div className="orq-crash" role="alert">
        <h2>{t('crash.title')}</h2>
        <p className="orq-hint">{t('crash.text')}</p>
        <pre>{error.message}</pre>
        <details className="orq-crash__details">
          <summary>{t('crash.details')}</summary>
          <pre>{details}</pre>
        </details>
        <div className="orq-crash__actions">
          <button type="button" className="orq-btn" onClick={() => this.setState({ error: undefined, where: undefined })}>
            {t('crash.retry')}
          </button>
          <button
            type="button"
            className="orq-btn orq-btn--ghost"
            onClick={() => {
              void navigator.clipboard
                ?.writeText(details)
                .then(() => this.setState({ copied: true }))
                .catch(() => undefined);
            }}
          >
            {copied ? t('crash.copied') : t('crash.copy')}
          </button>
        </div>
      </div>
    );
  }
}
