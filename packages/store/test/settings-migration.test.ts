import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SETTINGS_SCHEMA_VERSION, defaultSettings } from '@orquestador/core';
import { SettingsStore } from '../src';
import { tmp } from './helpers';
import { rm } from 'node:fs/promises';

let dir: string | undefined;
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

const v1 = (extra: Record<string, unknown>) => ({ schemaVersion: 1, authMode: 'claude-code', engine: 'claude', defaultModel: defaultSettings().defaultModel, maxParallel: 4, ...extra });

describe('SPEC-051 · sin preguntas por defecto', () => {
  it('[R51.1] unos ajustes de la versión 1 pasan a «Sin preguntar nunca», sea cual sea su nivel, y se guardan en la 2', async () => {
    expect(SETTINGS_SCHEMA_VERSION).toBe(2);
    for (const extra of [{ permissions: 'auto' }, { permissions: 'ask' }, {}, { askCommands: true }, { autoWrite: true }]) {
      dir = await tmp('orq-set-');
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, 'settings.json'), JSON.stringify(v1(extra)));
      const store = new SettingsStore(dir);
      const s = await store.load();
      expect(s.permissions, JSON.stringify(extra)).toBe('full');
      expect(s.engine).toBe('claude');
      const disk = JSON.parse(await readFile(path.join(dir, 'settings.json'), 'utf8'));
      expect(disk.schemaVersion).toBe(2);
      expect(disk).not.toHaveProperty('askCommands');
      expect(disk).not.toHaveProperty('autoWrite');
      await rm(dir, { recursive: true, force: true });
    }
    dir = undefined;
  });

  it('[R51.1] desde la versión 2 se respeta lo elegido', async () => {
    dir = await tmp('orq-set-');
    const store = new SettingsStore(dir);
    await store.save({ ...defaultSettings(), permissions: 'ask' });
    expect((await store.load()).permissions).toBe('ask');
    expect((await new SettingsStore(path.join(dir, 'nada')).load()).permissions).toBeUndefined();
  });
});
