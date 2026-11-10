// Comprueba el flujo de ramas de un PR (SPEC-094): a develop desde cualquier rama, a main solo desde develop.
// Lo ejecuta el workflow `flujo-de-ramas` con las ramas en variables de entorno.
import { pathToFileURL } from 'node:url';

/**
 * @param {{ base: string, head: string, sameRepo: boolean }} pr
 * @returns {string | null} el motivo del rechazo, o null si el PR se acepta
 */
export function branchFlowProblem({ base, head, sameRepo }) {
  if (base === 'develop') return null;
  if (base === 'main') {
    if (head === 'develop' && sameRepo) return null;
    return `A main solo se llega desde develop de este repositorio (este PR viene de «${head}»${sameRepo ? '' : ' de un fork'}). Abre el PR contra develop.`;
  }
  return `Los PR van a develop (este apunta a «${base}»).`;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { PR_BASE = '', PR_HEAD = '', PR_BASE_REPO = '', PR_HEAD_REPO = '' } = process.env;
  const problem = branchFlowProblem({ base: PR_BASE, head: PR_HEAD, sameRepo: PR_BASE_REPO !== '' && PR_BASE_REPO === PR_HEAD_REPO });
  if (problem) {
    console.log(`::error::${problem}`);
    process.exit(1);
  }
  console.log(`✓ ${PR_HEAD} → ${PR_BASE} permitido`);
}
