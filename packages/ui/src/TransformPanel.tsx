import { useMemo, useState } from 'react';
import { DEFAULT_TRANSFORM_ATTEMPTS, MAX_TRANSFORM_ATTEMPTS, parseSchema, type Diagram, type DiagramNode, type RunEvent, type TransformConfig } from '@orquestador/core';
import { previewTransform, t, type MessageKey, type NodePatch } from '@orquestador/editor';

interface Props {
  node: DiagramNode & { transform: TransformConfig };
  level: Diagram;
  path: readonly string[];
  /** Eventos de la última ejecución, para la vista previa [R37.13]. */
  events: readonly RunEvent[];
  /** Nombres de los pasos que le llegan («Recibe: @…»). */
  incoming: string[];
  patch: (p: NodePatch) => void;
}

/** Campo de texto largo con borrador local que se confirma al salir; `check` avisa mientras se escribe. */
function Area({ id, label, value, placeholder, hint, rows = 4, mono, check, onCommit }: { id: string; label: string; value: string; placeholder?: string; hint?: string; rows?: number; mono?: boolean; check?: (v: string) => string | undefined; onCommit: (v: string) => void }) {
  const [text, setText] = useState(value);
  const error = check?.(text);
  return (
    <div className="orq-field">
      <label htmlFor={id}>{label}</label>
      <textarea
        id={id}
        rows={rows}
        className={mono ? 'orq-mono' : undefined}
        placeholder={placeholder}
        value={text}
        spellCheck={!mono}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-err` : undefined}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text !== value && onCommit(text)}
      />
      {error && (
        <span id={`${id}-err`} className="orq-field__error" role="alert">
          {error}
        </span>
      )}
      {hint && <p className="orq-hint">{hint}</p>}
    </div>
  );
}

/** Panel del nodo «Transformar»: modo, formato, plantilla o instrucciones, esquema, intentos y vista previa [R37.12][R37.13]. */
export function TransformPanel({ node, level, path, events, incoming, patch }: Props) {
  const cfg = node.transform;
  const preview = useMemo(() => previewTransform(cfg, events, level, path, node.id), [cfg, events, level, path, node.id]);
  const k = (f: string) => `${node.id}|${f}`;
  return (
    <div className="orq-insp__sec orq-tf" role="group" aria-label={t('node.transform')}>
      <label>
        {t('tf.mode')}
        <select value={cfg.mode} onChange={(e) => patch({ transform: { mode: e.target.value as TransformConfig['mode'] } })}>
          <option value="rules">{t('tf.mode.opt.rules')}</option>
          <option value="ai">{t('tf.mode.opt.ai')}</option>
        </select>
      </label>
      <label>
        {t('tf.format')}
        <select value={cfg.format} onChange={(e) => patch({ transform: { format: e.target.value as TransformConfig['format'] } })}>
          <option value="json">{t('tf.format.json')}</option>
          <option value="markdown">{t('tf.format.markdown')}</option>
          <option value="text">{t('tf.format.text')}</option>
        </select>
      </label>
      {incoming.length > 0 && (
        <div className="orq-insp__recv" aria-label={t('insp.receives')}>
          <span className="orq-hint">{t('insp.receives')}</span>
          {incoming.map((x) => (
            <span key={x} className="orq-tag">
              @{x}
            </span>
          ))}
        </div>
      )}
      {cfg.mode === 'rules' ? (
        <Area
          key={k(`tpl|${cfg.template ?? ''}`)}
          id="tf-template"
          label={t('tf.template')}
          mono
          value={cfg.template ?? ''}
          placeholder={t(cfg.format === 'json' ? 'tf.template.ph.json' : 'tf.template.ph')}
          hint={t('tf.template.hint')}
          onCommit={(v) => patch({ transform: { template: v } })}
        />
      ) : (
        <>
          <Area
            key={k(`ins|${cfg.instructions ?? ''}`)}
            id="tf-instructions"
            label={t('tf.instructions')}
            value={cfg.instructions ?? ''}
            placeholder={t('tf.instructions.ph')}
            onCommit={(v) => patch({ transform: { instructions: v } })}
          />
          <label>
            {t('tf.attempts')}
            <select value={cfg.maxAttempts ?? DEFAULT_TRANSFORM_ATTEMPTS} onChange={(e) => patch({ transform: { maxAttempts: Number(e.target.value) } })}>
              {Array.from({ length: MAX_TRANSFORM_ATTEMPTS }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      {cfg.format === 'json' && (
        <Area
          key={k(`sch|${cfg.schema ?? ''}`)}
          id="tf-schema"
          label={t('tf.schema')}
          mono
          rows={5}
          value={cfg.schema ?? ''}
          placeholder={t('tf.schema.ph')}
          hint={t('tf.schema.hint')}
          check={(v) => (parseSchema(v).error ? t('tf.schema.bad') : undefined)}
          onCommit={(v) => patch({ transform: { schema: v } })}
        />
      )}
      <p className="orq-hint orq-sees">{t(cfg.mode === 'rules' ? 'tf.sees.rules' : 'tf.sees.ai')}</p>

      <div className="orq-tf__preview" role="region" aria-label={t('tf.preview')}>
        <span className="orq-insp__label">{t('tf.preview')}</span>
        {cfg.mode === 'ai' && <p className="orq-hint">{t('tf.preview.ai')}</p>}
        {preview.source === 'none' ? (
          <p className="orq-hint">{t('tf.preview.none')}</p>
        ) : (
          <p className="orq-hint">{t(`tf.preview.from.${preview.source}` as MessageKey)}</p>
        )}
        {preview.result?.ok === true && (
          <>
            <span className="orq-hint">{cfg.mode === 'ai' ? t('tf.preview.ai.ok') : t('tf.preview.ok')}</span>
            {cfg.mode === 'rules' && <pre className="orq-tf__out" data-testid="tf-out">{preview.result.text}</pre>}
          </>
        )}
        {preview.result?.ok === false && (
          <div className="orq-tf__err" role="status">
            <strong>{t('tf.preview.error')}</strong>
            <ul>
              {preview.result.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </div>
        )}
        {preview.result && preview.result.warnings.length > 0 && (
          <div className="orq-tf__warn" role="status">
            <strong>{t('tf.preview.warn')}</strong>
            <ul>
              {preview.result.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        )}
        {(preview.source === 'none' || preview.source === 'sample') && (
          <Area key={k(`smp|${cfg.sample ?? ''}`)} id="tf-sample" label={t('tf.sample')} mono rows={3} value={cfg.sample ?? ''} placeholder={t('tf.sample.ph')} onCommit={(v) => patch({ transform: { sample: v } })} />
        )}
      </div>
    </div>
  );
}
