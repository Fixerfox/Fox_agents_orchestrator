import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { deliverableBrief, deliverableGoal, deliverableProblems, parseSchema, type DeliverableItem, type DeliverableSpec } from '@orquestador/core';
import { t } from '@orquestador/editor';

type Custom = Extract<DeliverableItem, { kind: 'custom' }>;

interface Props {
  value: DeliverableSpec | undefined;
  onChange: (spec: DeliverableSpec | undefined) => void;
  /** Nombres de los pasos finales del diagrama, para la vista previa [R46.13]. */
  finals: string[];
  disabled?: boolean;
  /** Prefijo de los ids de los campos (el panel puede salir dos veces en pantalla). */
  idPrefix?: string;
}

/** Texto que se guarda al salir del campo (un paso de historial por edición). */
function Draft({ label, value, onCommit, multiline, placeholder, id, mono }: { label: string; value: string; onCommit: (v: string) => void; multiline?: boolean; placeholder?: string; id: string; mono?: boolean }) {
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    setDraft(value);
  }
  const commit = () => draft !== value && onCommit(draft);
  return (
    <label className="orq-dlv__field">
      {label}
      {multiline ? (
        <textarea id={id} rows={3} className={mono ? 'orq-mono' : undefined} value={draft} placeholder={placeholder} onChange={(e) => setDraft(e.target.value)} onBlur={commit} />
      ) : (
        <input id={id} value={draft} placeholder={placeholder} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />
      )}
    </label>
  );
}

/** Orden fijo del documento: enlaces, resumen, JSON y secciones propias [R46.7]. */
function rebuild(spec: DeliverableSpec | undefined, parts: { links?: boolean; summary?: DeliverableItem | null; json?: DeliverableItem | null; customs?: Custom[] }): DeliverableSpec | undefined {
  const items = spec?.items ?? [];
  const pick = <K extends DeliverableItem['kind']>(k: K) => items.find((i) => i.kind === k) as Extract<DeliverableItem, { kind: K }> | undefined;
  const links = parts.links ?? !!pick('links');
  const summary = parts.summary === undefined ? pick('summary') : parts.summary;
  const json = parts.json === undefined ? pick('json') : parts.json;
  const customs = parts.customs ?? (items.filter((i) => i.kind === 'custom') as Custom[]);
  const next: DeliverableItem[] = [...(links ? [{ kind: 'links' as const }] : []), ...(summary ? [summary] : []), ...(json ? [json] : []), ...customs];
  if (next.length === 0) return undefined;
  const { items: _old, ...rest } = spec ?? { items: [] };
  void _old;
  return { ...rest, items: next };
}

/** «Qué quieres al final»: el entregable de la ejecución, en el panel de la Salida y al lanzar [R46.13][R46.14]. */
export function DeliverablePanel({ value, onChange, finals, disabled, idPrefix = 'dlv' }: Props) {
  const items = value?.items ?? [];
  const summary = items.find((i) => i.kind === 'summary') as Extract<DeliverableItem, { kind: 'summary' }> | undefined;
  const json = items.find((i) => i.kind === 'json') as Extract<DeliverableItem, { kind: 'json' }> | undefined;
  const customs = items.filter((i) => i.kind === 'custom') as Custom[];
  const has = (k: DeliverableItem['kind']) => items.some((i) => i.kind === k);
  const set = (parts: Parameters<typeof rebuild>[1]) => onChange(rebuild(value, parts));
  const opt = (patch: Partial<Omit<DeliverableSpec, 'items'>>) => value && onChange({ ...value, ...patch });
  const schemaError = json?.schema?.trim() ? parseSchema(json.schema).error : undefined;
  const problems = value ? deliverableProblems(value).filter((p) => p.code !== 'deliverable-bad-schema') : [];
  const notify = value?.notify ?? 'final';
  const valid = value !== undefined && deliverableProblems(value).length === 0;
  const id = (s: string) => `${idPrefix}-${s}`;

  return (
    <section className="orq-insp__card orq-dlv" role="group" aria-label={t('dlv.title')}>
      <span className="orq-insp__label">{t('dlv.title')}</span>
      <p className="orq-hint">{value ? t('dlv.hint') : t('dlv.off')}</p>

      <label className="orq-dlv__opt">
        <input id={id('links')} type="checkbox" disabled={disabled} checked={has('links')} onChange={(e) => set({ links: e.target.checked })} />
        <span>
          <strong>{t('dlv.links')}</strong>
          <span className="orq-hint">{t('dlv.links.hint')}</span>
        </span>
      </label>

      <label className="orq-dlv__opt">
        <input id={id('summary')} type="checkbox" disabled={disabled} checked={!!summary} onChange={(e) => set({ summary: e.target.checked ? { kind: 'summary' } : null })} />
        <span>
          <strong>{t('dlv.summary')}</strong>
          <span className="orq-hint">{t('dlv.summary.hint')}</span>
        </span>
      </label>
      {summary && (
        <Draft id={id('summary-ins')} label={t('dlv.instructions')} value={summary.instructions ?? ''} multiline onCommit={(v) => set({ summary: v.trim() ? { kind: 'summary', instructions: v } : { kind: 'summary' } })} />
      )}

      <label className="orq-dlv__opt">
        <input id={id('json')} type="checkbox" disabled={disabled} checked={!!json} onChange={(e) => set({ json: e.target.checked ? { kind: 'json' } : null })} />
        <span>
          <strong>{t('dlv.json')}</strong>
          <span className="orq-hint">{t('dlv.json.hint')}</span>
        </span>
      </label>
      {json && (
        <>
          <Draft id={id('json-ins')} label={t('dlv.instructions')} value={json.instructions ?? ''} multiline onCommit={(v) => set({ json: { kind: 'json', ...(json.schema ? { schema: json.schema } : {}), ...(v.trim() ? { instructions: v } : {}) } })} />
          <Draft id={id('json-schema')} label={t('dlv.schema')} mono value={json.schema ?? ''} multiline placeholder='{"type":"object"}' onCommit={(v) => set({ json: { kind: 'json', ...(v.trim() ? { schema: v } : {}), ...(json.instructions ? { instructions: json.instructions } : {}) } })} />
          {schemaError && (
            <p className="orq-field__error" role="alert">
              {schemaError}
            </p>
          )}
        </>
      )}

      <div className="orq-dlv__customs" role="group" aria-label={t('dlv.custom')}>
        <span className="orq-insp__label">{t('dlv.custom')}</span>
        {customs.map((c, i) => (
          <div key={i} className="orq-dlv__custom">
            <Draft id={id(`custom-${i}-title`)} label={t('dlv.custom.title')} value={c.title} onCommit={(v) => set({ customs: customs.map((x, k) => (k === i ? { ...x, title: v } : x)) })} />
            <Draft id={id(`custom-${i}-ins`)} label={t('dlv.custom.instructions')} value={c.instructions} multiline onCommit={(v) => set({ customs: customs.map((x, k) => (k === i ? { ...x, instructions: v } : x)) })} />
            <button type="button" className="orq-iconbtn" disabled={disabled} aria-label={t('dlv.custom.remove', { title: c.title || String(i + 1) })} onClick={() => set({ customs: customs.filter((_, k) => k !== i) })}>
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        ))}
        {items.length < 6 && (
          <button type="button" className="orq-btn orq-btn--small" disabled={disabled} onClick={() => set({ customs: [...customs, { kind: 'custom', title: '', instructions: '' }] })}>
            <Plus size={14} aria-hidden="true" /> {t('dlv.custom.add')}
          </button>
        )}
      </div>

      {value && (
        <>
          <div className="orq-dlv__row">
            <label className="orq-dlv__field">
              {t('dlv.notify')}
              <select id={id('notify')} disabled={disabled} value={notify} onChange={(e) => opt({ notify: e.target.value as 'final' | 'all' | 'none' })}>
                <option value="final">{t('dlv.notify.final')}</option>
                <option value="all">{t('dlv.notify.all')}</option>
                <option value="none">{t('dlv.notify.none')}</option>
              </select>
            </label>
            <label className="orq-dlv__field">
              {t('dlv.missing')}
              <select id={id('missing')} disabled={disabled} value={value.onMissing ?? 'warn'} onChange={(e) => opt({ onMissing: e.target.value as 'warn' | 'fail' })}>
                <option value="warn">{t('dlv.missing.warn')}</option>
                <option value="fail">{t('dlv.missing.fail')}</option>
              </select>
            </label>
          </div>
          <Draft id={id('file')} label={t('dlv.file')} value={value.fileName ?? ''} placeholder="entregable" onCommit={(v) => {
            const { fileName: _f, ...rest } = value;
            void _f;
            onChange(v.trim() ? { ...rest, fileName: v.trim() } : rest);
          }} />
          {problems.map((p, i) => (
            <p key={i} className="orq-field__error" role="alert">
              {p.message}
            </p>
          ))}
          {valid && (
            <div className="orq-dlv__preview" aria-label={t('dlv.preview', { names: finals.join(', ') })}>
              {notify === 'none' ? (
                <p className="orq-hint">{t('dlv.preview.off')}</p>
              ) : finals.length === 0 ? (
                <p className="orq-hint">{t('dlv.preview.nobody')}</p>
              ) : (
                <>
                  <p className="orq-hint">{t('dlv.preview', { names: finals.join(', ') })}</p>
                  <pre className="orq-mono">{deliverableBrief(value)}</pre>
                  {notify === 'all' && (
                    <>
                      <p className="orq-hint">{t('dlv.preview.all')}</p>
                      <pre className="orq-mono">{deliverableGoal(value)}</pre>
                    </>
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
