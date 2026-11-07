import { readFileSync, readdirSync, statSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, join, posix, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(fileURLToPath(new URL('../../..', import.meta.url)));

export interface Layer {
  name: string;
  src: string;
  manifest?: string;
  allowed: string[];
  pure?: boolean;
  react?: boolean;
  typesOnly?: string[];
}

export interface Architecture {
  layers: Layer[];
  contexts: { root: string; rules: Record<string, string[]>; typesOnly: string[] };
  forbiddenInPure: string[];
}

export const architecture = JSON.parse(readFileSync(join(ROOT, 'scripts/architecture.json'), 'utf8')) as Architecture;

export interface ImportRef {
  /** Ruta relativa a la raíz del repositorio, con «/». */
  file: string;
  spec: string;
  typeOnly: boolean;
}

export function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(name) && !name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

const STATIC = /^\s*(import|export)\s+(type\s+)?(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]/gm;
const DYNAMIC = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;

/** Imports de un texto, estáticos, `export … from` y dinámicos. */
export function importsOf(file: string, text: string): ImportRef[] {
  const out: ImportRef[] = [];
  for (const m of text.matchAll(STATIC)) out.push({ file, spec: m[3]!, typeOnly: m[2] !== undefined });
  for (const m of text.matchAll(DYNAMIC)) out.push({ file, spec: m[1]!, typeOnly: false });
  return out;
}

export function layerImports(layer: Layer): ImportRef[] {
  return sourceFiles(join(ROOT, layer.src)).flatMap((f) => importsOf(relative(ROOT, f).replace(/\\/g, '/'), readFileSync(f, 'utf8')));
}

const isNodeModule = (spec: string): boolean => spec.startsWith('node:') || builtinModules.includes(spec.split('/')[0]!);
const matches = (spec: string, pattern: string): boolean => (pattern.endsWith('/*') ? spec.startsWith(pattern.slice(0, -1)) : spec === pattern);
const ownPackage = (spec: string): string | undefined => /^@orquestador\/([a-z]+)/.exec(spec)?.[1];

/** Incumplimientos de R56.1 y R56.2 en una capa. */
export function layerViolations(layer: Layer, imports: readonly ImportRef[], forbiddenInPure: readonly string[]): string[] {
  const out: string[] = [];
  for (const { file, spec, typeOnly } of imports) {
    const pkg = ownPackage(spec);
    if (pkg !== undefined) {
      if (!layer.allowed.includes(pkg)) out.push(`${file} importa ${spec}: «${layer.name}» solo puede importar de ${layer.allowed.join(', ') || 'ningún paquete'} [R56.1]`);
      else if (layer.typesOnly?.includes(pkg) && !typeOnly) out.push(`${file} importa valores de ${spec}: «${layer.name}» solo puede importar sus tipos [R56.1]`);
    }
    if (layer.pure && (isNodeModule(spec) || forbiddenInPure.some((p) => matches(spec, p)))) out.push(`${file} importa ${spec}: «${layer.name}» no puede usar Node, Electron ni el SDK [R56.2]`);
    if (layer.pure && !layer.react && (spec === 'react' || spec.startsWith('react/') || spec === 'react-dom')) out.push(`${file} importa ${spec}: solo «ui» importa React [R56.2]`);
  }
  return out;
}

/** Comprueba que el `package.json` declara lo que permite la matriz y lo que se usa de verdad [R56.1]. */
export function manifestViolations(layer: Layer, manifest: { dependencies?: Record<string, string> }, imports: readonly ImportRef[]): string[] {
  const declared = Object.keys(manifest.dependencies ?? {}).map(ownPackage).filter((p): p is string => p !== undefined);
  const out: string[] = [];
  for (const d of declared) if (!layer.allowed.includes(d)) out.push(`${layer.manifest} declara @orquestador/${d}: «${layer.name}» no puede depender de él [R56.1]`);
  for (const { spec, file } of imports) {
    const pkg = ownPackage(spec);
    if (pkg !== undefined && !declared.includes(pkg)) out.push(`${file} importa ${spec} sin declararlo en ${layer.manifest} [R56.1]`);
  }
  return [...new Set(out)];
}

/** Incumplimientos de R56.9 para un archivo de un contexto (o de la carpeta raíz de contextos). */
export function contextViolations(contexts: Architecture['contexts'] | ContextRules, ref: ImportRef): string[] {
  if (!ref.spec.startsWith('.')) return [];
  const rel = ref.file.slice(contexts.root.length + 1);
  const from = rel.includes('/') ? rel.split('/')[0]! : undefined;
  const target = posix.normalize(posix.join(posix.dirname(rel), ref.spec));
  const to = target.includes('/') ? target.split('/')[0]! : target;
  if (from === undefined || from === to) return [];
  const out: string[] = [];
  if (!contexts.rules[from]?.includes(to)) out.push(`${ref.file} importa ${ref.spec}: «${from}» solo puede importar de ${contexts.rules[from]?.join(', ') || 'ningún contexto'} [R56.9]`);
  if (target !== to && target !== `${to}/index`) out.push(`${ref.file} importa ${ref.spec}: desde fuera de «${to}» solo se usa su index [R56.9]`);
  if (contexts.typesOnly.includes(from) && !ref.typeOnly) out.push(`${ref.file} importa valores: «${from}» solo importa tipos [R56.9]`);
  return out;
}

export type ContextRules = Pick<Architecture['contexts'], 'root' | 'rules' | 'typesOnly'>;

/** Carpetas de contexto bajo `root`. */
export const contextFolders = (root: string): string[] => readdirSync(join(ROOT, root)).filter((n) => statSync(join(ROOT, root, n)).isDirectory());

export function lineCount(file: string): number {
  return readFileSync(file, 'utf8').split('\n').length - 1;
}

/** Archivos que superan `max` líneas y no están en `exceptions`. */
export function oversized(dirs: readonly string[], max: number, exceptions: Record<string, string>): string[] {
  const out: string[] = [];
  for (const dir of dirs) {
    for (const f of sourceFiles(join(ROOT, dir))) {
      const rel = relative(ROOT, f).replace(/\\/g, '/');
      const n = lineCount(f);
      if (n > max && !exceptions[rel]) out.push(`${rel}: ${n} líneas (máximo ${max})`);
    }
  }
  return out;
}

export const dirOf = dirname;
