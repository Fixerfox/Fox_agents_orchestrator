import type { ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import type { AgentDefinition } from '@orquestador/core';
import { t, type MessageKey } from '@orquestador/editor';

/** Pasos para crear un agente [R57.3]. «Revisar» es el último. */
const AGENT_STEPS = ['what', 'know', 'can', 'review'] as const;
/** Secciones de la ficha de un agente guardado [R57.5]. */
const AGENT_SECTIONS = ['what', 'know', 'can', 'model', 'where'] as const;
export type AgentSection = (typeof AGENT_SECTIONS)[number];

/** Las piezas de la ficha: los mismos campos sirven para los pasos al crear y para las secciones al editar [R57.3][R57.5]. */
interface Parts {
  whatPart: ReactNode;
  knowPart: ReactNode;
  canPart: ReactNode;
  modelPart: ReactNode;
  preview: ReactNode;
}

/** Crear: cuatro pasos con la vista previa a la derecha [R57.3][R57.4]. */
export function AgentWizard({ step, goStep, drafting, busy, draft, errors, permLabel, modelName, knowNames, whatPart, knowPart, canPart, modelPart, preview }: Parts & {
  step: number;
  goStep: (n: number) => void;
  drafting: 'busy' | 'error' | undefined;
  busy: boolean;
  draft: AgentDefinition;
  errors: Record<string, string>;
  permLabel: string;
  modelName: string;
  /** Nombres de lo asignado, para el paso de revisar. */
  knowNames: string[];
}) {
  return (
    <div className="orq-agentw">
      <ol className="orq-agentw__steps" aria-label={t('agentw.steps')}>
        {AGENT_STEPS.map((s, i) => (
          <li key={s}>
            <button type="button" className={`orq-agentw__step${step === i + 1 ? ' is-on' : i + 1 < step ? ' is-done' : ''}`} aria-current={step === i + 1 ? 'step' : undefined} onClick={() => goStep(i + 1)}>
              <span className="orq-agentw__dot" aria-hidden="true">
                {i + 1 < step ? '✓' : i + 1}
              </span>
              {t(`agentw.step.${s}` as MessageKey)}
            </button>
          </li>
        ))}
      </ol>
      <div className="orq-agentw__body">
        <div className="orq-agentw__main">
          <h2 className="orq-agentw__title">{t(`agentw.step.${AGENT_STEPS[step - 1] ?? 'what'}` as MessageKey)}</h2>
          <p className="orq-hint">{t(`agentw.step.${AGENT_STEPS[step - 1] ?? 'what'}.sub` as MessageKey)}</p>
          {drafting === 'busy' && (
            <p className="orq-agentw__drafting" role="status">
              <Loader2 size={14} className="orq-spin" aria-hidden="true" />
              {t('agentw.drafting')}
            </p>
          )}
          {drafting === 'error' && (
            <p className="orq-field__error" role="alert">
              {t('agentw.draft.failed')}
            </p>
          )}
          {step === 1 && whatPart}
          {step === 2 && knowPart}
          {step === 3 && (
            <>
              {canPart}
              {modelPart}
            </>
          )}
          {step === 4 && (
            <ul className="orq-agentw__review" aria-label={t('agentw.step.review')}>
              {[
                { n: 1, title: t('agentw.step.what'), text: `${draft.name || t('lib.untitled')} · ${draft.description || t('lib.noDesc')} · ${t('agentw.review.lines', { n: draft.instructions.split('\n').filter((l) => l.trim()).length })}` },
                { n: 2, title: t('agentw.step.know'), text: knowNames.join(' · ') || t('agentw.review.nothing') },
                { n: 3, title: t('agentw.step.can'), text: `${permLabel}${draft.askFirst ? ` · ${t('askfirst.mark')}` : ''}` },
                { n: 3, title: t('agent.model'), text: modelName },
              ].map((r) => (
                <li key={r.title}>
                  <strong>{r.title}</strong>
                  <span>{r.text}</span>
                  <button type="button" className="orq-btn orq-btn--small orq-btn--ghost" aria-label={t('agentw.change', { what: r.title })} onClick={() => goStep(r.n)}>
                    {t('agentw.change.short')}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {errors['_'] && (
            <p className="orq-field__error" role="alert">
              {errors['_']}
            </p>
          )}
        </div>
        <aside className="orq-agentw__side" aria-label={t('agentw.side')}>
          {preview}
          <p className="orq-hint">{t('agentw.side.hint')}</p>
        </aside>
      </div>
      <footer className="orq-agentw__foot">
        <span className="orq-hint">{t('agentw.count', { n: step })}</span>
        <span className="orq-grow" />
        {step > 1 && (
          <button type="button" className="orq-btn" onClick={() => goStep(step - 1)}>
            {t('agentw.back')}
          </button>
        )}
        {step < AGENT_STEPS.length ? (
          <button type="button" className="orq-btn orq-btn--primary" onClick={() => goStep(step + 1)}>
            {t('agentw.next')}
          </button>
        ) : (
          <button type="submit" className="orq-btn orq-btn--primary" disabled={busy}>
            {t('agentw.create')}
          </button>
        )}
      </footer>
    </div>
  );
}

/** Editar: una sección cada vez, con índice [R57.5]. */
export function AgentSections({ section, setSection, draft, errors, permLabel, modelName, knowFacts, where, whatPart, knowPart, canPart, modelPart, preview }: Parts & {
  section: AgentSection;
  setSection: (section: AgentSection) => void;
  draft: AgentDefinition;
  errors: Record<string, string>;
  permLabel: string;
  modelName: string;
  knowFacts: string;
  where: { diagramId: string; name: string }[] | undefined;
}) {
  return (
    <div className="orq-agentf2">
      <nav className="orq-agentf2__nav" aria-label={t('agentf.sections')}>
        {AGENT_SECTIONS.map((sec) => (
          <button key={sec} type="button" className={`orq-agentf2__item${section === sec ? ' is-on' : ''}`} aria-current={section === sec ? 'page' : undefined} onClick={() => setSection(sec)}>
            <strong>{t(`agentf.sec.${sec}` as MessageKey)}</strong>
            <small>{sec === 'what' ? draft.description || t('lib.noDesc') : sec === 'know' ? knowFacts : sec === 'can' ? permLabel : sec === 'model' ? modelName : where === undefined ? '…' : t('agentf.where.count', { n: where.length })}</small>
          </button>
        ))}
      </nav>
      <div className="orq-agentf2__main">
        <h2 className="orq-agentw__title">{t(`agentf.sec.${section}` as MessageKey)}</h2>
        {section === 'what' && whatPart}
        {section === 'know' && knowPart}
        {section === 'can' && canPart}
        {section === 'model' && (
          <>
            {preview}
            {modelPart}
          </>
        )}
        {section === 'where' && (
          <section className="orq-editor__side-sec" aria-label={t('lib.where')}>
            {where && where.length === 0 ? <p className="orq-hint">{t('lib.where.none')}</p> : where?.map((w) => <p key={w.diagramId} className="orq-hint">{w.name}</p>)}
          </section>
        )}
        {errors['_'] && (
          <p className="orq-field__error" role="alert">
            {errors['_']}
          </p>
        )}
      </div>
    </div>
  );
}
