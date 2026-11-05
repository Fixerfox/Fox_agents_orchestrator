import { useMemo, useState } from 'react';
import { Bot, GitMerge, Search, Split } from 'lucide-react';
import { MAX_BRANCHES, t, type ParallelSpec } from '@orquestador/editor';
import type { AgentOption } from './Palette';

interface Props {
  agents: AgentOption[];
  /** Nombres de los extremos de la conexión, para el título. */
  between?: { from: string; to: string } | undefined;
  onInsert: (spec: ParallelSpec) => void;
  onClose: () => void;
}

const SZ = { size: 16, strokeWidth: 1.5, 'aria-hidden': true } as const;
const norm = (s: string) => s.toLocaleLowerCase('es').normalize('NFD').replace(/\p{M}/gu, '');

/** «Varios a la vez»: elegir agentes que trabajan en paralelo y cómo juntar sus resultados [R32.36]. */
export function ParallelDialog({ agents, between, onInsert, onClose }: Props) {
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [mode, setMode] = useState<'none' | 'agent'>('none');
  const [joinAgent, setJoinAgent] = useState(agents[0]?.id ?? '');
  const [joinTask, setJoinTask] = useState(t('parallel.join.task'));
  /** Qué hace el agente que une: resumir o implementar en el proyecto [R32.36]. */
  const [purpose, setPurpose] = useState<'summary' | 'implement'>('summary');
  const needle = norm(q.trim());
  const shown = useMemo(() => agents.filter((a) => needle === '' || norm(`${a.name} ${a.description ?? ''}`).includes(needle)), [agents, needle]);
  const nameOf = (id: string) => agents.find((a) => a.id === id)?.name ?? id;
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= MAX_BRANCHES ? p : [...p, id]));
  const ok = picked.length >= 2 && (mode === 'none' || joinAgent !== '');
  const go = () => {
    if (!ok) return;
    onInsert({
      branches: picked.map((agentId) => ({ agentId, label: nameOf(agentId) })),
      ...(mode === 'agent' ? { join: { agentId: joinAgent, label: t('parallel.join.label'), task: joinTask } } : {}),
    });
  };
  return (
    <div
      className="orq-modal orq-modal--center"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="orq-rundlg orq-par"
        role="dialog"
        aria-modal="true"
        aria-label={t('parallel.title')}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <h2>
          <Split {...SZ} />
          {t('parallel.title')}
          {between && <span className="orq-hint"> · {t('parallel.between', between)}</span>}
        </h2>
        <p className="orq-hint">{t('parallel.hint')}</p>
        <label className="orq-pal__search">
          <Search {...SZ} />
          <input type="search" autoFocus value={q} placeholder={t('parallel.search')} aria-label={t('parallel.search')} onChange={(e) => setQ(e.target.value)} />
        </label>
        <fieldset className="orq-par__list">
          <legend>{t('parallel.pick')}</legend>
          {shown.length === 0 && <p className="orq-hint">{t('pal.agents.none')}</p>}
          {shown.map((a) => {
            const on = picked.includes(a.id);
            return (
              <label key={a.id} className={`orq-par__opt${on ? ' is-on' : ''}`}>
                <input type="checkbox" checked={on} disabled={!on && picked.length >= MAX_BRANCHES} onChange={() => toggle(a.id)} />
                <Bot {...SZ} />
                <span>
                  <strong>{a.name}</strong>
                  {a.description && <span className="orq-hint">{a.description}</span>}
                </span>
                {on && <em className="orq-par__n">{picked.indexOf(a.id) + 1}</em>}
              </label>
            );
          })}
        </fieldset>
        {picked.length >= MAX_BRANCHES && <p className="orq-hint">{t('parallel.max', { max: MAX_BRANCHES })}</p>}
        <fieldset className="orq-par__join">
          <legend>{t('parallel.join')}</legend>
          <label className="orq-par__radio">
            <input type="radio" name="par-join" checked={mode === 'none'} onChange={() => setMode('none')} />
            <span>{t('parallel.join.none')}</span>
          </label>
          <label className="orq-par__radio">
            <input type="radio" name="par-join" checked={mode === 'agent'} disabled={agents.length === 0} onChange={() => setMode('agent')} />
            <span>{t('parallel.join.agent')}</span>
          </label>
          {mode === 'agent' && (
            <div className="orq-par__joincfg">
              <div className="orq-seg" role="radiogroup" aria-label={t('parallel.join.purpose')}>
                {(['summary', 'implement'] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={purpose === k}
                    onClick={() => {
                      setPurpose(k);
                      setJoinTask(t(k === 'summary' ? 'parallel.join.task' : 'parallel.join.task.implement'));
                    }}
                  >
                    {t(k === 'summary' ? 'parallel.join.summary' : 'parallel.join.implement')}
                  </button>
                ))}
              </div>
              <label>
                {t('parallel.join.which')}
                <select value={joinAgent} onChange={(e) => setJoinAgent(e.target.value)}>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t('parallel.join.taskLabel')}
                <textarea rows={3} value={joinTask} onChange={(e) => setJoinTask(e.target.value)} />
              </label>
            </div>
          )}
        </fieldset>
        <div className="orq-par__preview" aria-hidden="true">
          {picked.length > 0 ? picked.map((id) => <span key={id} className="orq-tag">{nameOf(id)}</span>) : <span className="orq-hint">—</span>}
          <GitMerge {...SZ} />
          <span className="orq-tag">{mode === 'agent' ? nameOf(joinAgent) : t('parallel.join.asis')}</span>
        </div>
        <div className="orq-form__actions">
          <button type="button" className="orq-btn" onClick={onClose}>
            {t('form.cancel')}
          </button>
          <button type="button" className="orq-btn orq-btn--primary" disabled={!ok} onClick={go}>
            {picked.length >= 2 ? t('parallel.insert', { count: picked.length }) : t('parallel.insert.few')}
          </button>
        </div>
      </div>
    </div>
  );
}
