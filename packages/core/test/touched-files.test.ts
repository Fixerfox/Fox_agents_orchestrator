import { describe, expect, it } from 'vitest';
import type { AgentAdapter, AgentStreamEvent } from '../src';
import { explainTouchedFiles } from '../src';
import { chain, nodeFinished, ofType, setup } from './helpers';

describe('SPEC-031 · todo lo que toca un agente llega a su salida', () => {
  it('[R31.13] si el texto ya menciona cada archivo no se añade nada', () => {
    const files = new Map([['src/app.ts', 'modified' as const]]);
    expect(explainTouchedFiles('Cambios realizados:\n- src/app.ts: nuevo menú', files)).toBe('Cambios realizados:\n- src/app.ts: nuevo menú');
  });

  it('[R31.13] añade solo los archivos que faltan, con si se crearon o modificaron, y acepta rutas con barra invertida', () => {
    const files = new Map<string, 'created' | 'modified' | undefined>([
      ['src/app.ts', 'modified'],
      ['src/nuevo.ts', 'created'],
      ['notas.md', undefined],
    ]);
    const text = explainTouchedFiles('He cambiado src\\app.ts.', files);
    expect(text).toBe('He cambiado src\\app.ts.\n\nArchivos tocados (registrados por el orquestador):\n- src/nuevo.ts (creado)\n- notas.md');
  });

  it('[R31.13] sin archivos tocados el texto queda igual, y sin texto solo queda la lista', () => {
    expect(explainTouchedFiles('Listo.', new Map())).toBe('Listo.');
    expect(explainTouchedFiles('', new Map([['a.txt', 'created' as const]]))).toBe('Archivos tocados (registrados por el orquestador):\n- a.txt (creado)');
  });

  it('[R31.12] con cualquier adaptador, los archivos de eventos `file` van a la salida aunque el agente no los nombre, sin repetir y creado gana a modificado', async () => {
    const events: AgentStreamEvent[] = [
      { type: 'file', path: 'mapa.json', change: 'created' },
      { type: 'file', path: 'mapa.json', change: 'modified' },
      { type: 'file', path: 'README.md', change: 'modified' },
      { type: 'result', text: 'Hecho.' },
    ];
    const adapter: AgentAdapter = {
      async *run() {
        for (const e of events) yield e;
      },
    };
    const { orch } = setup({ adapter });
    const res = await orch.start(chain(['a']), 'x').result;
    expect(nodeFinished(res.events, 'a')?.output).toEqual({
      text: 'Hecho.\n\nArchivos tocados (registrados por el orquestador):\n- mapa.json (creado)\n- README.md (modificado)',
      files: ['mapa.json', 'README.md'],
    });
    expect(ofType(res.events, 'file.produced').map((e) => e.path)).toEqual(['mapa.json', 'mapa.json', 'README.md']);
  });
});
