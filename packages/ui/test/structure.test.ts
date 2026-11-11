import { existsSync, readFileSync } from 'node:fs';
import { join, posix, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT, importsOf, lineCount, oversized, sourceFiles, type ImportRef } from '../../core/test/architecture';

const SRC = 'packages/ui/src';
const BUDGET = 600;
const BUDGET_DIRS = [SRC, 'apps/desktop/src'];

/** Quién puede importar de quién [R56.19]. No tiene ciclos: lo compartido entre dos contextos baja a `common`. */
const RULES: Record<string, string[]> = {
  common: [],
  diagrams: ['common'],
  knowledge: ['common'],
  settings: ['common'],
  versions: ['common'],
  runs: ['common', 'diagrams'],
  assistant: ['common', 'runs'],
  shell: ['common', 'diagrams', 'knowledge', 'settings', 'versions', 'runs', 'assistant'],
};
const AREAS = Object.keys(RULES);

/** La API en memoria la reparte R56.18: se queda fuera de los contextos y nadie de ellos la importa. */
const OUTSIDE = ['memory'];
/** Lo único que vive en la raíz de `src`. */
const ROOT_FILES = ['App.tsx', 'index.ts', 'memoryApi.ts'];

/** Archivos que pueden pasar del presupuesto, con su motivo [R56.20]. Hoy no hay ninguno. */
const EXCEPTIONS: Record<string, string> = {};

const APP_MAX_LINES = 60;

/** Incumplimientos de R56.19 en un import de `ui/src`. */
export function uiViolations(ref: ImportRef, rules: Record<string, string[]> = RULES): string[] {
  if (!ref.spec.startsWith('.')) return [];
  const rel = ref.file.slice(SRC.length + 1);
  const from = rel.includes('/') ? rel.split('/')[0]! : undefined;
  const target = posix.normalize(posix.join(posix.dirname(rel), ref.spec));
  const to = target.split('/')[0]!;
  const entry = target === to || target === `${to}/index`;
  const isArea = (x: string | undefined): x is string => x !== undefined && x in rules;
  if (from === to) return entry ? [`${ref.file} importa ${ref.spec}: dentro de «${to}» se importa cada archivo, no su index [R56.19]`] : [];
  const out: string[] = [];
  if (isArea(to)) {
    if (!entry) out.push(`${ref.file} importa ${ref.spec}: desde fuera de «${to}» solo se usa su index [R56.19]`);
    if (from === undefined) return out;
    if (!rules[from]?.includes(to)) out.push(`${ref.file} importa ${ref.spec}: «${from}» solo puede importar de ${rules[from]?.join(', ') || 'ningún contexto'} [R56.19]`);
  } else if (isArea(from)) {
    out.push(`${ref.file} importa ${ref.spec}: «${from}» no depende de la raíz ni de la API en memoria [R56.19]`);
  }
  return out;
}

/** Primer ciclo entre contextos, si lo hay. */
export function cycleIn(rules: Record<string, string[]>): string[] | undefined {
  const done = new Set<string>();
  const visit = (node: string, path: string[]): string[] | undefined => {
    if (path.includes(node)) return [...path.slice(path.indexOf(node)), node];
    if (done.has(node)) return undefined;
    for (const next of rules[node] ?? []) {
      const found = visit(next, [...path, node]);
      if (found) return found;
    }
    done.add(node);
    return undefined;
  };
  for (const node of Object.keys(rules)) {
    const found = visit(node, []);
    if (found) return found;
  }
  return undefined;
}

/** `App.tsx` solo compone: sin estado ni efectos, y solo importa del `shell` [R56.19]. */
export function appViolations(text: string, lines: number): string[] {
  const out: string[] = [];
  if (lines > APP_MAX_LINES) out.push(`App.tsx tiene ${lines} líneas (máximo ${APP_MAX_LINES}) [R56.19]`);
  for (const m of text.matchAll(/\b(useState|useEffect|useLayoutEffect|useMemo|useCallback|useRef|useReducer|useSyncExternalStore)\b/g)) out.push(`App.tsx usa ${m[1]}: la lógica va en un hook del contexto [R56.19]`);
  if (/\bapi\.[a-zA-Z]+\(/.test(text)) out.push('App.tsx llama a la API: la lógica va en un hook del contexto [R56.19]');
  for (const { spec } of importsOf('App.tsx', text)) if (spec !== './shell') out.push(`App.tsx importa ${spec}: solo compone lo que da el shell [R56.19]`);
  return out;
}

const rel = (f: string) => relative(ROOT, f).replace(/\\/g, '/');
const uiFiles = () => sourceFiles(join(ROOT, SRC)).map(rel);
const uiImports = () => uiFiles().flatMap((f) => importsOf(f, readFileSync(join(ROOT, f), 'utf8')));
const ref = (file: string, spec: string): ImportRef => ({ file: `${SRC}/${file}`, spec, typeOnly: false });

describe('SPEC-056 · la interfaz por contextos', () => {
  it('[R56.19] cada contexto y common tienen su carpeta con su index.ts', () => {
    for (const area of AREAS) expect(existsSync(join(ROOT, SRC, area, 'index.ts')), `${area}/index.ts`).toBe(true);
  });

  it('[R56.19] en la raíz de src solo quedan App, el index y la entrada de la API en memoria', () => {
    const atRoot = uiFiles().filter((f) => !f.slice(SRC.length + 1).includes('/')).map((f) => f.slice(SRC.length + 1));
    expect(atRoot.sort()).toEqual([...ROOT_FILES].sort());
  });

  it('[R56.19] ninguna carpeta queda fuera de los contextos conocidos', () => {
    const folders = new Set(uiFiles().map((f) => f.slice(SRC.length + 1)).filter((f) => f.includes('/')).map((f) => f.split('/')[0]!));
    expect([...folders].filter((f) => !AREAS.includes(f) && !OUTSIDE.includes(f))).toEqual([]);
  });

  it('[R56.19] ningún archivo entra en los internos de otro contexto y common no importa de ninguno', () => {
    expect(uiImports().flatMap((r) => uiViolations(r))).toEqual([]);
  });

  it('[R56.19] las reglas entre contextos no tienen ciclos', () => {
    expect(cycleIn(RULES)).toBeUndefined();
  });

  it('[R56.19] App.tsx es corto y no tiene lógica de pantallas', () => {
    const file = join(ROOT, SRC, 'App.tsx');
    expect(appViolations(readFileSync(file, 'utf8'), lineCount(file))).toEqual([]);
  });

  it('[R56.20] ningún archivo de ui ni de apps/desktop pasa de 600 líneas', () => {
    expect(oversized(BUDGET_DIRS, BUDGET, EXCEPTIONS)).toEqual([]);
  });

  it('[R56.20] cada excepción tiene motivo y sigue haciendo falta', () => {
    for (const [file, why] of Object.entries(EXCEPTIONS)) {
      expect(why.trim(), file).not.toBe('');
      expect(lineCount(join(ROOT, file)), file).toBeGreaterThan(BUDGET);
    }
  });
});

describe('SPEC-056 · el comprobador detecta las infracciones', () => {
  it('[R56.19] un import a los internos de otro contexto', () => {
    expect(uiViolations(ref('runs/RunDetail.tsx', '../diagrams/Canvas')).join()).toContain('solo se usa su index');
    expect(uiViolations(ref('App.tsx', './shell/useApp')).join()).toContain('solo se usa su index');
  });

  it('[R56.19] un contexto que importa de quien no debe', () => {
    expect(uiViolations(ref('diagrams/Canvas.tsx', '../runs')).join()).toContain('«diagrams» solo puede importar de common');
    expect(uiViolations(ref('settings/theme.ts', '../shell')).join()).toContain('«settings» solo puede importar');
  });

  it('[R56.19] common no importa de ningún contexto', () => {
    expect(uiViolations(ref('common/Markdown.tsx', '../diagrams')).join()).toContain('«common» solo puede importar de ningún contexto');
  });

  it('[R56.19] un contexto no depende de la raíz ni de la API en memoria', () => {
    expect(uiViolations(ref('runs/RunDetail.tsx', '../memoryApi'))).toHaveLength(1);
    expect(uiViolations(ref('shell/useApp.ts', '../App'))).toHaveLength(1);
  });

  it('[R56.19] dentro de un contexto no se pasa por su propio index', () => {
    expect(uiViolations(ref('runs/RunDetail.tsx', '.')).join()).toContain('se importa cada archivo');
    expect(uiViolations(ref('runs/RunDetail.tsx', './index')).join()).toContain('se importa cada archivo');
  });

  it('[R56.19] lo permitido no se marca', () => {
    for (const r of [ref('runs/RunDetail.tsx', '../diagrams'), ref('runs/RunDetail.tsx', '../common/index'), ref('shell/useApp.ts', '../settings'), ref('runs/RunDetail.tsx', './RunTabs'), ref('App.tsx', './shell'), ref('index.ts', './memoryApi'), ref('memoryApi.ts', './memory'), ref('runs/RunDetail.tsx', 'react')]) {
      expect(uiViolations(r), r.spec).toEqual([]);
    }
  });

  it('[R56.19] un ciclo entre contextos', () => {
    expect(cycleIn({ a: ['b'], b: ['c'], c: ['a'] })).toEqual(['a', 'b', 'c', 'a']);
    expect(cycleIn({ a: ['b'], b: [] })).toBeUndefined();
  });

  it('[R56.19] un App.tsx con lógica o demasiado largo', () => {
    const fat = "import { useState } from 'react';\nimport { Canvas } from './diagrams';\nexport function App({ api }) { const [a] = useState(0); void api.listDiagrams(); return <Canvas />; }\n";
    const found = appViolations(fat, 200).join('\n');
    expect(found).toContain('200 líneas');
    expect(found).toContain('usa useState');
    expect(found).toContain('llama a la API');
    expect(found).toContain('importa ./diagrams');
    expect(found).toContain('importa react');
  });

  it('[R56.20] un archivo que se pasa del presupuesto, salvo que esté en la lista', () => {
    const big = `${SRC}/shell/useApp.ts`;
    expect(oversized([`${SRC}/shell`], 10, {}).join()).toContain(big);
    expect(oversized([`${SRC}/shell`], 10, { [big]: 'motivo' }).join()).not.toContain(big);
  });
});
