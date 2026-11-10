// @vitest-environment jsdom
import './setup';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import type { TestBridgeApi, TestCall, TestReply } from '@orquestador/editor';
import { App } from '../src/App';
import { createMemoryApi } from '../src/memoryApi';
import { runTestCall, type TestBridgeHost } from '../src/shell/TestBridge';
import { click, press, snapshot, type as typeInto, waitFor as waitText } from '../src/shell/uiDriver';

function Form() {
  const [name, setName] = useState('');
  const [mode, setMode] = useState('ai');
  const [saved, setSaved] = useState('');
  return (
    <div>
      <h2>Ajustes</h2>
      <label>
        Nombre
        <input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => setSaved(name)} onKeyDown={(e) => e.key === 'Enter' && setSaved(`enter:${name}`)} />
      </label>
      <label>
        Modo
        <select value={mode} onChange={(e) => setMode(e.target.value)}>
          <option value="ai">Con IA</option>
          <option value="rules">Por reglas</option>
        </select>
      </label>
      <button type="button" onClick={() => setSaved(`guardado:${name}:${mode}`)}>
        Guardar cambios
      </button>
      <button type="button" disabled>
        Borrar
      </button>
      <button type="button" aria-label="Cerrar panel">
        ×
      </button>
      <button type="button" hidden>
        Oculto
      </button>
      <input type="checkbox" aria-label="Activo" defaultChecked />
      <div role="dialog" aria-label="Ejecutar">
        <button type="button">Ejecutar</button>
      </div>
      <output data-testid="saved">{saved}</output>
    </div>
  );
}

describe('SPEC-082 · manejar la interfaz', () => {
  it('[R82.8] ui_snapshot enseña títulos y elementos con rol, nombre, estado y diálogo; lo oculto no', () => {
    render(<Form />);
    const text = snapshot();
    expect(text).toContain('heading «Ajustes» (nivel 2)');
    expect(text).toContain('textbox «Nombre»');
    expect(text).toContain('combobox «Modo» (valor «ai»)');
    expect(text).toContain('button «Borrar» (desactivado)');
    expect(text).toContain('button «Cerrar panel»');
    expect(text).toContain('checkbox «Activo» (marcado)');
    expect(text).toContain('[Ejecutar] button «Ejecutar»');
    expect(text).not.toContain('Oculto');
  });

  it('[R82.8] ui_click: exacto, luego «contiene», con rol e índice; desactivado o ausente da error con parecidos', () => {
    render(<Form />);
    let out = '';
    act(() => void (out = click('guardar')));
    expect(out).toBe('Pulsado button «Guardar cambios».');
    expect(screen.getByTestId('saved').textContent).toBe('guardado::ai');
    expect(click('Ejecutar', { role: 'button' })).toContain('Ejecutar');
    expect(() => click('Borrar')).toThrow('«Borrar» está desactivado.');
    expect(() => click('Guardr cambios')).toThrow(/No encuentro el elemento «Guardr cambios»\. Parecidos: button «Guardar cambios»/);
    expect(() => click('Guardar', { index: 3 })).toThrow('No encuentro');
  });

  it('[R82.8] ui_type cambia el valor para React y guarda al perder el foco o con Intro; en un selector elige la opción', () => {
    render(<Form />);
    act(() => void typeInto('Nombre', 'Ana'));
    expect(screen.getByTestId('saved').textContent).toBe('Ana');
    act(() => void typeInto('Nombre', 'Eva', true));
    expect(screen.getByTestId('saved').textContent).toBe('enter:Eva');
    act(() => void typeInto('Modo', 'Por reglas'));
    act(() => void click('Guardar cambios'));
    expect(screen.getByTestId('saved').textContent).toBe('guardado:Eva:rules');
    expect(() => typeInto('Modo', 'Otro')).toThrow('Opciones: Con IA, Por reglas');
    expect(() => typeInto('Guardar cambios', 'x')).toThrow('No encuentro');
  });

  it('[R82.8] ui_press pulsa en el elemento con foco; ui_wait espera a que aparezca o desaparezca', async () => {
    render(<Form />);
    screen.getByLabelText('Nombre').focus();
    const keys: string[] = [];
    screen.getByLabelText('Nombre').addEventListener('keydown', (e) => keys.push(e.key));
    expect(press('Escape')).toContain('Escape');
    expect(keys).toEqual(['Escape']);
    const sleep = vi.fn(async () => undefined);
    expect(await waitText('Ajustes', { sleep })).toBe('«Ajustes» está en pantalla.');
    await expect(waitText('No está', { timeoutMs: 300, sleep })).rejects.toThrow('«No está» no apareció en 300 ms.');
    expect(await waitText('No está', { gone: true, sleep })).toBe('«No está» ya no está.');
  });
});

const fakeHost = (over: Partial<TestBridgeHost> = {}): TestBridgeHost => ({ api: createMemoryApi(), assistantHost: undefined, state: () => ({ screen: 'start' }), onOpened: vi.fn(), ...over });
const call = (tool: string, args: Record<string, unknown> = {}): TestCall => ({ id: '1', tool, args });

describe('SPEC-082 · el puente en la interfaz', () => {
  it('[R82.7] sin proyecto, las acciones de la app piden abrir uno; las herramientas desconocidas fallan', async () => {
    await expect(runTestCall(fakeHost(), call('app:list_agents'))).rejects.toThrow('Abre un proyecto primero (open_project).');
    await expect(runTestCall(fakeHost(), call('ui_volar'))).rejects.toThrow('desconocida');
  });

  it('[R82.9][R82.10] app_state devuelve el estado; open_project crea o abre y avisa a la app', async () => {
    const onOpened = vi.fn();
    expect(await runTestCall(fakeHost(), call('app_state'))).toEqual({ screen: 'start' });
    expect(await runTestCall(fakeHost({ onOpened }), call('open_project', { create: true }))).toEqual({ opened: 'Proyecto de prueba' });
    expect(onOpened).toHaveBeenCalledWith('Proyecto de prueba');
  });

  it('[R82.7][R82.9][R82.10] E82.b: montado en la app, abre el proyecto, ve el estado y usa las acciones de la app sin «Permitir»', async () => {
    let listener: ((c: TestCall) => void) | undefined;
    const replies: TestReply[] = [];
    const bridge: TestBridgeApi = { onCall: (l) => ((listener = l), () => (listener = undefined)), reply: (r) => void replies.push(r), ready: vi.fn() };
    const api = createMemoryApi();
    render(<App api={api} confirm={() => true} test={bridge} />);
    expect(bridge.ready).toHaveBeenCalled();
    const ask = async (tool: string, args: Record<string, unknown> = {}) => {
      const id = `c${replies.length}-${tool}`;
      await act(async () => listener!({ id, tool, args }));
      await waitFor(() => expect(replies.find((r) => r.id === id)).toBeDefined());
      return replies.find((r) => r.id === id)!;
    };
    expect((await ask('app_state')).result).toMatchObject({ screen: 'start', project: null });
    expect(await ask('open_project', { create: true })).toMatchObject({ ok: true, result: { opened: 'Proyecto de prueba' } });
    await waitFor(async () => expect(((await ask('app_state')).result as { screen: string }).screen).not.toBe('start'));
    const created = await ask('app:create_agent', { name: 'Escritor', description: 'Escribe', instructions: 'Escribe bien' });
    expect(created.ok).toBe(true);
    expect((await ask('app:list_agents')).result).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Escritor' })]));
    expect((await ask('ui_snapshot')).result).toContain('button');
  });
});
