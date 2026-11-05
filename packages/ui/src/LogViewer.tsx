import { useMemo, useState } from 'react';
import type { RunEvent } from '@orquestador/core';
import { agentsIn, eventTypesIn, eventsToJsonl, filterEvents, summarizeEvent, t } from '@orquestador/editor';

interface Props {
  events: readonly RunEvent[];
  /** Recibe el contenido JSONL para guardarlo (la app lo descarga como archivo). */
  onExport: (jsonl: string) => void;
}

/** Visor del registro: filtros por agente, tipo y texto, y exportación (R8.11). */
export function LogViewer({ events, onExport }: Props) {
  const [agentId, setAgentId] = useState('');
  const [type, setType] = useState('');
  const [text, setText] = useState('');
  const shown = useMemo(
    () => filterEvents(events, { ...(agentId ? { agentId } : {}), ...(type ? { types: [type] } : {}), text }),
    [events, agentId, type, text],
  );
  return (
    <section className="orq-log" aria-label={t('log.title')}>
      <h3>{t('log.title')}</h3>
      <label>
        {t('log.agent')}
        <select value={agentId} onChange={(e) => setAgentId(e.target.value)}>
          <option value="">{t('log.all')}</option>
          {agentsIn(events).map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t('log.type')}
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">{t('log.all')}</option>
          {eventTypesIn(events).map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t('log.text')}
        <input value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <p className="orq-hint">{t('log.count', { shown: shown.length, total: events.length })}</p>
      <button type="button" disabled={events.length === 0} onClick={() => onExport(eventsToJsonl(events))}>
        {t('log.export')}
      </button>
      {shown.length === 0 ? (
        <p className="orq-hint">{t('log.empty')}</p>
      ) : (
        <ol className="orq-loglist">
          {shown.map((e) => (
            <li key={e.seq}>
              <code>
                #{e.seq} {e.type}
                {'nodeId' in e ? ` · ${[...(e.nodePath ?? []), e.nodeId].join('/')}` : ''}
              </code>
              <span> {summarizeEvent(e)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
