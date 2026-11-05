import { describe, expect, it } from 'vitest';
import { defaultSettings, newAgent } from '@orquestador/core';
import { CHANNELS, parseRequest } from '../src';

describe('SPEC-047 · contrato IPC de los permisos', () => {
  it('[R47.10] guardar un agente acepta su nivel de permisos y rechaza uno desconocido', () => {
    expect(parseRequest(CHANNELS.saveAgent, { ...newAgent('rev', 'Revisor'), permissions: 'readonly' })).toMatchObject({ permissions: 'readonly' });
    expect(() => parseRequest(CHANNELS.saveAgent, { ...newAgent('rev', 'Revisor'), permissions: 'root' })).toThrow();
  });

  it('[R47.4][R47.8] los ajustes aceptan Preguntar, Automático y Sin preguntar nunca, y ya no los campos viejos', () => {
    for (const permissions of ['ask', 'auto', 'full']) expect(parseRequest(CHANNELS.saveSettings, { ...defaultSettings(), permissions })).toMatchObject({ permissions });
    expect(() => parseRequest(CHANNELS.saveSettings, { ...defaultSettings(), permissions: 'readonly' })).toThrow();
    expect(() => parseRequest(CHANNELS.saveSettings, { ...defaultSettings(), autoWrite: true })).toThrow();
    expect(() => parseRequest(CHANNELS.saveSettings, { ...defaultSettings(), askCommands: true })).toThrow();
  });
});
