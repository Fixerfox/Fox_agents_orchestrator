import { useEffect, useState } from 'react';
import { MessageCircleQuestion, Pause, Radio } from 'lucide-react';
import type { Diagram, RunEvent } from '@orquestador/core';
import { isOpenStatus, t, type LiveView, type MessageKey } from '@orquestador/editor';
import { nodeLabel } from './RunsScreen';

/** Pasos activos y cuenta de hechos a partir del estado en vivo [R38.12]. */
export function liveSteps(live: LiveView, diagram: Diagram | undefined) {
  const active: { key: string; label: string; status: string }[] = [];
  for (const [key, status] of Object.entries(live.nodeStatus)) {
    if (!isOpenStatus(status)) continue;
    const parts = key.split('/');
    const id = parts.pop()!;
    if (id === 'entry' || id === 'output') continue;
    active.push({ key, label: nodeLabel(diagram, id, parts), status });
  }
  const runnable = (diagram?.nodes ?? []).filter((n) => n.kind !== 'entry' && n.kind !== 'output');
  const done = runnable.filter((n) => live.nodeStatus[n.id] === 'succeeded' || live.nodeStatus[n.id] === 'skipped').length;
  return { active, done, total: runnable.length };
}

const money = (n: number) => `${n.toLocaleString('es-ES', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} $`;
const clock = (s: number) => (s < 60 ? `${Math.floor(s)} s` : `${Math.floor(s / 60)} min ${Math.floor(s % 60)} s`);

/**
 * Tarjeta «En marcha» del lateral derecho de Diagramas cuando corre una ejecución y no hay nada seleccionado:
 * estado, pasos activos, avance, tiempo, tokens y «Ver en directo» [R38.12].
 */
export function LiveSummary({ live, events, diagram, onOpen }: { live: LiveView; events: readonly RunEvent[]; diagram: Diagram | undefined; onOpen: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const { active, done, total } = liveSteps(live, diagram);
  const waiting = live.pending.length > 0;
  const start = events[0]?.ts ? Date.parse(events[0].ts) : now;
  const tokens = live.usage.inputTokens + live.usage.outputTokens;
  const state = waiting ? t('live.side.waiting') : live.paused ? t('run.status.paused') : t('run.status.running');
  return (
    <section className={`orq-livecard${waiting ? ' is-waiting' : live.paused ? ' is-paused' : ''}`} aria-label={t('live.side.title')}>
      <header>
        <span className="orq-livecard__pulse" aria-hidden="true">
          {waiting ? <MessageCircleQuestion size={14} /> : live.paused ? <Pause size={14} /> : <Radio size={14} />}
        </span>
        <div>
          <h2>{t('live.side.title')}</h2>
          <p role="status">{state}</p>
        </div>
      </header>
      <div className="orq-livecard__block">
        <span className="orq-livecard__label">{t('live.side.active')}</span>
        {active.length === 0 ? (
          <p className="orq-hint">{t('live.side.none')}</p>
        ) : (
          <ul className="orq-livecard__steps">
            {active.map((a) => (
              <li key={a.key} className={`is-${a.status}`}>
                <span className="orq-livecard__dot" aria-hidden="true" />
                <strong>{a.label}</strong>
                <span>{t(`live.step.${a.status}` as MessageKey)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {total > 0 && (
        <div className="orq-livecard__block">
          <div className="orq-livecard__bar" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label={t('live.side.done', { done, total })}>
            <i style={{ width: `${Math.round((done / total) * 100)}%` }} />
          </div>
          <span className="orq-hint">{t('live.side.done', { done, total })}</span>
        </div>
      )}
      <p className="orq-livecard__figures orq-mono">
        {clock(Math.max(0, (now - start) / 1000))} · {tokens.toLocaleString('es-ES')} tokens · {money(live.usage.costUsd)}
      </p>
      <button type="button" className="orq-btn orq-btn--small orq-btn--primary" onClick={onOpen}>
        {t('live.side.open')}
      </button>
      <p className="orq-hint">{t('live.side.locked')}</p>
    </section>
  );
}
