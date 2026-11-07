import { Component, type ErrorInfo, type ReactNode } from 'react';
import { t } from '@orquestador/editor';

/** Un error al pintar deja un mensaje en su sitio, no la ventana vacía [R19.10]. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | undefined }> {
  override state: { error: Error | undefined } = { error: undefined };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="orq-crash" role="alert">
        <h2>{t('crash.title')}</h2>
        <p className="orq-hint">{t('crash.text')}</p>
        <pre>{error.message}</pre>
        <button type="button" className="orq-btn" onClick={() => this.setState({ error: undefined })}>
          {t('crash.retry')}
        </button>
      </div>
    );
  }
}
