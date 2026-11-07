import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { es, t } from '../src';

const root = join(__dirname, '..', '..');
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

describe('catálogo de textos [R14.10]', () => {
  it('[R14.10] interpola parámetros y conserva los desconocidos', () => {
    expect(t('node.aria', { kind: 'Agente', name: 'Pintor' })).toBe('Agente «Pintor»');
    expect(t('node.aria.problems', { kind: 'Router', name: 'R', count: 2 })).toBe('Router «R», 2 problemas');
    expect(t('node.aria', { kind: 'X' })).toBe('X «{name}»');
  });

  it('[R14.10] toda clave usada con t(...) en el código existe en el catálogo', () => {
    const files = ['editor', 'ui', 'desktop'].flatMap((p) => {
      try {
        return walk(join(root, p === 'desktop' ? '../apps/desktop' : p));
      } catch {
        return [];
      }
    });
    expect(files.length).toBeGreaterThan(0);
    const missing: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/\bt\(\s*'([a-z][\w.-]*)'/g)) {
        if (!(m[1]! in es)) missing.push(`${f}: ${m[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('[R14.10] cada código de validación del núcleo tiene mensaje en español', () => {
    const src = readFileSync(join(root, 'core', 'src', 'diagrams', 'validation.ts'), 'utf8');
    const codes = [...src.matchAll(/add\(\s*'([a-z-]+)'/g)].map((m) => m[1]!);
    expect(codes.length).toBeGreaterThan(10);
    const missing = codes.filter((c) => !(`problem.${c}` in es));
    expect(missing).toEqual([]);
  });

  it('[R14.10] los mensajes de error del editor existen para cada código', () => {
    const src = readFileSync(join(root, 'editor', 'src', 'errors.ts'), 'utf8');
    const codes = [...src.matchAll(/\|\s*'([a-z-]+)'/g)].map((m) => m[1]!);
    expect(codes).toContain('cycle');
    expect(codes.filter((c) => !(`error.${c}` in es))).toEqual([]);
  });
});
