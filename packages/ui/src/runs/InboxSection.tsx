import { type Diagram } from '@orquestador/core';
import { type HistoryRow, t } from '@orquestador/editor';
import type { InboxItem } from './useRunsIndex';
import { nodeLabel, diagramLabel } from './runFormat';
import { QuestionCard } from './QuestionCard';

/** Necesitan tu respuesta: preguntas pendientes de todas las ejecuciones en curso [R35.6]. */
export function InboxSection({ items, rows, answer, open, diagrams }: { items: InboxItem[]; rows: HistoryRow[]; answer: (i: InboxItem, text: string) => void; open: (runId: string) => void; diagrams: Record<string, Diagram | null> }) {
  return (
    <div className="orq-runs2__page orq-runs2__page--narrow">
      <header className="orq-runs2__head">
        <h1>{t('runs.sec.inbox')}</h1>
        <span className="orq-hint">{t('runs.sec.inbox.hint')}</span>
      </header>
      {items.length === 0 ? (
        <p className="orq-runs2__empty">{t('runs.inbox.empty')}</p>
      ) : (
        items.map((q) => {
          const row = rows.find((r) => r.runId === q.runId);
          const from = nodeLabel(row ? (diagrams[row.diagramId] ?? undefined) : undefined, q.nodeId, q.nodePath);
          return (
            <QuestionCard key={`${q.runId}:${q.questionId}`} item={q} from={from} context={t('runs.inbox.in', { diagram: diagramLabel(row) })} onAnswer={(text) => answer(q, text)}>
              <button type="button" className="orq-btn orq-btn--small" onClick={() => open(q.runId)}>
                {t('runs.inbox.openRun')}
              </button>
            </QuestionCard>
          );
        })
      )}
    </div>
  );
}
