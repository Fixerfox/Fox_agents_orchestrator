import { PROTECTED_BRANCHES } from './git-guard';

export type ReviewProvider = 'github' | 'gitlab';

/** Dónde vive el repositorio, leído de la dirección de `origin` [R99.1]. */
export interface RemoteRepo {
  provider: ReviewProvider;
  /** Servidor, con su puerto si lo lleva una dirección HTTPS. */
  host: string;
  /** Ruta completa del proyecto: `dueño/repo`, o con subgrupos en GitLab. */
  path: string;
  name: string;
}

export type ReviewState = 'open' | 'draft' | 'merged' | 'closed';
export type ChecksState = 'passing' | 'failing' | 'pending';
export interface ReviewChecks {
  state: ChecksState;
  passed: number;
  total: number;
}

/** Una PR o MR tal como la enseña el visor [R99.3]. */
export interface ReviewInfo {
  number: number;
  title: string;
  state: ReviewState;
  head: string;
  base: string;
  url?: string;
  checks?: ReviewChecks;
}

export interface ReviewDraft {
  title: string;
  body?: string;
  head: string;
  base: string;
  draft?: boolean;
}

export const MAX_REVIEW_TITLE = 250;
export const MAX_REVIEW_BODY = 20_000;

const providerOf = (host: string): ReviewProvider | undefined => {
  const h = host.toLowerCase().replace(/:\d+$/, '');
  if (h === 'github.com' || h.includes('github')) return 'github';
  if (h.includes('gitlab')) return 'gitlab';
  return undefined;
};

/** Lee la dirección de `origin`: HTTPS, `git@servidor:ruta` o `ssh://`; sin credenciales ni `.git` [R99.1]. */
export function parseRemoteUrl(url: string): RemoteRepo | undefined {
  const text = url.trim();
  let host: string | undefined;
  let path: string | undefined;
  const scp = /^(?:[\w.-]+@)?([\w.-]+):(?!\/\/)([^\s:]+)$/.exec(text);
  if (/^(https?|ssh|git):\/\//i.test(text)) {
    try {
      const u = new URL(text);
      // El puerto de SSH no es el de la web: solo se conserva en una dirección HTTP(S).
      host = /^https?:$/i.test(u.protocol) ? u.host : u.hostname;
      path = decodeURIComponent(u.pathname);
    } catch {
      return undefined;
    }
  } else if (scp) {
    host = scp[1];
    path = scp[2];
  }
  if (!host || !path) return undefined;
  const clean = path.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '');
  const parts = clean.split('/');
  if (parts.length < 2 || parts.some((p) => p === '' || p === '.' || p === '..' || !/^[\w.-]+$/.test(p))) return undefined;
  const provider = providerOf(host);
  if (!provider) return undefined;
  // En GitHub un proyecto es siempre `dueño/repo`.
  if (provider === 'github' && parts.length !== 2) return undefined;
  return { provider, host: host.toLowerCase(), path: clean, name: parts[parts.length - 1]! };
}

/** «PR» en GitHub y «MR» en GitLab [R99.2]. */
export const reviewWord = (provider: ReviewProvider): 'PR' | 'MR' => (provider === 'github' ? 'PR' : 'MR');

/** Destino que se propone para una revisión: `develop` si existe y, si no, `main`, `master` o `trunk` [R99.2]. */
export function defaultReviewBase(branches: readonly string[], head: string | undefined): string | undefined {
  return ['develop', ...PROTECTED_BRANCHES].find((b) => b !== head && branches.includes(b));
}

/** Solo vale un enlace `https` con forma de PR o MR; lo demás no se enseña como enlace [R99.6]. */
export function reviewUrl(url: unknown): string | undefined {
  return typeof url === 'string' && /^https:\/\/[^\s/]+\/[^\s?#]+\/(?:pull|pull-requests|-\/merge_requests)\/\d+$/.test(url) ? url : undefined;
}

/** Resume unas comprobaciones: si alguna falla, falla; si alguna sigue, en marcha; si no, pasan [R99.3]. */
export function summarizeChecks(results: readonly ('pass' | 'fail' | 'pending')[]): ReviewChecks | undefined {
  if (results.length === 0) return undefined;
  const passed = results.filter((r) => r === 'pass').length;
  return { state: results.includes('fail') ? 'failing' : results.includes('pending') ? 'pending' : 'passing', passed, total: results.length };
}

/** Motivo por el que no se puede abrir esa revisión; `undefined` si se puede [R99.9]. Pura. */
export function reviewDraftProblem(draft: ReviewDraft, ctx: { branches: readonly string[]; pushed: readonly string[]; open: readonly ReviewInfo[]; word: string }): string | undefined {
  if (draft.title.trim() === '') return `La ${ctx.word} necesita un título.`;
  if (draft.head === draft.base) return 'La rama de origen y la de destino son la misma.';
  if (!ctx.branches.includes(draft.head)) return `No existe la rama «${draft.head}».`;
  if (!ctx.pushed.includes(draft.head)) return `«${draft.head}» todavía no está subida: súbela antes de abrir la ${ctx.word}.`;
  const dup = ctx.open.find((r) => r.head === draft.head && r.base === draft.base && (r.state === 'open' || r.state === 'draft'));
  if (dup) return `Ya hay una ${ctx.word} abierta de «${draft.head}» a «${draft.base}»: #${dup.number}.`;
  return undefined;
}
