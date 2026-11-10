// Comprueba la trazabilidad spec → test.
// Cada requisito `**R<spec>.<n>** [M<hito>]` de los hitos en curso debe aparecer como `[R<spec>.<n>]` en algún test.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const milestones = (process.env.SPEC_MILESTONES ?? 'M1,M2,M3,M3b,M4,M4c,M5a,M5b,M6a,M6b,M6c,M6d,M6e,M7a,M7b,M8a,M8b,M8c,M8d,M8e,M8f,M8g,M8h,M9a,M11a,M11b,M11c,M11d,M12,M13,M14,M15a,M15b,M15c,M15d,M15e,M15f,M15g,M15h,M15i,M15j,M16a,M16b,M16c,M16d,M16e,M16f,M16g,M16h,M16i,M17a,M17b,M17c').split(',').map((s) => s.trim());
const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

function walk(dir, filter, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, filter, out);
    else if (filter(full)) out.push(full);
  }
  return out;
}

const requirements = new Map();
for (const file of walk(join(root, 'specs'), (f) => /\d{3}-.*\.md$/.test(f))) {
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(/\*\*(R\d+\.\d+)\*\*\s*\[(M\d+[a-z]?)\]/g)) {
    requirements.set(m[1], { milestone: m[2], file: file.split(/[\\/]/).pop() });
  }
}

const tested = new Set();
for (const file of ['packages', 'apps'].flatMap((d) => walk(join(root, d), (f) => /\.test\.tsx?$/.test(f)))) {
  for (const m of readFileSync(file, 'utf8').matchAll(/\[(R\d+\.\d+)\]/g)) tested.add(m[1]);
}

const enforced = [...requirements].filter(([, r]) => milestones.includes(r.milestone));
const missing = enforced.filter(([id]) => !tested.has(id));
const unknown = [...tested].filter((id) => !requirements.has(id));

console.log(`Specs: ${requirements.size} requisitos · hitos exigidos: ${milestones.join(', ')} (${enforced.length})`);
console.log(`Cubiertos por tests: ${enforced.length - missing.length}/${enforced.length}`);
if (unknown.length) console.log(`⚠ Tests que citan requisitos inexistentes: ${unknown.join(', ')}`);
if (missing.length) {
  console.log('✗ Requisitos sin test:');
  for (const [id, r] of missing) console.log(`  ${id} [${r.milestone}] (${r.file})`);
  process.exit(1);
}
if (unknown.length) process.exit(1);
console.log('✓ Trazabilidad completa');
