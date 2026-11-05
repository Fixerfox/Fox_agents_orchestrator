import { useEffect, useRef } from 'react';
import { ChevronDown, Plus, Sparkles, SquareTerminal, X } from 'lucide-react';
import { t, type ProjectApi, type TerminalEvent, type TerminalProgram } from '@orquestador/editor';
import { createTerminalScreen } from './terminalScreen';

/** Una terminal abierta [R30.13]. */
export interface TermTab {
  id: string;
  program: TerminalProgram;
  title: string;
  /** Código de salida cuando el proceso ya terminó. */
  exited?: number;
}

/**
 * Reparte la salida de las terminales: guarda lo que llega antes de que la pantalla esté montada y avisa al
 * terminar un proceso [R30.13].
 */
export class TerminalHub {
  private readonly buffers = new Map<string, string[]>();
  private readonly listeners = new Map<string, (data: string) => void>();
  private readonly off: () => void;

  constructor(api: ProjectApi, onExit: (id: string, code: number) => void) {
    this.off = api.onTerminalEvents((id, e: TerminalEvent) => {
      if (e.type === 'exit') {
        this.deliver(id, `\r\n${t('term.exited', { code: e.code })}\r\n`);
        onExit(id, e.code);
      } else this.deliver(id, e.data);
    });
  }

  private deliver(id: string, data: string): void {
    const l = this.listeners.get(id);
    if (l) l(data);
    else (this.buffers.get(id) ?? this.buffers.set(id, []).get(id)!).push(data);
  }

  subscribe(id: string, cb: (data: string) => void): () => void {
    for (const d of this.buffers.get(id) ?? []) cb(d);
    this.buffers.delete(id);
    this.listeners.set(id, cb);
    return () => void this.listeners.delete(id);
  }

  forget(id: string): void {
    this.buffers.delete(id);
    this.listeners.delete(id);
  }

  dispose(): void {
    this.off();
  }
}

function TermView({ api, hub, tab, active }: { api: ProjectApi; hub: TerminalHub; tab: TermTab; active: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const screenRef = useRef<ReturnType<typeof createTerminalScreen>>(undefined);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const screen = createTerminalScreen(el);
    screenRef.current = screen;
    screen.onInput((data) => void api.terminalWrite({ id: tab.id, data }));
    const unsub = hub.subscribe(tab.id, (d) => screen.write(d));
    let last = '';
    const resize = () => {
      const { cols, rows } = screen.fit();
      const key = `${cols}x${rows}`;
      if (key !== last) {
        last = key;
        void api.terminalResize({ id: tab.id, cols, rows });
      }
    };
    resize();
    const ro = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => resize());
    ro?.observe(el);
    return () => {
      ro?.disconnect();
      unsub();
      screen.dispose();
      screenRef.current = undefined;
    };
  }, [api, hub, tab.id]);
  useEffect(() => {
    if (active) setTimeout(() => (screenRef.current?.fit(), screenRef.current?.focus()), 0);
  }, [active]);
  return <div ref={box} className="orq-term__screen" role="region" aria-label={t('term.screen', { name: tab.title })} hidden={!active} />;
}

interface Props {
  api: ProjectApi;
  hub: TerminalHub;
  tabs: TermTab[];
  active: string | undefined;
  open: boolean;
  onActive(id: string): void;
  onClose(id: string): void;
  onNew(program: TerminalProgram): void;
  onToggle(): void;
}

/** Panel de terminales integradas, abajo, sobre cualquier sección [R30.13]. */
export function TerminalPanel({ api, hub, tabs, active, open, onActive, onClose, onNew, onToggle }: Props) {
  if (tabs.length === 0) return null;
  // Oculto se queda montado: las pantallas conservan lo que ya mostraron [R30.13]
  return (
    <>
      {!open && (
        <button type="button" className="orq-term-pill" onClick={onToggle}>
          <SquareTerminal size={14} aria-hidden="true" />
          {t('term.show')} ({tabs.length})
        </button>
      )}
    <section className="orq-term" aria-label={t('term.title')} hidden={!open}>
      <header className="orq-term__head">
        <SquareTerminal size={14} aria-hidden="true" />
        <div className="orq-term__tabs" role="tablist" aria-label={t('term.tabs')}>
          {tabs.map((tab) => (
            <div key={tab.id} className={`orq-term__tab${tab.id === active ? ' is-active' : ''}${tab.exited !== undefined ? ' is-exited' : ''}`}>
              <button type="button" role="tab" aria-selected={tab.id === active} onClick={() => onActive(tab.id)}>
                {tab.program === 'claude' ? <Sparkles size={12} aria-hidden="true" /> : null}
                {tab.title}
              </button>
              <button type="button" className="orq-term__x" aria-label={t('term.close', { name: tab.title })} title={t('term.close', { name: tab.title })} onClick={() => onClose(tab.id)}>
                <X size={12} aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
        <button type="button" className="orq-btn orq-btn--small orq-btn--ghost" onClick={() => onNew('claude')} title={t('term.new.claude')} aria-label={t('term.new.claude')}>
          <Plus size={12} aria-hidden="true" />
          {t('term.claude')}
        </button>
        <button type="button" className="orq-btn orq-btn--small orq-btn--ghost" onClick={() => onNew('shell')} title={t('term.new.shell')} aria-label={t('term.new.shell')}>
          <Plus size={12} aria-hidden="true" />
          {t('term.shell')}
        </button>
        <button type="button" className="orq-ib" aria-label={t('term.hide')} title={t('term.hide')} onClick={onToggle}>
          <ChevronDown size={16} aria-hidden="true" />
        </button>
      </header>
      <div className="orq-term__body">
        {tabs.map((tab) => (
          <TermView key={tab.id} api={api} hub={hub} tab={tab} active={tab.id === active} />
        ))}
      </div>
    </section>
    </>
  );
}
