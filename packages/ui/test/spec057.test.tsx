// @vitest-environment jsdom
import './setup';
import { describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { newAgent, newContext, type AgentDefinition } from '@orquestador/core';
import { createDiagram, type ApiResult, type DraftResult } from '@orquestador/editor';
import { App } from '../src/App';
import { goLib } from './nav';
import { createMemoryApi, type MemoryApiOptions } from '../src/memoryApi';

/** Monta la app con un proyecto; `claude` pone el motor Claude para que el asistente pueda redactar. */
async function mount(options: MemoryApiOptions = {}, claude = false) {
  const api = createMemoryApi([createDiagram('principal', 'Principal')], options);
  if (claude) {
    const cur = await api.getSettings();
    if (!cur.ok) throw new Error('sin ajustes');
    const { apiKeyStored: _k, ...settings } = cur.value;
    void _k;
    await api.saveSettings({ ...settings, engine: 'claude' });
  }
  render(<App api={api} confirm={() => true} />);
  await userEvent.click(screen.getByRole('button', { name: 'Crear proyecto' }));
  return api;
}
const SKILL = { id: 'pixel', name: 'Pixel art', description: 'Sprites', body: 'x' };
const openNew = async () => {
  const s = await goLib('agents');
  await userEvent.click(s.getByRole('button', { name: 'Nuevo agente' }));
  return s;
};
const steps = (s: ReturnType<typeof within>) => within(s.getByRole('list', { name: 'Pasos para crear el agente' }));
const current = (s: ReturnType<typeof within>) => steps(s).getAllByRole('button').find((b) => b.getAttribute('aria-current') === 'step')?.textContent;
const value = (el: HTMLElement) => (el as HTMLInputElement).value;

describe('SPEC-057 · crear un agente por pasos', () => {
  it('[R57.1] «Nuevo agente» empieza con la bienvenida: describirlo, seis ideas y los caminos a mano', async () => {
    await mount();
    const s = await openNew();
    const w = within(s.getByRole('region', { name: '¿Qué agente necesitas?' }));
    expect(w.getByLabelText('Describe el agente')).toBeTruthy();
    expect(w.getByRole('button', { name: /Empezar con el asistente/ })).toBeTruthy();
    for (const idea of ['Implementador', 'Revisor de código', 'Pruebas', 'Diseñador web', 'Documentador', 'Investigador']) expect(w.getByRole('button', { name: new RegExp(`^${idea}`) })).toBeTruthy();
    const manual = within(w.getByRole('group', { name: 'O hazlo a mano' }));
    expect(manual.getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Escribir', 'Instalar', 'Añadir Spec Kit']);
    // la bienvenida no abre el chat: «Escribir» lleva a los pasos en blanco
    await userEvent.click(manual.getByRole('button', { name: 'Escribir' }));
    expect(current(s)).toContain('Qué hace');
    expect(value(s.getByLabelText('Nombre'))).toBe('');
  });

  it('[R57.2] con Claude, el asistente redacta el agente y sus skills y contextos salen como sugeridos', async () => {
    let resolve: (r: ApiResult<DraftResult>) => void = () => undefined;
    const api = await mount(
      {
        skills: [SKILL],
        contexts: [{ ...newContext('guia', 'Guía de estilo'), value: 'x' }],
        draft: () => new Promise((r) => (resolve = r)),
      },
      true,
    );
    const s = await openNew();
    await userEvent.type(s.getByLabelText('Describe el agente'), 'Revisa cada PR y señala riesgos');
    await userEvent.click(s.getByRole('button', { name: /Empezar con el asistente/ }));
    expect(value(s.getByLabelText('Para qué sirve'))).toBe('Revisa cada PR y señala riesgos');
    expect((await s.findByRole('status')).textContent).toContain('preparando el agente');
    resolve({ ok: true, value: { fields: { name: 'Revisor seguro', description: 'Señala riesgos de seguridad', instructions: '# Pasos\nLee el diff', model: 'claude-opus-5-5', skillIds: ['pixel', 'no-existe'], contextIds: ['guia'] }, problems: [], ms: 80 } });
    await waitFor(() => expect(value(s.getByLabelText('Nombre'))).toBe('Revisor seguro'));
    expect(value(s.getByLabelText('Para qué sirve'))).toBe('Señala riesgos de seguridad');
    expect(value(s.getByLabelText('Instrucciones'))).toContain('Lee el diff');
    expect(s.queryByText(/preparando el agente/)).toBeNull();
    await userEvent.click(s.getByRole('button', { name: 'Siguiente' }));
    expect(s.getByText('Sugerido por el asistente: Pixel art, Guía de estilo. Quita lo que no necesites.')).toBeTruthy();
    // nada se guarda hasta «Crear agente»
    expect(api.agents.size).toBe(0);
    await userEvent.click(steps(s).getByRole('button', { name: 'Revisar' }));
    await userEvent.click(s.getByRole('button', { name: 'Crear agente' }));
    await waitFor(() => expect(api.agents.get('revisor-seguro')).toMatchObject({ model: 'claude-opus-5-5', skillIds: ['pixel'], contextIds: ['guia'] }));
  });

  it('[R57.2] lo que el usuario escribe mientras el asistente trabaja no se pisa', async () => {
    let resolve: (r: ApiResult<DraftResult>) => void = () => undefined;
    await mount({ draft: () => new Promise((r) => (resolve = r)) }, true);
    const s = await openNew();
    await userEvent.click(s.getByRole('button', { name: /^Investigador/ }));
    await userEvent.type(s.getByLabelText('Nombre'), 'Mío');
    resolve({ ok: true, value: { fields: { name: 'Investigador', instructions: 'Busca fuentes' }, problems: [], ms: 5 } });
    await waitFor(() => expect(value(s.getByLabelText('Instrucciones'))).toBe('Busca fuentes'));
    expect(value(s.getByLabelText('Nombre'))).toBe('Mío');
  });

  it('[R57.2] si el asistente falla lo dice y deja seguir a mano', async () => {
    await mount({ draft: () => ({ ok: false, error: { code: 'unavailable', message: 'Sin sesión' } }) }, true);
    const s = await openNew();
    await userEvent.click(s.getByRole('button', { name: /^Pruebas/ }));
    expect((await s.findByRole('alert')).textContent).toContain('no ha podido prepararlo');
    expect(value(s.getByLabelText('Para qué sirve'))).toMatch(/tests/i);
    await userEvent.type(s.getByLabelText('Nombre'), 'Tester');
    await userEvent.click(s.getByRole('button', { name: 'Siguiente' }));
    expect(current(s)).toContain('Qué sabe');
  });

  it('[R57.2] sin Claude, elegir una idea solo rellena «Para qué sirve» y no llama al asistente', async () => {
    let calls = 0;
    await mount({ draft: () => (calls++, { ok: true, value: { fields: { name: 'X' }, problems: [], ms: 1 } }) });
    const s = await openNew();
    await userEvent.click(s.getByRole('button', { name: /^Documentador/ }));
    expect(value(s.getByLabelText('Para qué sirve'))).not.toBe('');
    expect(value(s.getByLabelText('Nombre'))).toBe('');
    expect(s.queryByRole('status')).toBeNull();
    expect(calls).toBe(0);
  });

  it('[R57.3] cuatro pasos numerados: el actual marcado, los hechos con ✓, «Paso n de 4» y hace falta un nombre para seguir', async () => {
    await mount({ skills: [SKILL] });
    const s = await openNew();
    await userEvent.click(s.getByRole('button', { name: 'Escribir' }));
    expect(steps(s).getAllByRole('button').map((b) => b.textContent)).toEqual(['1Qué hace', '2Qué sabe', '3Qué puede hacer', '4Revisar']);
    expect(s.getByText('Paso 1 de 4')).toBeTruthy();
    expect(s.queryByRole('button', { name: 'Atrás' })).toBeNull();
    // sin nombre no se avanza, ni con «Siguiente» ni pulsando un paso
    await userEvent.click(s.getByRole('button', { name: 'Siguiente' }));
    expect(current(s)).toContain('Qué hace');
    expect(s.getByText('Ponle un nombre para seguir.')).toBeTruthy();
    await userEvent.click(steps(s).getByRole('button', { name: 'Revisar' }));
    expect(current(s)).toContain('Qué hace');
    await userEvent.type(s.getByLabelText('Nombre'), 'Pintor');
    await userEvent.type(s.getByLabelText('Para qué sirve'), 'Dibuja');
    // la vista previa sigue lo escrito
    const side = within(s.getByRole('complementary', { name: 'Cómo quedará' }));
    expect(side.getByText('Pintor')).toBeTruthy();
    expect(side.getByText('Dibuja')).toBeTruthy();
    expect(side.getByText('0 skills · 0 contextos · 0 MCP')).toBeTruthy();
    await userEvent.click(s.getByRole('button', { name: 'Siguiente' }));
    expect(current(s)).toContain('Qué sabe');
    expect(steps(s).getAllByRole('button')[0]!.textContent).toBe('✓Qué hace');
    expect(s.getByText('Paso 2 de 4')).toBeTruthy();
    expect(s.getByRole('button', { name: 'Añadir skills…' })).toBeTruthy();
    expect(s.queryByLabelText('Nombre')).toBeNull();
    await userEvent.click(s.getByRole('button', { name: 'Siguiente' }));
    expect(s.getByRole('group', { name: 'Qué puede hacer sin preguntarte' })).toBeTruthy();
    expect(s.getByLabelText('Modelo')).toBeTruthy();
    await userEvent.click(s.getByRole('button', { name: 'Atrás' }));
    expect(current(s)).toContain('Qué sabe');
  });

  it('[R57.4] «Revisar» resume cada parte con «Cambiar» y «Crear agente» lo guarda', async () => {
    const api = await mount();
    const s = await openNew();
    await userEvent.click(s.getByRole('button', { name: 'Escribir' }));
    await userEvent.type(s.getByLabelText('Nombre'), 'Pintor');
    await userEvent.type(s.getByLabelText('Instrucciones'), 'Uno\nDos');
    await userEvent.click(steps(s).getByRole('button', { name: 'Revisar' }));
    const review = within(s.getByRole('list', { name: 'Revisar' }));
    const rows = review.getAllByRole('listitem').map((li) => li.querySelector('strong')?.textContent);
    expect(rows).toEqual(['Qué hace', 'Qué sabe', 'Qué puede hacer', 'Modelo']);
    expect(review.getByText(/Pintor · Falta descripción · 2 líneas de instrucciones/)).toBeTruthy();
    expect(review.getByText('Nada asignado')).toBeTruthy();
    await userEvent.click(review.getByRole('button', { name: 'Cambiar Qué sabe' }));
    expect(current(s)).toContain('Qué sabe');
    await userEvent.click(steps(s).getByRole('button', { name: 'Revisar' }));
    await userEvent.click(s.getByRole('button', { name: 'Crear agente' }));
    await waitFor(() => expect(api.agents.get('pintor')).toMatchObject({ name: 'Pintor', instructions: 'Uno\nDos' }));
  });

  it('[R57.4] un error al guardar lleva al paso del campo que falla', async () => {
    const api = await mount();
    api.saveAgent = async () => ({ ok: false, error: { code: 'invalid', message: 'No válido', fields: [{ field: 'model', message: 'Elige un modelo de la lista' }] } });
    const s = await openNew();
    await userEvent.click(s.getByRole('button', { name: 'Escribir' }));
    await userEvent.type(s.getByLabelText('Nombre'), 'Pintor');
    await userEvent.click(steps(s).getByRole('button', { name: 'Revisar' }));
    await userEvent.click(s.getByRole('button', { name: 'Crear agente' }));
    await waitFor(() => expect(current(s)).toContain('Qué puede hacer'));
    expect(s.getByText('Elige un modelo de la lista')).toBeTruthy();
  });
});

describe('SPEC-057 · ficha por secciones de un agente guardado', () => {
  const pintor = (patch: Partial<AgentDefinition> = {}): AgentDefinition => ({ ...newAgent('pintor', 'Pintor'), description: 'Dibuja', skillIds: ['pixel'], permissions: 'readonly', ...patch });

  it('[R57.5] índice con cinco secciones y su resumen; se ve una cada vez y la activa lleva aria-current', async () => {
    await mount({ agents: [pintor()], skills: [SKILL] });
    const s = await goLib('agents');
    await userEvent.click(s.getByRole('button', { name: 'Pintor' }));
    // un agente guardado no va por pasos
    expect(s.queryByRole('list', { name: 'Pasos para crear el agente' })).toBeNull();
    const nav = within(s.getByRole('navigation', { name: 'Secciones del agente' }));
    const items = nav.getAllByRole('button');
    expect(items.map((b) => b.querySelector('strong')?.textContent)).toEqual(['Qué hace', 'Qué sabe', 'Qué puede hacer', 'Modelo y aspecto', 'Dónde se usa']);
    expect(items.map((b) => b.querySelector('small')?.textContent)).toEqual(['Dibuja', '1 skills · 0 contextos · 0 MCP', 'Solo lectura', 'Sonnet 5.5', 'En 0 diagramas']);
    expect(items[0]!.getAttribute('aria-current')).toBe('page');
    expect(s.getByLabelText('Nombre')).toBeTruthy();
    await userEvent.click(items[4]!);
    expect(items[4]!.getAttribute('aria-current')).toBe('page');
    expect(items[0]!.getAttribute('aria-current')).toBeNull();
    expect(s.queryByLabelText('Nombre')).toBeNull();
    expect(s.getByText('Aún no está en ningún diagrama')).toBeTruthy();
  });

  it('[R57.5] los cambios de varias secciones se guardan juntos y el resumen se actualiza', async () => {
    const api = await mount({ agents: [pintor()], skills: [SKILL] });
    const s = await goLib('agents');
    await userEvent.click(s.getByRole('button', { name: 'Pintor' }));
    const nav = within(s.getByRole('navigation', { name: 'Secciones del agente' }));
    await userEvent.clear(s.getByLabelText('Para qué sirve'));
    await userEvent.type(s.getByLabelText('Para qué sirve'), 'Pinta fondos');
    await userEvent.click(nav.getByRole('button', { name: /^Modelo y aspecto/ }));
    await userEvent.selectOptions(s.getByLabelText('Modelo'), 'claude-opus-5-5');
    expect(nav.getByRole('button', { name: /^Qué hace/ }).textContent).toContain('Pinta fondos');
    await userEvent.click(s.getAllByRole('button', { name: 'Guardar' }).find((b) => b.getAttribute('type') === 'submit')!);
    await waitFor(() => expect(api.agents.get('pintor')).toMatchObject({ description: 'Pinta fondos', model: 'claude-opus-5-5', skillIds: ['pixel'] }));
  });
});
