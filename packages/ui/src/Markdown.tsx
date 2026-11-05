import { Fragment, useMemo, type ReactNode } from 'react';
import { parseMarkdown, t, type MdBlock, type MdInline } from '@orquestador/editor';

/** Dibuja Markdown básico con elementos de React: nunca inserta HTML; los enlaces no navegan [R38.2]. */
export function Markdown({ text, className }: { text: string; className?: string }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return <div className={`orq-md${className ? ` ${className}` : ''}`}>{blocks.map(block)}</div>;
}

function block(b: MdBlock, i: number): ReactNode {
  switch (b.t) {
    case 'p':
      return <p key={i}>{inline(b.c)}</p>;
    case 'h': {
      const H = (`h${b.level + 2}` as 'h3' | 'h4' | 'h5');
      return <H key={i}>{inline(b.c)}</H>;
    }
    case 'ul':
      return (
        <ul key={i}>
          {b.items.map((it, j) => (
            <li key={j}>{inline(it)}</li>
          ))}
        </ul>
      );
    case 'ol':
      return (
        <ol key={i} start={b.start}>
          {b.items.map((it, j) => (
            <li key={j}>{inline(it)}</li>
          ))}
        </ol>
      );
    case 'code':
      return (
        <pre key={i} className="orq-md__pre" data-lang={b.lang || undefined}>
          <code>{b.v}</code>
        </pre>
      );
    case 'quote':
      return <blockquote key={i}>{inline(b.c)}</blockquote>;
    case 'hr':
      return <hr key={i} />;
  }
}

function inline(nodes: MdInline[]): ReactNode {
  return nodes.map((n, i) => {
    switch (n.t) {
      case 'text':
        return <Fragment key={i}>{n.v}</Fragment>;
      case 'br':
        return <br key={i} />;
      case 'strong':
        return <strong key={i}>{inline(n.c)}</strong>;
      case 'em':
        return <em key={i}>{inline(n.c)}</em>;
      case 'code':
        return <code key={i}>{n.v}</code>;
      case 'link':
        return (
          <span key={i} className="orq-md__link" title={t('as.link', { url: n.url })}>
            {n.text}
            {n.text !== n.url && <span className="orq-md__url"> ({n.url})</span>}
          </span>
        );
    }
  });
}
