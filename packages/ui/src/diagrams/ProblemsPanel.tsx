import { AlertTriangle, CircleX } from 'lucide-react';
import { t, type ProblemsView } from '@orquestador/editor';

/** Problemas del diagrama: avisos (a medio montar) en ámbar y errores en rojo [R32.10]. */
export function ProblemsPanel({ problems }: { problems: ProblemsView }) {
  const ordered = [...problems.all].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1));
  return (
    <section className="orq-problems" aria-label={t('problems.title')}>
      <h2>
        {t('problems.title')}{' '}
        <span className="orq-count">{problems.count === 0 ? t('problems.none') : t('problems.count', { count: problems.count })}</span>
      </h2>
      {problems.count > 0 && (
        <>
          <p className="orq-hint orq-problems__sum">{t('problems.summary', { errors: problems.errors, warnings: problems.warnings })}</p>
          <ul>
            {ordered.map((p, i) => (
              <li key={i} className={`is-${p.severity}`}>
                {p.severity === 'error' ? <CircleX size={14} strokeWidth={1.5} aria-hidden="true" /> : <AlertTriangle size={14} strokeWidth={1.5} aria-hidden="true" />}
                <span className="orq-sr">{t(p.severity === 'error' ? 'problems.kind.error' : 'problems.kind.warning')}: </span>
                {p.message}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
