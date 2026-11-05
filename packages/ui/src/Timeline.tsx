import { useMemo, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import type { RunEvent } from '@orquestador/core';
import { formatDuration, runStory, storyClock, storyFilter, t, type MessageKey, type runTimeline, type StoryClass } from '@orquestador/editor';

type Timeline = ReturnType<typeof runTimeline>;
type Labeler = (id: string, path?: readonly string[]) => string;

const MARK_LABEL: Record<string, string> = { question: 'Pregunta', retry: 'Reintento', loop: 'Vuelta', error: 'Error' };
const ZOOMS = [1, 1.5, 2, 3, 4, 6, 8];
const STEPS_S = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200];
const RETURN_RE = /devuelto por (.+)$/;

/** Marcas regulares del eje: unas seis por ancho visible, con un paso «redondo» [R45.14]. */
export function axisTicks(totalS: number, zoom: number): number[] {
  const want = totalS / (6 * zoom);
  const step = STEPS_S.find((s) => s >= want) ?? STEPS_S[STEPS_S.length - 1]!;
  const out: number[] = [];
  for (let s = 0; s <= totalS + 1e-6; s += step) out.push(s);
  return out;
}

const tickLabel = (s: number, totalS: number) => (totalS < 10 ? `${s.toFixed(1).replace('.', ',')} s` : storyClock(s));

/**
 * Cronograma: una fila por paso con su nombre fijo a la izquierda, un tramo por pasada con su etiqueta, las esperas
 * rayadas, los ficheros (rombos) y tus decisiones (círculos); se desplaza en horizontal y tiene zoom [R35.10][R45.14].
 */
export function Gantt({ timeline, selected, label, onPick }: { timeline: Timeline; selected: string | undefined; label: Labeler; onPick: (key: string) => void }) {
  const [zoom, setZoom] = useState(1);
  const [showFiles, setShowFiles] = useState(true);
  const [showDecisions, setShowDecisions] = useState(true);
  if (timeline.steps.length === 0) return <p className="orq-hint">{t('runs.gantt.empty')}</p>;
  const total = timeline.totalS;
  const ticks = axisTicks(total, zoom);
  const zi = ZOOMS.indexOf(zoom);
  const pctOf = (s: number) => Math.min(100, Math.max(0, (s / total) * 100));
  return (
    <div className="orq-gantt orq-gantt2">
      <div className="orq-gantt2__top">
        <strong>{timeline.waitS >= 1 ? t('gantt.head', { total: formatDuration(total), wait: formatDuration(timeline.waitS) }) : t('gantt.headNoWait', { total: formatDuration(total) })}</strong>
        <span className="orq-gantt2__grow" />
        <label className="orq-gantt2__check">
          <input type="checkbox" checked={showFiles} onChange={(e) => setShowFiles(e.target.checked)} />
          {t('gantt.show.files')}
        </label>
        <label className="orq-gantt2__check">
          <input type="checkbox" checked={showDecisions} onChange={(e) => setShowDecisions(e.target.checked)} />
          {t('gantt.show.decisions')}
        </label>
        <div className="orq-gzoom" role="group" aria-label={t('gantt.zoom')}>
          <button type="button" aria-label={t('gantt.zoomOut')} title={t('gantt.zoomOut')} disabled={zi <= 0} onClick={() => setZoom(ZOOMS[Math.max(0, zi - 1)]!)}>
            <Minus size={13} aria-hidden="true" />
          </button>
          <button type="button" aria-pressed={zoom === 1} onClick={() => setZoom(1)}>
            {t('gantt.fit')}
          </button>
          <button type="button" aria-label={t('gantt.zoomIn')} title={t('gantt.zoomIn')} disabled={zi >= ZOOMS.length - 1} onClick={() => setZoom(ZOOMS[Math.min(ZOOMS.length - 1, zi + 1)]!)}>
            <Plus size={13} aria-hidden="true" />
          </button>
        </div>
      </div>
      <ul className="orq-gantt2__legend" aria-label={t('gantt.legend')}>
        <li><span className="orq-gantt2__sw is-ok" aria-hidden="true" />{t('gantt.legend.ok')}</li>
        <li><span className="orq-gantt2__sw is-wait" aria-hidden="true" />{t('gantt.legend.wait')}</li>
        <li><span className="orq-gantt2__sw is-bad" aria-hidden="true" />{t('gantt.legend.bad')}</li>
        <li><span className="orq-gantt2__sw is-file" aria-hidden="true" />{t('gantt.legend.file')}</li>
        <li><span className="orq-gantt2__sw is-dec" aria-hidden="true" />{t('gantt.legend.decision')}</li>
        <li><span className="orq-gantt2__ret-sw" aria-hidden="true">↩</span>{t('gantt.legend.return')}</li>
      </ul>
      <div className="orq-gantt2__scroll" data-zoom={zoom}>
        <div className="orq-gantt2__grid" style={{ width: zoom === 1 ? '100%' : `calc(var(--gname) + (100% - var(--gname)) * ${zoom})` }}>
          <div className="orq-gantt2__axis" aria-hidden="true">
            <span className="orq-gantt2__corner" />
            <div className="orq-gantt2__ticks">
              {ticks.map((s, i) => (
                <span key={s} style={{ left: `${pctOf(s)}%` }} className={i === 0 ? 'is-first' : s >= total - 1e-6 ? 'is-last' : undefined}>
                  {tickLabel(s, total)}
                </span>
              ))}
            </div>
          </div>
          <ol>
            {timeline.steps.map((s) => {
              const name = label(s.nodeId, s.nodePath);
              const busy = s.passes.reduce((sum, p) => sum + (p.endS - p.startS), 0);
              const files = new Set(s.files.map((f) => f.path)).size;
              const meta = [s.passes.length > 1 ? t('gantt.passes', { n: s.passes.length }) : '', formatDuration(busy), files > 0 ? t('gantt.files', { n: files }) : ''].filter(Boolean).join(' · ');
              return (
                <li key={s.key}>
                  <button
                    type="button"
                    className={`orq-gantt__row orq-gantt2__row${s.key === selected ? ' is-on' : ''}`}
                    aria-pressed={s.key === selected}
                    aria-label={t('runs.gantt.row', { step: name, status: t(`node.status.${s.status}` as MessageKey), duration: formatDuration(busy) })}
                    onClick={() => onPick(s.key)}
                  >
                    <span className="orq-gantt2__name">
                      <span className={`orq-gantt2__dot is-${s.status}`} aria-hidden="true" />
                      <span className="orq-gantt2__label" title={name}>
                        <strong>{s.nodePath.length > 0 ? `↳ ${name}` : name}</strong>
                        <span className="orq-hint">{meta}</span>
                      </span>
                    </span>
                    <span className="orq-gantt__track orq-gantt2__track">
                      {ticks.map((x) => (
                        <span key={x} className="orq-gantt2__line" style={{ left: `${pctOf(x)}%` }} aria-hidden="true" />
                      ))}
                      {/* Un tramo por pasada: el hueco entre ellas es el tiempo en que trabajaron otros pasos [R35.17]. */}
                      {s.passes.map((p) => (
                        <span
                          key={p.n}
                          className={`orq-gantt__bar is-${p.status}`}
                          data-pass={p.n}
                          title={t('gantt.passTitle', { n: p.n, from: storyClock(p.startS), to: storyClock(p.endS), duration: formatDuration(p.endS - p.startS) })}
                          style={{ left: `${p.leftPct}%`, width: `max(${p.widthPct}%, 3px)` }}
                        >
                          {/* Las esperas van dentro de su pasada, debajo de la etiqueta [R45.14]. */}
                          {p.waits.map((w, i) => {
                            const span = Math.max(1e-6, p.endS - p.startS);
                            return <span key={i} className="orq-gantt__wait" title={t('gantt.wait', { duration: formatDuration(w.endS - w.startS) })} style={{ left: `${((w.startS - p.startS) / span) * 100}%`, width: `max(${((w.endS - w.startS) / span) * 100}%, 2px)` }} />;
                          })}
                          <span className="orq-gantt2__barlabel">{s.passes.length > 1 ? t('gantt.pass', { n: p.n, duration: formatDuration(p.endS - p.startS) }) : formatDuration(p.endS - p.startS)}</span>
                        </span>
                      ))}
                      {s.marks.map((m, i) => (
                        <span key={i} className={`orq-gantt__mark is-${m.kind}`} style={{ left: `${m.pct}%` }} title={`${MARK_LABEL[m.kind]}: ${m.text}`} />
                      ))}
                      {s.marks.map((m, i) => {
                        const by = RETURN_RE.exec(m.text)?.[1];
                        return by ? (
                          <span key={`r${i}`} className="orq-gantt__ret" style={{ left: `${m.pct}%` }}>
                            {t('gantt.returned', { by })}
                          </span>
                        ) : null;
                      })}
                      {showFiles &&
                        s.files.map((f, i) => (
                          <span key={`f${i}`} className={`orq-gantt__file is-${f.change ?? 'unknown'}`} style={{ left: `${f.pct}%` }} title={t('gantt.file', { change: f.change === 'created' ? t('files.new') : f.change === 'modified' ? t('files.mod') : t('files.unknown'), path: f.path })} />
                        ))}
                      {showDecisions &&
                        s.decisions.map((d, i) => <span key={`d${i}`} className="orq-gantt__dec" style={{ left: `${d.pct}%` }} title={t('gantt.decision', { answer: d.answer, question: d.question.split('\n')[0]! })} />)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
      <p className="orq-hint">{t('gantt.scrollHint')}</p>
    </div>
  );
}

const CLASSES: StoryClass[] = ['step', 'file', 'decision', 'tool'];

/** Relato de la ejecución bajo el cronograma, con filtros; pulsar una línea con paso lo abre [R45.15]. */
export function RunStory({ events, label, onPick }: { events: readonly RunEvent[]; label: Labeler; onPick: (key: string) => void }) {
  const [show, setShow] = useState<Set<StoryClass>>(new Set(['step', 'file', 'decision']));
  const story = useMemo(() => runStory(events, (id, path) => label(id, path)), [events, label]);
  const lines = storyFilter(story, show);
  const toggle = (c: StoryClass) =>
    setShow((s) => {
      const n = new Set(s);
      if (n.has(c)) n.delete(c);
      else n.add(c);
      return n;
    });
  return (
    <section className="orq-story" aria-label={t('story.title')}>
      <header className="orq-story__head">
        <h3>{t('story.title')}</h3>
        <div className="orq-story__filters" role="group" aria-label={t('story.filters')}>
          {CLASSES.map((c) => (
            <label key={c}>
              <input type="checkbox" checked={show.has(c)} onChange={() => toggle(c)} />
              {t(`story.cls.${c}` as MessageKey)}
            </label>
          ))}
        </div>
      </header>
      {lines.length === 0 ? (
        <p className="orq-hint">{t('story.empty')}</p>
      ) : (
        <ol className="orq-story__list">
          {lines.map((l) => {
            const body = (
              <>
                <span className="orq-story__t orq-mono">{storyClock(l.atS)}</span>
                <span className={`orq-story__who is-${l.whoKind}`}>{l.who}</span>
                <span className="orq-story__text">{l.text}</span>
                {l.tag && <span className={`orq-story__tag is-${l.cls}`}>{l.tag}</span>}
              </>
            );
            return (
              <li key={l.seq} className={`is-${l.cls}`}>
                {l.key ? (
                  <button type="button" className="orq-story__line" aria-label={t('story.open', { who: l.who, text: l.text })} onClick={() => onPick(l.key!)}>
                    {body}
                  </button>
                ) : (
                  <div className="orq-story__line">{body}</div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
