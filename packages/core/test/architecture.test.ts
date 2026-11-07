import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT, architecture, contextFolders, contextViolations, importsOf, layerImports, layerViolations, manifestViolations, oversized, type Layer } from './architecture';
import { coreIndex, exportedNames } from './exports';

const layer = (name: string): Layer => architecture.layers.find((l) => l.name === name)!;
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

describe('SPEC-056 · límites entre paquetes', () => {
  it('[R56.1] cada paquete solo importa lo que permite la matriz', () => {
    const problems = architecture.layers.flatMap((l) => layerViolations({ ...l, pure: false }, layerImports(l), []));
    expect(problems).toEqual([]);
  });

  it('[R56.1] un import prohibido se detecta y el mensaje dice el archivo y la regla', () => {
    const refs = importsOf('packages/runtime/src/x.ts', "import { ProjectStore } from '@orquestador/store';");
    expect(layerViolations(layer('runtime'), refs, [])).toEqual(['packages/runtime/src/x.ts importa @orquestador/store: «runtime» solo puede importar de core [R56.1]']);
  });

  it('[R56.1] también ve imports de tipos, reexportaciones e imports dinámicos', () => {
    const text = ["import type { A } from '@orquestador/claude';", "export * from '@orquestador/store';", "const w = await import('@orquestador/workspace');"].join('\n');
    expect(layerViolations(layer('runtime'), importsOf('x.ts', text), [])).toHaveLength(3);
  });

  it('[R56.1] el preload solo toma tipos del núcleo', () => {
    const preload = layer('desktop-preload');
    expect(layerViolations(preload, importsOf('p.ts', "import type { RunEvent } from '@orquestador/core';"), [])).toEqual([]);
    expect(layerViolations(preload, importsOf('p.ts', "import { validateDiagram } from '@orquestador/core';"), [])).toHaveLength(1);
  });

  it('[R56.1] los package.json coinciden con la matriz', () => {
    const problems = architecture.layers.filter((l) => l.manifest).flatMap((l) => manifestViolations(l, JSON.parse(read(l.manifest!)) as { dependencies?: Record<string, string> }, layerImports(l)));
    expect(problems).toEqual([]);
    expect(manifestViolations(layer('runtime'), { dependencies: { '@orquestador/core': '*', '@orquestador/store': '*' } }, [])).toHaveLength(1);
    expect(manifestViolations(layer('runtime'), { dependencies: {} }, importsOf('r.ts', "import '@orquestador/core';"))).toHaveLength(1);
  });

  it('[R56.2] core, editor y ui no usan Node, Electron ni el SDK; solo ui usa React', () => {
    const problems = architecture.layers.filter((l) => l.pure).flatMap((l) => layerViolations(l, layerImports(l), architecture.forbiddenInPure));
    expect(problems).toEqual([]);
    for (const spec of ['node:fs', 'fs', 'path', 'child_process', 'electron', '@anthropic-ai/claude-agent-sdk']) {
      expect(layerViolations(layer('core'), importsOf('c.ts', `import x from '${spec}';`), architecture.forbiddenInPure), spec).toHaveLength(1);
    }
    expect(layerViolations(layer('editor'), importsOf('e.ts', "import { useState } from 'react';"), [])).toHaveLength(1);
    expect(layerViolations(layer('ui'), importsOf('u.tsx', "import { useState } from 'react';"), [])).toEqual([]);
  });

  it('[R56.4] runtime solo depende de core', () => {
    const manifest = JSON.parse(read('packages/runtime/package.json')) as { dependencies: Record<string, string> };
    expect(Object.keys(manifest.dependencies)).toEqual(['@orquestador/core']);
    expect(layerImports(layer('runtime')).filter((i) => i.spec.startsWith('@orquestador/') && i.spec !== '@orquestador/core')).toEqual([]);
  });

  it('[R56.5] solo composition.ts crea los adaptadores concretos', () => {
    const creators = layerImports(layer('desktop-main')).map((i) => i.file);
    for (const file of new Set(creators)) {
      const text = read(file);
      const creates = /new\s+Claude(Adapter|Decider)\b|ProjectStore\.(create|open)\(/.test(text);
      expect(creates, file).toBe(file.endsWith('/composition.ts'));
    }
  });

  it('[R56.7] ESLint replica la matriz y `npm run check` pasa este test', async () => {
    const config = read('eslint.config.js');
    expect(config).toContain('scripts/architecture.json');
    expect(config).toContain('no-restricted-imports');
    const scripts = (JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts;
    expect(scripts.check).toContain('npm run test');
  });
});

describe('SPEC-056 · contextos de core', () => {
  const { contexts } = architecture;
  const coreRefs = () => layerImports(layer('core'));

  it('[R56.8] core/src se organiza en los contextos, cada uno con su index', () => {
    expect(contextFolders(contexts.root).sort()).toEqual(['diagrams', 'execution', 'knowledge', 'ports', 'settings', 'shared', 'testing']);
    for (const c of contextFolders(contexts.root)) expect(read(`${contexts.root}/${c}/index.ts`).length, c).toBeGreaterThan(0);
  });

  it('[R56.9] cada contexto solo importa lo permitido y entra por el index', () => {
    expect(coreRefs().flatMap((r) => contextViolations(contexts, r))).toEqual([]);
  });

  it('[R56.9] las infracciones se detectan', () => {
    const file = (f: string) => `${contexts.root}/${f}`;
    const check = (f: string, spec: string, typeOnly = false) => contextViolations(contexts, { file: file(f), spec, typeOnly });
    expect(check('shared/x.ts', '../diagrams')).toHaveLength(1);
    expect(check('diagrams/x.ts', '../settings')).toHaveLength(1);
    expect(check('knowledge/x.ts', '../diagrams')).toHaveLength(1);
    expect(check('execution/x.ts', '../diagrams/graph')).toHaveLength(1);
    expect(check('ports/x.ts', '../execution')).toHaveLength(1);
    expect(check('ports/x.ts', '../execution', true)).toEqual([]);
    expect(check('execution/nodes/x.ts', '../deliverable')).toEqual([]);
    expect(check('execution/x.ts', '../shared')).toEqual([]);
  });

  it('[R56.10] @orquestador/core exporta exactamente los mismos nombres', { timeout: 60_000 }, () => {
    const recorded = JSON.parse(read('packages/core/test/fixtures/core-exports.json')) as string[];
    expect(exportedNames(coreIndex)).toEqual(recorded);
  });

  it('[R56.11] docs/06-contextos.md describe cada contexto', () => {
    const doc = read('docs/06-contextos.md');
    for (const c of contextFolders(contexts.root)) expect(doc, c).toContain(`\`${c}/\``);
    for (const word of ['paso', 'pasada', 'intento', 'entregable', 'enchufado', 'revisión', 'corrección']) expect(doc.toLowerCase(), word).toContain(word);
  });
});

/** Excepciones al presupuesto de tamaño, con su motivo [R56.17]. */
const LOGIC_EXCEPTIONS: Record<string, string> = {
  'packages/editor/src/i18n.ts': 'catálogo de textos; partirlo por contexto queda fuera de SPEC-056',
  'packages/editor/src/speckit-data.ts': 'generado por scripts/build-speckit.mjs',
};

describe('SPEC-056 · presupuesto de tamaño', () => {
  it('[R56.17] ningún archivo de la lógica pasa de 500 líneas', () => {
    const dirs = ['core', 'runtime', 'editor', 'store', 'claude', 'workspace'].map((p) => `packages/${p}/src`);
    expect(oversized(dirs, 500, LOGIC_EXCEPTIONS)).toEqual([]);
  });
});
