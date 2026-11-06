import { useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Braces, GitFork, Plus, Repeat2, Search, ShieldCheck } from 'lucide-react';
import { t } from '@orquestador/editor';
import type { AgentOption } from './Palette';

export type InsertChoice = { kind: 'agent'; agentId: string } | { kind: 'router' } | { kind: 'loop' } | { kind: 'review' } | { kind: 'transform' };

interface Props {
  agents: AgentOption[];
  /** Punto de pantalla bajo el botón «+». */
  at: { x: number; y: number };
  onPick: (choice: InsertChoice) => void;
  onCreate?: () => void;
  onClose: () => void;
}

const SZ = { size: 16, strokeWidth: 1.5, 'aria-hidden': true } as const;
const norm = (s: string) => s.toLocaleLowerCase('es').normalize('NFD').replace(/\p{M}/gu, '');

/** Buscador de pasos al pulsar «+» en una conexión: agentes del proyecto, router y bucle [R32.8]. */
export function InsertPicker({ agents, at, onPick, onCreate, onClose }: Props) {
  const [q, setQ] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const query = norm(q.trim());
  const shownAgents = useMemo(() => agents.filter((a) => query === '' || norm(`${a.name} ${a.description ?? ''}`).includes(query)), [agents, query]);
  const steps = useMemo(
    () =>
      ([
        { kind: 'router', label: t('insert.router'), Icon: GitFork },
        { kind: 'loop', label: t('insert.loop'), Icon: Repeat2 },
        { kind: 'transform', label: t('insert.transform'), Icon: Braces },
        { kind: 'review', label: t('insert.review'), Icon: ShieldCheck },
      ] as const).filter((s) => query === '' || norm(s.label).includes(query)),
    [query],
  );
  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('pointerdown', away);
    return () => window.removeEventListener('pointerdown', away);
  }, [onClose]);
  const first = (): InsertChoice | undefined => (shownAgents[0] ? { kind: 'agent', agentId: shownAgents[0].id } : steps[0] ? { kind: steps[0].kind } : undefined);
  const left = Math.max(8, Math.min(at.x - 180, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 368));
  return (
    <div
      ref={box}
      className="orq-insert"
      role="dialog"
      aria-label={t('insert.title')}
      style={{ left, top: at.y }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="orq-insert__search">
        <Search {...SZ} />
        <input
          autoFocus
          aria-label={t('insert.search')}
          placeholder={t('insert.search')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const c = first();
              if (c) onPick(c);
            }
          }}
        />
      </div>
      {shownAgents.length > 0 && (
        <>
          <p className="orq-insert__sec">{t('insert.agents')}</p>
          {shownAgents.map((a) => (
            <button key={a.id} type="button" className="orq-insert__opt" onClick={() => onPick({ kind: 'agent', agentId: a.id })}>
              <Bot {...SZ} />
              <span>
                <strong>{a.name}</strong>
                {a.description && <span className="orq-hint">{a.description}</span>}
              </span>
            </button>
          ))}
        </>
      )}
      {steps.length > 0 && (
        <>
          <p className="orq-insert__sec">{t('insert.steps')}</p>
          {steps.map(({ kind, label, Icon }) => (
            <button key={kind} type="button" className="orq-insert__opt" onClick={() => onPick({ kind })}>
              <Icon {...SZ} />
              <span>{label}</span>
            </button>
          ))}
        </>
      )}
      {shownAgents.length === 0 && steps.length === 0 && <p className="orq-hint orq-insert__none">{t('insert.empty', { q: q.trim() })}</p>}
      {onCreate && (
        <button type="button" className="orq-insert__opt orq-insert__create" onClick={onCreate}>
          <Plus {...SZ} />
          <span>{t('insert.create')}</span>
        </button>
      )}
    </div>
  );
}
