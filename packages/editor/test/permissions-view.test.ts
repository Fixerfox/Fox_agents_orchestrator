import { describe, expect, it } from 'vitest';
import { PROJECT_LEVELS, permissionMatrix } from '../src';

const at = (action: string) => permissionMatrix().find((r) => r.action === action)!.answers;

describe('SPEC-067 · lo que pasará con cada nivel (editor)', () => {
  it('[R67.6] los tres niveles van de más prudente a menos y cada acción tiene respuesta en todos', () => {
    expect(PROJECT_LEVELS).toEqual(['ask', 'auto', 'full']);
    for (const r of permissionMatrix()) expect(Object.keys(r.answers).sort()).toEqual(['ask', 'auto', 'full']);
  });

  it('[R67.6] coincide con lo que aplica el motor', () => {
    // Preguntar: solo los comandos sencillos sin preguntar; modificar pregunta; nunca escribe fuera
    expect(at('simple')).toEqual({ ask: 'yes', auto: 'yes', full: 'yes' });
    expect(at('modify')).toEqual({ ask: 'ask', auto: 'yes', full: 'yes' });
    expect(at('commands')).toEqual({ ask: 'ask', auto: 'yes', full: 'yes' });
    // Automático: pregunta borrar, publicar y salir de la carpeta
    for (const a of ['delete', 'publish', 'outsideCmd']) expect(at(a)).toEqual({ ask: 'ask', auto: 'ask', full: 'yes' });
    // Escribir fuera: solo «Sin preguntar nunca»
    expect(at('outsideWrite')).toEqual({ ask: 'no', auto: 'no', full: 'yes' });
    // con «Sin preguntar nunca» no se pregunta nada
    expect(permissionMatrix().every((r) => r.answers.full === 'yes')).toBe(true);
  });
});
