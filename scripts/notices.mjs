// Genera THIRD_PARTY_NOTICES.txt: cada paquete de producción con su licencia, más lo que va copiado dentro [R91.10].
// Uso: node scripts/notices.mjs [salida]   (por defecto release/THIRD_PARTY_NOTICES.txt)
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

/** Dependencias de producción de la raíz, de cada paquete y de la app (sin las nuestras). */
export function productionRoots(dir = root) {
  const manifests = [join(dir, 'package.json'), join(dir, 'apps', 'desktop', 'package.json')];
  const packages = join(dir, 'packages');
  if (existsSync(packages)) for (const p of readdirSync(packages)) if (existsSync(join(packages, p, 'package.json'))) manifests.push(join(packages, p, 'package.json'));
  const names = new Set();
  for (const m of manifests) for (const name of Object.keys(readJson(m).dependencies ?? {})) if (!name.startsWith('@orquestador/')) names.add(name);
  return [...names].sort();
}

/** Busca `node_modules/<name>` desde `from` hacia arriba, como Node. */
function locate(name, from) {
  for (let dir = from; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return candidate;
    if (dirname(dir) === dir) return undefined;
  }
}

const LICENSE_FILE = /^(licen[cs]e|copying|notice)(\.(md|txt|markdown))?$/i;

function licenseText(dir) {
  const files = readdirSync(dir).filter((f) => LICENSE_FILE.test(f)).sort();
  return files.map((f) => readFileSync(join(dir, f), 'utf8').trim()).join('\n\n');
}

const licenseName = (pkg) => (typeof pkg.license === 'string' ? pkg.license : pkg.license?.type ?? (Array.isArray(pkg.licenses) ? pkg.licenses.map((l) => l.type).join(' OR ') : 'desconocida'));

/** Paquetes instalados alcanzables desde `names`, con sus dependencias (también opcionales y *peer* presentes). */
export function collect(names, from = root) {
  const seen = new Map();
  const queue = names.map((name) => ({ name, from }));
  while (queue.length > 0) {
    const { name, from: at } = queue.shift();
    const dir = locate(name, at);
    if (!dir) continue;
    const pkg = readJson(join(dir, 'package.json'));
    const key = `${pkg.name}@${pkg.version}`;
    if (seen.has(key)) continue;
    seen.set(key, { name: pkg.name, version: pkg.version, license: licenseName(pkg), text: licenseText(dir) });
    for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies, ...pkg.peerDependencies })) queue.push({ name: dep, from: dir });
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

/** Lo que va copiado en el código y no es un paquete. */
export function vendored(dir = root) {
  const specKit = join(dir, 'vendor', 'spec-kit', 'LICENSE');
  return existsSync(specKit) ? [{ name: 'GitHub Spec Kit (plantillas y órdenes)', version: 'vendor/spec-kit', license: 'MIT', text: readFileSync(specKit, 'utf8').trim() }] : [];
}

export function render(entries, version) {
  const rule = '='.repeat(78);
  const head = [
    `Orquestador ${version} — avisos de terceros`,
    '',
    'El código del Orquestador se distribuye con la licencia MIT (ver LICENSE).',
    'Cada componente de abajo conserva su propia licencia. El SDK de Claude Agent y su binario',
    'son de Anthropic PBC y se usan con sus condiciones (ver su texto).',
    '',
  ];
  const body = entries.flatMap((e) => [rule, `${e.name} ${e.version} — ${e.license}`, rule, e.text || '(El paquete no incluye el texto de su licencia.)', '']);
  return [...head, ...body].join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = join(root, process.argv[2] ?? join('release', 'THIRD_PARTY_NOTICES.txt'));
  const version = readJson(join(root, 'apps', 'desktop', 'package.json')).version;
  const entries = [...collect(productionRoots()), ...vendored()];
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, render(entries, version));
  const unknown = entries.filter((e) => !e.text).map((e) => e.name);
  console.log(`Avisos de ${entries.length} componentes en ${out}${unknown.length ? ` (sin texto de licencia: ${unknown.join(', ')})` : ''}`);
}
