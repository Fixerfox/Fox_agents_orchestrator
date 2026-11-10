import { t } from './i18n';
/** Tokens de forma compacta: hasta 9.999 tal cual; después «433 k» o «1,2 M» [R83.6]. */
export function formatTokens(n: number): string {
  if (n < 10_000) return Math.round(n).toLocaleString('es-ES');
  if (n < 1_000_000) return `${Math.round(n / 1000).toLocaleString('es-ES')} k`;
  return `${(n / 1_000_000).toLocaleString('es-ES', { maximumFractionDigits: 1 })} M`;
}

/** «433 k tokens · 396 k de caché»: lo leído de la caché aparte, porque cuesta mucho menos [R83.6]. */
export function usageText(usage: { inputTokens: number; outputTokens: number; cachedTokens?: number }): string {
  const total = t('usage.tokens', { n: formatTokens(usage.inputTokens + usage.outputTokens) });
  return usage.cachedTokens ? `${total} · ${t('usage.cached', { n: formatTokens(usage.cachedTokens) })}` : total;
}
