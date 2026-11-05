// @vitest-environment jsdom
import './setup';
import { describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { newAgent, type AgentDefinition } from '@orquestador/core';
import { createDiagram } from '@orquestador/editor';
import { App } from '../src/App';
import { goLib } from './nav';
import { createMemoryApi, type MemoryApiOptions } from '../src/memoryApi';

async function mount(options: MemoryApiOptions = {}) {
  const api = createMemoryApi([createDiagram('principal', 'Principal')], options);
  render(<App api={api} confirm={() => true} />);
  await userEvent.click(screen.getByRole('button', { name: 'Crear proyecto' }));
  return api;
}
const agent = (id: string, name: string, patch: Partial<AgentDefinition> = {}): AgentDefinition => ({ ...newAgent(id, name), ...patch });
const openAgents = async () => goLib('agents');
const marks = (el: ReturnType<typeof within>) => el.queryAllByRole('img', { name: 'Cambios sin guardar' });
const value = (el: HTMLElement | null) => (el as HTMLInputElement | HTMLTextAreaElement).value;

describe('SPEC-022 · borradores, editor Markdown y archivos de contexto', () => {
  it('[R22.11] lo escrito sin guardar sobrevive al cambiar de pestaña y se marca como pendiente', async () => {
    const api = await mount();
    const s = await openAgents();
    await userEvent.click(s.getByRole('button', { name: 'Nuevo agente' }));
    await userEvent.type(s.getByLabelText('Nombre'), 'Pintor a medias');
    await userEvent.type(s.getByLabelText('Instrucciones'), 'Texto largo');
    await goLib('contexts');
    await goLib('agents');
    expect(marks(s).length).toBeGreaterThan(0);
    expect(value(s.getByLabelText('Nombre'))).toBe('Pintor a medias');
    expect(value(s.getByLabelText('Instrucciones'))).toBe('Texto largo');
    expect(api.agents.size).toBe(0);
  });

  it('[R22.11] cada elemento conserva su borrador al saltar de uno a otro y se limpia al guardar', async () => {
    const api = await mount({ agents: [agent('a', 'Alfa'), agent('b', 'Beta')] });
    const s = await openAgents();
    await userEvent.click(s.getByRole('button', { name: /^Alfa/ }));
    await userEvent.type(s.getByLabelText('Para qué sirve'), 'cambiada');
    await userEvent.click(s.getByRole('button', { name: /^Beta/ }));
    expect(value(s.getByLabelText('Para qué sirve'))).toBe('');
    await userEvent.click(s.getByRole('button', { name: /^Alfa/ }));
    expect(value(s.getByLabelText('Para qué sirve'))).toBe('cambiada');
    await userEvent.click(s.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(api.agents.get('a')?.description).toBe('cambiada'));
    await waitFor(() => expect(marks(s)).toHaveLength(0));
  });

  it('[R22.11] volver al valor original quita la marca de pendiente', async () => {
    await mount({ agents: [agent('a', 'Alfa')] });
    const s = await openAgents();
    await userEvent.click(s.getByRole('button', { name: /^Alfa/ }));
    await userEvent.type(s.getByLabelText('Para qué sirve'), 'x');
    expect(marks(s).length).toBeGreaterThan(0);
    await userEvent.type(s.getByLabelText('Para qué sirve'), '{Backspace}');
    await waitFor(() => expect(marks(s)).toHaveLength(0));
  });

  it('[R22.12] el campo de instrucciones es alto, se amplía y cuenta caracteres', async () => {
    await mount();
    const s = await openAgents();
    await userEvent.click(s.getByRole('button', { name: 'Nuevo agente' }));
    const box = s.getByLabelText('Instrucciones');
    expect(box.className).toContain('orq-md');
    expect(box.className).not.toContain('orq-md--big');
    await userEvent.click(s.getByRole('button', { name: 'Ampliar' }));
    expect(box.className).toContain('orq-md--big');
    expect(s.getByRole('button', { name: 'Reducir' })).toBeTruthy();
    await userEvent.type(box, 'hola');
    expect(s.getByText(/^4 de 20\.000 caracteres/)).toBeTruthy();
  });

  it('[R22.13] carga un .md: si el campo está vacío lo rellena y si ya hay texto pregunta', async () => {
    await mount();
    const s = await openAgents();
    await userEvent.click(s.getByRole('button', { name: 'Nuevo agente' }));
    const input = s.getByLabelText('Archivo Markdown para Instrucciones');
    await userEvent.upload(input, new File(['# Uno'], 'uno.md', { type: 'text/markdown' }));
    await waitFor(() => expect(value(s.getByLabelText('Instrucciones'))).toBe('# Uno'));
    expect(s.getByText(/Cargado «uno\.md»/)).toBeTruthy();
    await userEvent.upload(input, new File(['# Dos'], 'dos.md', { type: 'text/markdown' }));
    await userEvent.click(within(await s.findByRole('alertdialog')).getByRole('button', { name: 'Añadir al final' }));
    expect(value(s.getByLabelText('Instrucciones'))).toBe('# Uno\n\n# Dos');
    await userEvent.upload(input, new File(['# Tres'], 'tres.md'));
    await userEvent.click(within(await s.findByRole('alertdialog')).getByRole('button', { name: 'Reemplazar' }));
    expect(value(s.getByLabelText('Instrucciones'))).toBe('# Tres');
  });

  it('[R22.13] cancelar la pregunta no cambia el texto; un archivo enorme o binario se rechaza', async () => {
    await mount();
    const s = await openAgents();
    await userEvent.click(s.getByRole('button', { name: 'Nuevo agente' }));
    await userEvent.type(s.getByLabelText('Instrucciones'), 'mío');
    const input = s.getByLabelText('Archivo Markdown para Instrucciones');
    await userEvent.upload(input, new File(['otro'], 'otro.md'));
    await userEvent.click(within(await s.findByRole('alertdialog')).getByRole('button', { name: 'Cancelar' }));
    expect(value(s.getByLabelText('Instrucciones'))).toBe('mío');
    await userEvent.upload(input, new File(['x'.repeat(200_001)], 'grande.md'));
    expect(await s.findByText(/supera los 200 KB/)).toBeTruthy();
    await userEvent.upload(input, new File(['a\u0000b'], 'bin.md'));
    expect(await s.findByText(/No se pudo leer el archivo como texto/)).toBeTruthy();
    expect(value(s.getByLabelText('Instrucciones'))).toBe('mío');
  });

  it('[R22.13] la skill y el contexto de texto también cargan .md', async () => {
    await mount();
    const s = await openAgents();
    await goLib('skills');
    await userEvent.click(s.getByRole('button', { name: 'Nueva skill' }));
    await userEvent.click(s.getByRole('button', { name: 'Escribir' }));
    await userEvent.upload(s.getByLabelText('Archivo Markdown para Pasos'), new File(['# Pasos'], 'p.md'));
    await waitFor(() => expect(value(s.getByLabelText('Pasos'))).toBe('# Pasos'));
    await goLib('contexts');
    await userEvent.click(s.getByRole('button', { name: 'Nuevo contexto' }));
    await userEvent.click(s.getByRole('button', { name: 'Escribir' }));
    await userEvent.upload(s.getByLabelText('Archivo Markdown para Texto'), new File(['# Datos'], 'd.md'));
    await waitFor(() => expect(value(s.getByLabelText('Texto'))).toBe('# Datos'));
  });

  it('[R22.14] un contexto de archivo se elige con el diálogo del sistema, sin escribir rutas', async () => {
    const api = await mount({ contextPick: { value: '.orquestador/context-files/codigo/archivos', files: 3, bytes: 4200, renamed: 1, scripts: ['a.sh'] } });
    const s = await openAgents();
    await goLib('contexts');
    await userEvent.click(s.getByRole('button', { name: 'Nuevo contexto' }));
    await userEvent.click(s.getByRole('button', { name: 'Escribir' }));
    await userEvent.type(s.getByLabelText('Nombre'), 'Código');
    await userEvent.selectOptions(s.getByLabelText('Tipo'), 'file');
    await userEvent.click(s.getByRole('button', { name: 'Elegir carpeta…' }));
    await waitFor(() => expect(value(s.getByLabelText('Ruta dentro del proyecto'))).toBe('.orquestador/context-files/codigo/archivos'));
    expect(s.getByText(/Añadido: 3 archivos \(4 KB\)/)).toBeTruthy();
    expect(s.getByText(/1 con nombre repetido/)).toBeTruthy();
    expect(s.getByText(/1 son scripts/)).toBeTruthy();
    await userEvent.click(s.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(api.contexts.get('codigo')).toMatchObject({ kind: 'file', value: '.orquestador/context-files/codigo/archivos' }));
  });

  it('[R22.14] cancelar el diálogo no cambia nada', async () => {
    await mount({ contextPick: 'cancel' });
    const s = await openAgents();
    await goLib('contexts');
    await userEvent.click(s.getByRole('button', { name: 'Nuevo contexto' }));
    await userEvent.click(s.getByRole('button', { name: 'Escribir' }));
    await userEvent.selectOptions(s.getByLabelText('Tipo'), 'file');
    await userEvent.click(s.getByRole('button', { name: 'Elegir archivos…' }));
    expect(value(s.getByLabelText('Ruta dentro del proyecto'))).toBe('');
  });
});

describe('SPEC-026 · redactar con Claude en la interfaz', () => {
  const ask = async (s: ReturnType<typeof within>, label: string, text: string) => {
    await userEvent.type(s.getByLabelText(label), text);
    await userEvent.click(s.getByRole('button', { name: 'Proponer' }));
  };

  it('[R26.1][R26.2][R32.5] propone un agente como borrador desde el campo y no guarda nada hasta pulsar Guardar', async () => {
    const api = await mount();
    const s = await openAgents();
    await userEvent.click(s.getByRole('button', { name: 'Nuevo agente' }));
    expect(s.queryByRole('button', { name: 'Redactar con Claude' })).toBeNull();
    await userEvent.click(s.getByRole('button', { name: 'Escribir con Claude' }));
    await ask(s, 'Describe el agente que quieres', 'Revisa contratos');
    expect(await s.findByRole('region', { name: 'Propuesta de Claude' })).toBeTruthy();
    expect(api.agents.size).toBe(0);
    await userEvent.click(s.getByRole('button', { name: 'Aceptar cambios' }));
    expect(value(s.getByLabelText('Nombre'))).toBe('Revisor');
    expect(value(s.getByLabelText('Instrucciones'))).toContain('Revisa contratos');
    expect(s.getByText(/Propuesta aplicada/)).toBeTruthy();
    expect(api.agents.size).toBe(0);
    await userEvent.click(s.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(api.agents.get('revisor')).toBeTruthy());
  });

  it('[R26.3][R32.5][R32.7] con texto se llama «Mejorar» y muestra las líneas cambiadas dentro del campo', async () => {
    await mount({ agents: [agent('a', 'Alfa', { instructions: 'Antiguo' })] });
    const s = await openAgents();
    await userEvent.click(s.getByRole('button', { name: /^Alfa/ }));
    await userEvent.click(s.getByRole('button', { name: 'Mejorar' }));
    await ask(s, '¿Qué quieres cambiar?', 'más estricto');
    const region = within(await s.findByRole('region', { name: 'Propuesta de Claude' }));
    const del = document.querySelector('.orq-aidiff__line.is-del');
    expect(del?.textContent).toBe('Quitado: Antiguo');
    expect(document.querySelectorAll('.orq-aidiff__line.is-add').length).toBeGreaterThan(0);
    expect(region.getByText(/«más estricto» · 1 líneas quitadas/)).toBeTruthy();
    // mientras se revisa la propuesta, el campo muestra las diferencias en lugar del texto
    expect(s.queryByLabelText('Instrucciones')).toBeNull();
  });

  it('[R26.2] se puede pedir otra versión y descartar la propuesta', async () => {
    let n = 0;
    await mount({ draft: () => ({ ok: true, value: { fields: { name: `Versión ${++n}` }, problems: [], ms: 5 } }) });
    const s = await openAgents();
    await goLib('skills');
    await userEvent.click(s.getByRole('button', { name: 'Nueva skill' }));
    await userEvent.click(s.getByRole('button', { name: 'Escribir' }));
    await userEvent.click(s.getByRole('button', { name: 'Escribir con Claude' }));
    await ask(s, 'Describe la skill que quieres', 'Resumir');
    expect(await s.findByText('Versión 1')).toBeTruthy();
    await userEvent.click(s.getByRole('button', { name: 'Otra versión' }));
    expect(await s.findByText('Versión 2')).toBeTruthy();
    await userEvent.click(s.getByRole('button', { name: 'Descartar' }));
    expect(s.queryByRole('region', { name: 'Propuesta de Claude' })).toBeNull();
    expect(value(s.getByLabelText('Nombre'))).toBe('');
  });

  it('[R26.5] si falla, el error se explica y el formulario conserva lo escrito', async () => {
    await mount({ draft: () => ({ ok: false, error: { code: 'unavailable', message: 'Claude no tiene una sesión válida.' } }) });
    const s = await openAgents();
    await userEvent.click(s.getByRole('button', { name: 'Nuevo agente' }));
    await userEvent.type(s.getByLabelText('Nombre'), 'Mío');
    await userEvent.click(s.getByRole('button', { name: 'Escribir con Claude' }));
    await ask(s, '¿Qué quieres cambiar?', 'algo');
    expect((await s.findAllByRole('alert')).some((a) => a.textContent?.includes('sesión válida'))).toBe(true);
    expect(value(s.getByLabelText('Nombre'))).toBe('Mío');
  });

  it('[R26.6] los problemas de la propuesta se señalan campo a campo', async () => {
    await mount({ draft: { fields: { name: 'X'.repeat(80) }, problems: [{ field: 'name', message: 'El nombre admite hasta 60 caracteres' }], ms: 7 } });
    const s = await openAgents();
    await userEvent.click(s.getByRole('button', { name: 'Nuevo agente' }));
    await userEvent.click(s.getByRole('button', { name: 'Escribir con Claude' }));
    await ask(s, 'Describe el agente que quieres', 'algo');
    expect(await s.findByText(/Nombre: El nombre admite hasta 60 caracteres/)).toBeTruthy();
  });

  it('[R26.1] un contexto de texto también se redacta con Claude', async () => {
    await mount();
    const s = await openAgents();
    await goLib('contexts');
    await userEvent.click(s.getByRole('button', { name: 'Nuevo contexto' }));
    await userEvent.click(s.getByRole('button', { name: 'Escribir' }));
    await userEvent.click(s.getByRole('button', { name: 'Escribir con Claude' }));
    await ask(s, 'Describe el texto que quieres', 'glosario');
    await userEvent.click(await s.findByRole('button', { name: 'Aceptar cambios' }));
    expect(value(s.getByLabelText('Texto'))).toContain('glosario');
  });
});

describe('SPEC-032 · Claude dentro del campo', () => {
  it('[R32.6] un atajo lanza la petición directamente con su texto y Esc cierra el menú devolviendo el foco', async () => {
    const seen: string[] = [];
    await mount({
      agents: [agent('a', 'Alfa', { instructions: 'Revisa todo' })],
      draft: (req) => (seen.push(req.instruction), { ok: true, value: { fields: { instructions: 'Revisa todo\nResponde APROBADO o RECHAZADO' }, problems: [], ms: 3 } }),
    });
    const s = await openAgents();
    await userEvent.click(s.getByRole('button', { name: /^Alfa/ }));
    const btn = s.getByRole('button', { name: 'Mejorar' });
    await userEvent.click(btn);
    expect(s.getByRole('dialog', { name: 'Pedir a Claude' })).toBeTruthy();
    await userEvent.keyboard('{Escape}');
    expect(s.queryByRole('dialog', { name: 'Pedir a Claude' })).toBeNull();
    expect(document.activeElement).toBe(btn);
    expect(screen.getByTestId('content')).toBeTruthy();
    await userEvent.click(btn);
    await userEvent.click(s.getByRole('button', { name: 'Más estricto' }));
    expect(seen).toEqual(['Más estricto']);
    await s.findByRole('region', { name: 'Propuesta de Claude' });
    expect(document.querySelector('.orq-aidiff__line.is-add')?.textContent).toBe('Añadido: Responde APROBADO o RECHAZADO');
  });

  it('[R32.5] con el campo vacío no hay atajos: solo la línea para describir lo que se quiere', async () => {
    await mount();
    const s = await openAgents();
    await userEvent.click(s.getByRole('button', { name: 'Nuevo agente' }));
    await userEvent.click(s.getByRole('button', { name: 'Escribir con Claude' }));
    expect(s.queryByRole('button', { name: 'Más estricto' })).toBeNull();
    expect(s.getByLabelText('Describe el agente que quieres')).toBeTruthy();
  });

  it('[R32.7] aceptar aplica todos los campos propuestos al borrador y el formulario queda sin guardar', async () => {
    const api = await mount({ agents: [agent('a', 'Alfa', { instructions: 'Viejo' })], draft: { fields: { description: 'Nueva desc', instructions: 'Nuevo' }, problems: [], ms: 1 } });
    const s = await openAgents();
    await userEvent.click(s.getByRole('button', { name: /^Alfa/ }));
    await userEvent.click(s.getByRole('button', { name: 'Mejorar' }));
    await userEvent.type(s.getByLabelText('¿Qué quieres cambiar?'), 'x{Enter}');
    expect(await s.findByText('Otros campos')).toBeTruthy();
    await userEvent.click(s.getByRole('button', { name: 'Aceptar cambios' }));
    expect(value(s.getByLabelText('Instrucciones'))).toBe('Nuevo');
    expect(value(s.getByLabelText('Para qué sirve'))).toBe('Nueva desc');
    expect(api.agents.get('a')?.instructions).toBe('Viejo');
    expect(marks(s).length).toBeGreaterThan(0);
  });
});
