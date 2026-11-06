import { ExternalLink } from 'lucide-react';
import { reviewNumber, t } from '@orquestador/editor';

/** Enlace a una PR o merge request; la ventana lo abre en el navegador [R58.15]. */
export function PrLink({ url, className = '' }: { url: string; className?: string }) {
  return (
    <a className={`orq-prlink nodrag nopan ${className}`.trim()} href={url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
      {t('git.pr.open', { n: reviewNumber(url) })}
      <ExternalLink size={12} aria-hidden="true" />
    </a>
  );
}
