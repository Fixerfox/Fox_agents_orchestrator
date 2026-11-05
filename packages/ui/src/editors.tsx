import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type RefObject } from 'react';
import { FileUp, Maximize2, Minimize2 } from 'lucide-react';
import { MODELS } from '@orquestador/core';
import { lineDiff, t, type MessageKey, type ProjectApi } from '@orquestador/editor';
import { Field } from './fields';

const SZ = { size: 16, strokeWidth: 1.5, 'aria-hidden': true } as const;

/** Tamaño máximo de un .md cargado: el mismo tope de lectura que la vista de archivos [R24.12]. */
export const MD_MAX_BYTES = 200_000;

/** Borradores sin guardar de la pantalla «Agentes»: sobreviven al cambiar de pestaña o de elemento [R22.11]. */
export class DraftStore {
  private readonly map = new Map<string, unknown>();
  private version = 0;
  private readonly listeners = new Set<() => void>();
  get<T>(key: string): T | undefined {
    return this.map.get(key) as T | undefined;
  }
  has(key: string): boolean {
    return this.map.has(key);
  }
  any(prefix: string): boolean {
    for (const k of this.map.keys()) if (k.startsWith(prefix)) return true;
    return false;
  }
  set(key: string, value: unknown): void {
    const had = this.map.has(key);
    this.map.set(key, value);
    if (!had) this.bump();
  }
  delete(key: string): void {
    if (this.map.delete(key)) this.bump();
  }
  /** Quita el borrador de un elemento y los de sus campos auxiliares. */
  discard(key: string): void {
    this.delete(key);
    this.delete(`${key}#turns`);
  }
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };
  readonly snapshot = () => this.version;
  private bump() {
    this.version++;
    for (const l of this.listeners) l();
  }
}

/** Reenvía los cambios de presencia del almacén para repintar marcas de «sin guardar». */
export function useDraftVersion(store: DraftStore): number {
  return useSyncExternalStore(store.subscribe, store.snapshot);
}

/** Estado de formulario respaldado por el almacén: solo se guarda si difiere de la base [R22.11]. */
export function useDraftState<T>(store: DraftStore, key: string, base: T): [T, (update: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => store.get<T>(key) ?? base);
  const baseJson = JSON.stringify(base);
  useEffect(() => {
    if (JSON.stringify(value) === baseJson) store.delete(key);
    else store.set(key, value);
  }, [store, key, value, baseJson]);
  return [value, setValue];
}

function readText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(new Error('read'));
    reader.readAsText(file);
  });
}

interface MarkdownFieldProps {
  id: string;
  label: string;
  value: string;
  max: number;
  error?: string | undefined;
  onChange: (value: string) => void;
  /** Botón ✦ de Claude dentro del campo [R32.5]. */
  assist?: AssistConfig | undefined;
  /** Abre «Pedir a Claude» al aparecer [R32.31]. */
  openAssist?: boolean;
}

/** Editor de texto largo: alto, ampliable, con contador y carga de un archivo .md [R22.12][R22.13]. */
export function MarkdownField({ id, label, value, max, error, onChange, assist, openAssist }: MarkdownFieldProps) {
  const [big, setBig] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [pending, setPending] = useState<{ name: string; text: string }>();
  const input = useRef<HTMLInputElement>(null);

  const finish = (name: string, text: string, mode: 'replace' | 'append') => {
    onChange(mode === 'append' && value.trim() !== '' ? `${value.replace(/\s+$/, '')}\n\n${text}` : text);
    setPending(undefined);
    setNotice(t('md.loaded', { name, chars: text.length }));
  };
  const pick = async (file: File | undefined) => {
    if (input.current) input.current.value = '';
    if (!file) return;
    setNotice(undefined);
    setPending(undefined);
    if (file.size > MD_MAX_BYTES) return setNotice(t('md.tooBig', { max: MD_MAX_BYTES / 1000 }));
    let text: string;
    try {
      text = (await readText(file)).replace(/^\uFEFF/, '');
    } catch {
      return setNotice(t('md.notText'));
    }
    if (text.includes('\u0000')) return setNotice(t('md.notText'));
    if (value.trim() === '') finish(file.name, text, 'replace');
    else setPending({ name: file.name, text });
  };
  const over = value.length > max;
  const ai = useClaudeAssist(assist);
  useEffect(() => {
    if (openAssist && assist) ai.setOpen(true);
    // solo al montar: abre «Pedir a Claude» cuando se llega desde «✦ Con Claude» [R32.31]
  }, []);

  return (
    <Field label={label} id={id} error={error}>
      <div className="orq-md__bar">
        <button type="button" className="orq-btn orq-btn--small" onClick={() => input.current?.click()}>
          <FileUp {...SZ} />
          {t('md.load')}
        </button>
        <button type="button" className="orq-btn orq-btn--small" aria-pressed={big} onClick={() => setBig((b) => !b)}>
          {big ? <Minimize2 {...SZ} /> : <Maximize2 {...SZ} />}
          {t(big ? 'md.shrink' : 'md.expand')}
        </button>
        <input
          ref={input}
          type="file"
          hidden
          accept=".md,.markdown,.txt,text/markdown,text/plain"
          aria-label={t('md.fileAria', { field: label })}
          onChange={(e) => void pick(e.target.files?.[0])}
        />
        {assist && <ClaudeButton ai={ai} fieldEmpty={value.trim() === ''} />}
      </div>
      {assist && <ClaudeMenu ai={ai} id={id} fieldEmpty={value.trim() === ''} kind={assist.kind} />}
      {assist && <ClaudeStatus ai={ai} />}
      {assist && ai.result ? (
        <ClaudeDiff ai={ai} config={assist} />
      ) : (
      <textarea
        id={id}
        className={`orq-md${big ? ' orq-md--big' : ''}`}
        value={value}
        aria-invalid={Boolean(error) || over}
        aria-describedby={error ? `${id}-error` : `${id}-count`}
        spellCheck
        onChange={(e) => onChange(e.target.value)}
      />
      )}
      {pending && (
        <div className="orq-confirm" role="alertdialog" aria-label={t('md.replaceAsk', { name: pending.name })}>
          <p>{t('md.replaceAsk', { name: pending.name })}</p>
          <div className="orq-form__actions">
            <button type="button" className="orq-btn orq-btn--danger" onClick={() => finish(pending.name, pending.text, 'replace')}>
              {t('md.replace')}
            </button>
            <button type="button" className="orq-btn" onClick={() => finish(pending.name, pending.text, 'append')}>
              {t('md.append')}
            </button>
            <button type="button" className="orq-btn" onClick={() => setPending(undefined)}>
              {t('form.cancel')}
            </button>
          </div>
        </div>
      )}
      <p className={`orq-hint orq-md__count${over ? ' is-over' : ''}`} id={`${id}-count`}>
        {t('md.count', { n: value.length.toLocaleString('es-ES'), max: max.toLocaleString('es-ES') })}
        {notice && <span role="status"> · {notice}</span>}
      </p>
    </Field>
  );
}

export type AssistKind = 'agent' | 'skill' | 'context';

/** Lo que necesita el botón ✦ de un campo: con qué pide a Claude y cómo aplica la propuesta [R32.5]. */
export interface AssistConfig {
  api: ProjectApi;
  kind: AssistKind;
  /** Campo del formulario que muestra este editor; su cambio se ve como diferencias por líneas. */
  field: string;
  /** Campos actuales del formulario. */
  current: Record<string, unknown>;
  /** Nombre de cada id de contexto y skill, para mostrar los cambios. */
  names: { contexts: Record<string, string>; skills: Record<string, string> };
  onApply: (fields: Record<string, unknown>) => void;
}

const LABELS: Record<AssistKind, Record<string, MessageKey>> = {
  agent: { name: 'agent.name', description: 'agent.description', instructions: 'agent.instructions', model: 'agent.model', contextIds: 'agent.contexts', skillIds: 'agent.skills' },
  skill: { name: 'skill.name', description: 'skill.description', body: 'skill.body' },
  context: { name: 'context.name', value: 'context.value.text' },
};
const CHIPS: MessageKey[] = ['assist.chip.strict', 'assist.chip.short', 'assist.chip.examples', 'assist.chip.format'];

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function show(key: string, v: unknown, names: AssistConfig['names']): string {
  if (Array.isArray(v)) {
    const dict = key === 'contextIds' ? names.contexts : names.skills;
    return v.length === 0 ? t('assist.empty') : v.map((x) => dict[String(x)] ?? String(x)).join(', ');
  }
  if (key === 'model') return MODELS.find((m) => m.id === v)?.name ?? String(v);
  const text = typeof v === 'string' ? v.trim() : '';
  if (text === '') return t('assist.empty');
  return text.length > 240 ? `${text.slice(0, 240)}…` : text;
}

type DraftResult = { fields: Record<string, unknown>; problems: { field: string; message: string }[]; ms: number };

export interface AssistState {
  config: AssistConfig | undefined;
  open: boolean;
  setOpen: (v: boolean) => void;
  instruction: string;
  setInstruction: (v: string) => void;
  busy: boolean;
  error: string | undefined;
  result: DraftResult | undefined;
  asked: string;
  applied: boolean;
  run: (text?: string) => Promise<void>;
  discard: () => void;
  accept: () => void;
  button: RefObject<HTMLButtonElement | null>;
}

/** Estado del botón ✦: pide una propuesta, la guarda como borrador y la aplica solo al aceptar [R26.2][R32.7]. */
export function useClaudeAssist(config: AssistConfig | undefined): AssistState {
  const [open, setOpen] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<DraftResult>();
  const [asked, setAsked] = useState('');
  const [applied, setApplied] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const run = async (text?: string) => {
    const ask = (text ?? instruction).trim();
    if (!config || ask === '' || busy) return;
    const filled = Object.entries(config.current).some(([k, v]) => k !== 'model' && (typeof v === 'string' ? v.trim() !== '' : Array.isArray(v) && v.length > 0));
    setBusy(true);
    setError(undefined);
    setApplied(false);
    setOpen(false);
    setAsked(ask);
    const res = await config.api.draftWithClaude({ kind: config.kind, instruction: ask, ...(filled ? { current: config.current } : {}) });
    if (!alive.current) return;
    setBusy(false);
    if (!res.ok) return setError(res.error.message); // el formulario no pierde lo escrito [R26.5]
    setResult(res.value);
  };
  return {
    config,
    open,
    setOpen,
    instruction,
    setInstruction,
    busy,
    error,
    result,
    asked,
    applied,
    run,
    discard: () => {
      setResult(undefined);
      button.current?.focus();
    },
    accept: () => {
      if (!config || !result) return;
      config.onApply(result.fields);
      setResult(undefined);
      setApplied(true);
    },
    button,
  };
}

const Spark = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
  </svg>
);

export function ClaudeButton({ ai, fieldEmpty }: { ai: AssistState; fieldEmpty: boolean }) {
  return (
    <button
      ref={ai.button}
      type="button"
      className="orq-btn orq-btn--small orq-ai__btn"
      aria-expanded={ai.open}
      aria-haspopup="dialog"
      disabled={ai.busy}
      onClick={() => ai.setOpen(!ai.open)}
    >
      <Spark />
      {t(fieldEmpty ? 'assist.field.write' : 'assist.field.improve')}
    </button>
  );
}

/** Menú anclado al campo: una línea de indicación y atajos [R32.6]. */
export function ClaudeMenu({ ai, id, fieldEmpty, kind, labels }: { ai: AssistState; id: string; fieldEmpty: boolean; kind: AssistKind; labels?: { label: string; placeholder: string } }) {
  if (!ai.open) return null;
  const close = () => {
    ai.setOpen(false);
    ai.button.current?.focus();
  };
  const filled = ai.config ? Object.entries(ai.config.current).some(([k, v]) => k !== 'model' && (typeof v === 'string' ? v.trim() !== '' : Array.isArray(v) && v.length > 0)) : false;
  const label = labels ? labels.label : t(filled ? 'assist.label.improve' : kind === 'agent' ? 'assist.label.agent' : kind === 'skill' ? 'assist.label.skill' : 'assist.label.context');
  const placeholder = labels ? labels.placeholder : t(filled ? 'assist.placeholder.improve' : kind === 'agent' ? 'assist.placeholder.agent' : kind === 'skill' ? 'assist.placeholder.skill' : 'assist.placeholder.context');
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  return (
    <div className="orq-ai__menu" role="dialog" aria-label={t('assist.field.dialog')} onKeyDown={onKey}>
      <label htmlFor={`${id}-ai`}>{label}</label>
      <div className="orq-ai__row">
        <input
          id={`${id}-ai`}
          value={ai.instruction}
          placeholder={placeholder}
          maxLength={4000}
          autoFocus
          onChange={(e) => ai.setInstruction(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void ai.run();
            }
          }}
        />
        <button type="button" className="orq-btn orq-btn--primary orq-btn--small" disabled={ai.instruction.trim() === ''} onClick={() => void ai.run()}>
          {t('assist.field.go')}
        </button>
      </div>
      {!fieldEmpty && (
        <div className="orq-ai__chips">
          {CHIPS.map((k) => (
            <button key={k} type="button" className="orq-ai__chip" onClick={() => void ai.run(t(k))}>
              {t(k)}
            </button>
          ))}
        </div>
      )}
      <p className="orq-hint">{t('assist.privacy')}</p>
    </div>
  );
}

export function ClaudeStatus({ ai }: { ai: AssistState }) {
  return (
    <>
      {ai.busy && (
        <p className="orq-hint" role="status">
          {t('assist.running')}
        </p>
      )}
      {ai.applied && !ai.result && (
        <p className="orq-hint" role="status">
          {t('assist.applied')}
        </p>
      )}
      {ai.error && (
        <p className="orq-field__error" role="alert">
          {ai.error}
        </p>
      )}
    </>
  );
}

/** La propuesta dentro del campo: líneas quitadas y añadidas, otros campos y acciones [R32.7]. */
export function ClaudeDiff({ ai, config }: { ai: AssistState; config: AssistConfig }) {
  const result = ai.result!;
  const labels = LABELS[config.kind];
  const before = String(config.current[config.field] ?? '');
  const proposed = result.fields[config.field];
  const lines = typeof proposed === 'string' ? lineDiff(before, proposed) : [];
  const others = Object.entries(result.fields).filter(([k, v]) => k !== config.field && !same(v, config.current[k] ?? (Array.isArray(v) ? [] : '')));
  const del = lines.filter((l) => l.kind === 'del').length;
  const add = lines.filter((l) => l.kind === 'add').length;
  const nothing = del + add === 0 && others.length === 0;
  return (
    <section className="orq-aidiff" aria-label={t('assist.diff')}>
      <p className="orq-hint orq-aidiff__sum" role="status">
        {nothing ? t('assist.none') : t('assist.diff.summary', { asked: ai.asked, del, add })}
      </p>
      {lines.length > 0 && (
        <div className="orq-aidiff__lines">
          {lines.map((l, i) => (
            <div key={i} className={`orq-aidiff__line is-${l.kind}`}>
              {l.kind !== 'same' && <span className="orq-sr">{t(l.kind === 'del' ? 'assist.diff.del' : 'assist.diff.add')}</span>}
              {l.text || ' '}
            </div>
          ))}
        </div>
      )}
      {others.length > 0 && (
        <>
          <h4>{t('assist.other')}</h4>
          <dl className="orq-diff">
            {others.map(([k, v]) => (
              <div key={k} className="orq-diff__row">
                <dt>{labels[k] ? t(labels[k]) : k}</dt>
                <dd className="orq-diff__before">
                  <span>{t('assist.before')}</span>
                  {show(k, config.current[k], config.names)}
                </dd>
                <dd className="orq-diff__after">
                  <span>{t('assist.after')}</span>
                  {show(k, v, config.names)}
                </dd>
              </div>
            ))}
          </dl>
        </>
      )}
      {result.problems.length > 0 && (
        <div role="alert" className="orq-field__error">
          <p>{t('assist.problems')}</p>
          <ul>
            {result.problems.map((p) => (
              <li key={p.field}>
                {labels[p.field] ? t(labels[p.field]!) : p.field}: {p.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="orq-form__actions">
        <button type="button" className="orq-btn orq-btn--primary" disabled={nothing} onClick={ai.accept}>
          {t('assist.accept')}
        </button>
        <button type="button" className="orq-btn" disabled={ai.busy} onClick={() => void ai.run(ai.asked)}>
          {t('assist.again')}
        </button>
        <button type="button" className="orq-btn" onClick={ai.discard}>
          {t('assist.discard')}
        </button>
      </div>
    </section>
  );
}
