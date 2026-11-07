import { ESLint } from 'eslint';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from './architecture';

const eslint = new ESLint({ cwd: ROOT });
const flagged = async (file: string, code: string) => {
  const [result] = await eslint.lintText(code, { filePath: join(ROOT, file) });
  return result!.messages.filter((m) => m.ruleId === 'no-restricted-imports').map((m) => m.message);
};

describe('SPEC-056 · el editor avisa al escribir', () => {
  it('[R56.7] marca un import prohibido por la matriz', { timeout: 60_000 }, async () => {
    const [message] = await flagged('packages/runtime/src/x.ts', "export { ProjectStore } from '@orquestador/store';\n");
    expect(message).toContain('runtime');
  });

  it('[R56.7] marca Node y React donde no se pueden usar, sin confundirlos con archivos propios', { timeout: 60_000 }, async () => {
    expect(await flagged('packages/core/src/execution/x.ts', "export { readFile } from 'node:fs';\n")).toHaveLength(1);
    expect(await flagged('packages/core/src/execution/x.ts', "export { promises } from 'fs';\n")).toHaveLength(1);
    expect(await flagged('packages/editor/src/x.ts', "export { useState } from 'react';\n")).toHaveLength(1);
    expect(await flagged('packages/core/src/execution/x.ts', "export { EventBus } from './events';\n")).toEqual([]);
  });

  it('[R56.7] deja pasar lo permitido', { timeout: 60_000 }, async () => {
    expect(await flagged('packages/runtime/src/x.ts', "export { Orchestrator } from '@orquestador/core';\n")).toEqual([]);
    expect(await flagged('packages/ui/src/x.tsx', "export { useState } from 'react';\n")).toEqual([]);
  });
});
