import { fileURLToPath } from 'node:url';
import ts from 'typescript';

/** Nombres públicos de un módulo, valores y tipos, según el compilador. */
export function exportedNames(entry: string): string[] {
  const program = ts.createProgram([entry], { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, noEmit: true, skipLibCheck: true, noResolve: false, types: [] });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(entry);
  const symbol = source && checker.getSymbolAtLocation(source);
  if (!symbol) throw new Error(`No se pudo leer ${entry}`);
  return checker.getExportsOfModule(symbol).map((s) => s.name).sort();
}

export const coreIndex = fileURLToPath(new URL('../src/index.ts', import.meta.url));
