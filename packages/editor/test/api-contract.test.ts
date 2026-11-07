import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { CHANNELS, ContractError, RUN_EVENTS_CHANNEL, TERMINAL_EVENTS_CHANNEL, parseRequest } from '../src';

const path = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const fixture = <T,>(name: string): T => JSON.parse(readFileSync(path(`./fixtures/${name}`), 'utf8')) as T;
const SLOW = { timeout: 60_000 };

/** Una interfaz por contexto, en el archivo de su contexto [R56.18]. */
const CONTEXTS: Record<string, string> = {
  project: 'ProjectSessionApi',
  diagrams: 'DiagramsApi',
  runs: 'RunsApi',
  knowledge: 'KnowledgeApi',
  settings: 'SettingsApi',
  assistant: 'AssistantApi',
};

function compile(entry: string) {
  const program = ts.createProgram([entry], { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, noEmit: true, skipLibCheck: true, types: [] });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(entry);
  const module = source && checker.getSymbolAtLocation(source);
  if (!module) throw new Error(`No se pudo leer ${entry}`);
  const exports = checker.getExportsOfModule(module);
  const typeOf = (name: string): ts.Type => {
    const found = exports.find((s) => s.name === name);
    if (!found) throw new Error(`${entry} no exporta ${name}`);
    return checker.getDeclaredTypeOfSymbol(found.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(found) : found);
  };
  const methods = (name: string) => checker.getPropertiesOfType(typeOf(name)).map((p) => p.name).sort();
  return { exports: exports.map((s) => s.name).sort(), methods };
}

describe('Contrato de ProjectApi repartido por contexto', () => {
  it('[R56.18] ProjectApi conserva los mismos métodos que la instantánea', SLOW, () => {
    expect(compile(path('../src/index.ts')).methods('ProjectApi')).toEqual(fixture<string[]>('project-api-methods.json'));
  });

  it('[R56.18] @orquestador/editor exporta los mismos nombres', SLOW, () => {
    expect(compile(path('../src/index.ts')).exports).toEqual(fixture<string[]>('editor-exports.json'));
  });

  it('[R56.18] CHANNELS y los canales de eventos no cambian', () => {
    const sorted = Object.fromEntries(Object.entries(CHANNELS).sort(([a], [b]) => (a < b ? -1 : 1)));
    expect(sorted).toEqual(fixture<Record<string, string>>('project-api-channels.json'));
    expect(RUN_EVENTS_CHANNEL).toBe('run:events');
    expect(TERMINAL_EVENTS_CHANNEL).toBe('terminal:events');
  });

  it('[R56.18] cada canal lo analiza algún contexto', () => {
    for (const channel of Object.values(CHANNELS)) {
      let message = '';
      try {
        parseRequest(channel, Symbol('petición imposible'));
      } catch (e) {
        expect(e).toBeInstanceOf(ContractError);
        message = (e as Error).message;
      }
      expect(message, channel).not.toContain('Canal desconocido');
    }
    expect(() => parseRequest('constructor', undefined)).toThrow('Canal desconocido: constructor');
  });

  it('[R56.18] ProjectApi es la unión (&) de una interfaz por contexto', SLOW, () => {
    const contract = path('../src/api/contract.ts');
    const source = ts.createSourceFile(contract, readFileSync(contract, 'utf8'), ts.ScriptTarget.ES2022, true);
    const alias = source.statements.find((s): s is ts.TypeAliasDeclaration => ts.isTypeAliasDeclaration(s) && s.name.text === 'ProjectApi');
    expect(alias && ts.isIntersectionTypeNode(alias.type)).toBe(true);
    const members = (alias!.type as ts.IntersectionTypeNode).types.map((t) => t.getText(source)).sort();
    expect(members).toEqual(Object.values(CONTEXTS).sort());

    const perContext = Object.entries(CONTEXTS).flatMap(([file, name]) => compile(path(`../src/api/${file}.ts`)).methods(name));
    // Sin huecos ni solapes: cada método está en un solo contexto.
    expect(perContext.sort()).toEqual(fixture<string[]>('project-api-methods.json'));
  });
});
