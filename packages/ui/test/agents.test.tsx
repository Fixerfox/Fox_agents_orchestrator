// @vitest-environment jsdom
import './setup';
import { describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { newAgent, newContext, type AgentDefinition, type ContextDefinition } from '@orquestador/core';
import { createDiagram } from '@orquestador/editor';
import { App } from '../src/App';
import { goLib, openSettingsPage, settingsSaved, settingsSection } from './nav';
import { createMemoryApi, type MemoryApiOptions } from '../src/memoryApi';

const diagramWith = (agentId: string) => {
  const d = createDiagram('principal', 'Principal');
  d.nodes.splice(1, 0, { id: 'n1', kind: 'agent', agentId, label: 'Pintor', position: { x: 200, y: 100 } });
  return d;
};

async function mount(options: MemoryApiOptions = {}, open = true, diagrams = [createDiagram('principal', 'Principal')]) {
  const api = createMemoryApi(diagrams, options);
  render(<App api={api} confirm={() => true} />);
  if (open) await userEvent.click(screen.getByRole('button', { name: 'Crear proyecto' }));
  return api;
}
const dialog = () => screen.getByRole('dialog');
const agent = (id: string, name: string, patch: Partial<AgentDefinition> = {}): AgentDefinition => ({ ...newAgent(id, name), ...patch });
const ctx = (id: string, name: string, patch: Partial<ContextDefinition> = {}): ContextDefinition => ({ ...newContext(id, name), value: 'x', ...patch });
const openAgents = async () => goLib('agents');

describe('SPEC-022 · pantalla de agentes', () => {
  it('[R22.6] crea un agente: el id sale del nombre y queda guardado en el proyecto', async () => {
    const api = await mount();
    const screenEl = await openAgents();
    await userEvent.click(screenEl.getByRole('button', { name: 'Nuevo agente' }));
    await userEvent.click(screenEl.getByRole('button', { name: 'Escribir' }));
    await userEvent.type(screenEl.getByLabelText('Nombre'), 'Pintor de héroes');
    await userEvent.type(screenEl.getByLabelText('Para qué sirve'), 'Dibuja personajes');
    await userEvent.type(screenEl.getByLabelText('Instrucciones'), 'Usa píxel art');
    await userEvent.click(screenEl.getByRole('button', { name: 'Qué puede hacer' }));
    expect(screenEl.getByText('pintor-de-heroes')).toBeTruthy();
    await userEvent.selectOptions(screenEl.getByLabelText('Modelo'), 'claude-opus-5-5');
    await userEvent.click(screenEl.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(api.agents.get('pintor-de-heroes')).toMatchObject({ name: 'Pintor de héroes', description: 'Dibuja personajes', model: 'claude-opus-5-5', instructions: 'Usa píxel art' }));
    expect(await screenEl.findByRole('status')).toHaveProperty('textContent', 'Guardado');
    expect(screenEl.getByRole('button', { name: 'Pintor de héroes' })).toBeTruthy();
  });

  it('[R22.6] el id es único aunque se repita el nombre', async () => {
    const api = await mount({ agents: [agent('pintor', 'Pintor')] });
    const screenEl = await openAgents();
    await userEvent.click(screenEl.getByRole('button', { name: 'Nuevo agente' }));
    await userEvent.click(screenEl.getByRole('button', { name: 'Escribir' }));
    await userEvent.type(screenEl.getByLabelText('Nombre'), 'Pintor');
    await userEvent.click(screenEl.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect([...api.agents.keys()].sort()).toEqual(['pintor', 'pintor-2']));
  });

  it('[R22.6] los errores salen junto al campo y no se guarda nada', async () => {
    const api = await mount();
    const screenEl = await openAgents();
    await userEvent.click(screenEl.getByRole('button', { name: 'Nuevo agente' }));
    await userEvent.click(screenEl.getByRole('button', { name: 'Escribir' }));
    await userEvent.click(screenEl.getByRole('button', { name: 'Guardar' }));
    const name = screenEl.getByLabelText('Nombre');
    const field = name.closest('.orq-field') as HTMLElement;
    expect(await within(field).findByRole('alert')).toBeTruthy();
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect(api.agents.size).toBe(0);
  });

  it('[R22.6] edita un agente existente y le asigna un contexto', async () => {
    const api = await mount({ agents: [agent('a', 'A')], contexts: [ctx('guia', 'Guía de estilo')] });
    const screenEl = await openAgents();
    await userEvent.click(await screenEl.findByRole('button', { name: 'A' }));
    await userEvent.clear(screenEl.getByLabelText('Nombre'));
    await userEvent.type(screenEl.getByLabelText('Nombre'), 'Agente A');
    await userEvent.click(screenEl.getByRole('button', { name: /^Qué sabe/ }));
    await userEvent.click(screenEl.getByRole('button', { name: 'Añadir contextos…' }));
    await userEvent.click(screenEl.getByRole('button', { name: 'Añadir Guía de estilo' }));
    await userEvent.click(screenEl.getByRole('button', { name: 'Listo' }));
    await userEvent.click(screenEl.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(api.agents.get('a')).toMatchObject({ id: 'a', name: 'Agente A', contextIds: ['guia'] }));
  });

  it('[R22.7] crea contextos de los tres tipos y valida cada uno', async () => {
    const api = await mount();
    const screenEl = await openAgents();
    await goLib('contexts');
    const create = async (name: string, kind: string, value: string) => {
      await userEvent.click(screenEl.getByRole('button', { name: 'Nuevo contexto' }));
    await userEvent.click(screenEl.getByRole('button', { name: 'Escribir' }));
      await userEvent.type(screenEl.getByLabelText('Nombre'), name);
      await userEvent.selectOptions(screenEl.getByLabelText('Tipo'), kind);
      await userEvent.type(screenEl.getByRole('textbox', { name: /^(Texto|Dirección|Ruta)/ }), value);
      await userEvent.click(screenEl.getByRole('button', { name: 'Guardar' }));
    };
    await create('Notas', 'text', 'Hola');
    await create('Web', 'url', 'https://ejemplo.com');
    await create('Guion', 'file', 'docs/guion.md');
    await waitFor(() => expect([...api.contexts.keys()].sort()).toEqual(['guion', 'notas', 'web']));
    expect(api.contexts.get('web')).toMatchObject({ kind: 'url', value: 'https://ejemplo.com' });
    // dirección no válida
    await userEvent.click(screenEl.getByRole('button', { name: 'Nuevo contexto' }));
    await userEvent.click(screenEl.getByRole('button', { name: 'Escribir' }));
    await userEvent.type(screenEl.getByLabelText('Nombre'), 'Mala');
    await userEvent.selectOptions(screenEl.getByLabelText('Tipo'), 'url');
    await userEvent.type(screenEl.getByLabelText(/^Dirección/), 'ftp://x');
    await userEvent.click(screenEl.getByRole('button', { name: 'Guardar' }));
    const field = screenEl.getByLabelText(/^Dirección/).closest('.orq-field') as HTMLElement;
    expect(await within(field).findByRole('alert')).toBeTruthy();
    // ruta fuera del proyecto
    await userEvent.selectOptions(screenEl.getByLabelText('Tipo'), 'file');
    await userEvent.type(screenEl.getByLabelText(/^Ruta/), '../secreto.txt');
    await userEvent.click(screenEl.getByRole('button', { name: 'Guardar' }));
    expect(await within(screenEl.getByLabelText(/^Ruta/).closest('.orq-field') as HTMLElement).findByRole('alert')).toBeTruthy();
    expect(api.contexts.has('mala')).toBe(false);
  });

  it('[R22.8] borrar un agente pide confirmación y dice dónde se usa', async () => {
    const api = await mount({ agents: [agent('pintor', 'Pintor')] }, true, [diagramWith('pintor')]);
    const screenEl = await openAgents();
    await userEvent.click(await screenEl.findByRole('button', { name: 'Pintor' }));
    await userEvent.click(screenEl.getByRole('button', { name: 'Eliminar' }));
    const confirm = await screenEl.findByRole('alertdialog');
    expect(confirm.textContent).toContain('Se usa en: Principal');
    await userEvent.click(within(confirm).getByRole('button', { name: 'Cancelar' }));
    expect(api.agents.has('pintor')).toBe(true);
    await userEvent.click(screenEl.getByRole('button', { name: 'Eliminar' }));
    await userEvent.click(within(await screenEl.findByRole('alertdialog')).getByRole('button', { name: 'Eliminar' }));
    await waitFor(() => expect(api.agents.has('pintor')).toBe(false));
  });

  it('[R22.8] borrar un contexto dice qué agentes lo usan y lo quita de ellos', async () => {
    const api = await mount({ agents: [agent('a', 'Agente A', { contextIds: ['guia'] })], contexts: [ctx('guia', 'Guía')] });
    const screenEl = await openAgents();
    await goLib('contexts');
    await userEvent.click(await screenEl.findByRole('button', { name: 'Guía' }));
    await userEvent.click(screenEl.getByRole('button', { name: 'Eliminar' }));
    const confirm = await screenEl.findByRole('alertdialog');
    expect(confirm.textContent).toContain('Lo usan: Agente A');
    await userEvent.click(within(confirm).getByRole('button', { name: 'Eliminar' }));
    await waitFor(() => expect(api.contexts.has('guia')).toBe(false));
    expect(api.agents.get('a')?.contextIds).toEqual([]);
  });

  it('[R22.9] la galería muestra los agentes del proyecto con descripción y ofrece «Crear agente»', async () => {
    const api = await mount({ agents: [agent('pintor', 'Pintor', { description: 'Dibuja personajes' })] });
    await userEvent.click(screen.getByRole('button', { name: '+ Agente' }));
    const gallery = within(dialog());
    expect(await gallery.findByText('Dibuja personajes')).toBeTruthy();
    await userEvent.click(gallery.getByRole('button', { name: 'Crear agente' }));
    const screenEl = within(await screen.findByTestId('content'));
    await userEvent.click(await screenEl.findByRole('button', { name: 'Escribir' }));
    await userEvent.type(screenEl.getByLabelText('Nombre'), 'Nuevo');
    await userEvent.click(screenEl.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(api.agents.has('nuevo')).toBe(true));
    await userEvent.click(within(screen.getByRole('navigation', { name: 'Secciones' })).getByRole('button', { name: 'Diseñador' }));
    await userEvent.click(screen.getByRole('button', { name: '+ Agente' }));
    expect(await within(dialog()).findByRole('button', { name: /Nuevo/ })).toBeTruthy();
  });

  it('[R22.9] sin proyecto abierto no hay editor ni pantalla de agentes: solo la de inicio, que explica qué hacer', async () => {
    await mount({}, false);
    expect(screen.queryByRole('button', { name: 'Agentes' })).toBeNull();
    expect(screen.queryByRole('button', { name: '+ Agente' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Crear proyecto' })).toBeTruthy();
    expect(screen.getByText(/Un proyecto es una carpeta con tus agentes/)).toBeTruthy();
  });

  it('[R22.9][R21.15] «Tus agentes» muestra el nombre del agente del proyecto y sus usos en el diagrama', async () => {
    await mount({ agents: [agent('pintor', 'Pintor de héroes')] });
    await userEvent.click(screen.getByRole('button', { name: '+ Agente' }));
    await userEvent.click(await within(dialog()).findByRole('button', { name: /Pintor de héroes/ }));
    const panel = within(screen.getByRole('region', { name: 'Tus agentes' }));
    expect(await panel.findByRole('button', { name: 'Añadir «Pintor de héroes» al diagrama' })).toBeTruthy();
    expect(panel.getByText('1 uso')).toBeTruthy();
  });
});

describe('SPEC-023 · ajustes', () => {
  const openSettings = async () => {
    return openSettingsPage();
  };

  it('[R23.5] se abre desde la barra y tiene las secciones Claude, Presupuesto y Apariencia', async () => {
    await mount();
    const s = await openSettings();
    expect(await s.findByRole('heading', { name: 'Claude' })).toBeTruthy();
    const index = within(s.getByRole('navigation', { name: 'Ajustes' }));
    for (const name of [/^Claude/, /^Ejecución y presupuesto/, /^Apariencia/]) expect(index.getByRole('button', { name })).toBeTruthy();
    await userEvent.click(within(screen.getByRole('navigation', { name: 'Secciones' })).getByRole('button', { name: 'Diseñador' }));
    expect(screen.queryByRole('region', { name: 'Ajustes' })).toBeNull();
  });

  it('[R23.5][R32.25] los cambios se guardan solos', async () => {
    const api = await mount();
    const s = await openSettings();
    await s.findByRole('heading', { name: 'Claude' });
    await settingsSection('Ejecución y presupuesto');
    const par = await s.findByLabelText(/Agentes en paralelo/);
    await userEvent.clear(par);
    await userEvent.type(par, '8');
    await settingsSection('Claude');
    await userEvent.selectOptions(s.getByLabelText('Modelo por defecto'), 'claude-haiku-5-5');
    await settingsSaved();
    expect(await s.findByText('Ajustes guardados')).toBeTruthy();
    const saved = await api.getSettings();
    expect(saved.ok && saved.value).toMatchObject({ maxParallel: 8, defaultModel: 'claude-haiku-5-5' });
  });

  it('[R23.5] un valor no válido muestra el error junto al campo y no se guarda', async () => {
    const api = await mount();
    const s = await openSettings();
    await s.findByRole('heading', { name: 'Claude' });
    await settingsSection('Ejecución y presupuesto');
    const par = await s.findByLabelText(/Agentes en paralelo/);
    await userEvent.clear(par);
    await userEvent.type(par, '99');
    await new Promise((r) => setTimeout(r, 450));
    expect(await within(par.closest('.orq-field') as HTMLElement).findByRole('alert')).toBeTruthy();
    const saved = await api.getSettings();
    expect(saved.ok && saved.value.maxParallel).toBe(4);
  });

  it('[R23.3] la clave se guarda sin mostrarse, se puede cambiar y quitar', async () => {
    const api = await mount();
    const s = await openSettings();
    await userEvent.click(await s.findByRole('radio', { name: 'Clave API' }));
    await userEvent.type(s.getByLabelText('Clave API', { selector: 'input[type=password]' }), 'sk-ant-secreta');
    await userEvent.click(s.getByRole('button', { name: 'Guardar clave' }));
    expect(await s.findByText(/Hay una clave guardada/)).toBeTruthy();
    expect(document.body.innerHTML).not.toContain('sk-ant-secreta');
    expect((await api.getSettings()).ok && JSON.stringify(await api.getSettings())).not.toContain('sk-ant-secreta');
    await userEvent.click(s.getByRole('button', { name: 'Quitar clave' }));
    expect(await s.findByText('No hay clave guardada')).toBeTruthy();
  });

  it('[R23.3] una clave con espacios o sin cifrado disponible se explica junto al campo', async () => {
    await mount({ noEncryption: true });
    const s = await openSettings();
    await userEvent.click(await s.findByRole('radio', { name: 'Clave API' }));
    const input = s.getByLabelText('Clave API', { selector: 'input[type=password]' });
    await userEvent.type(input, 'con espacio');
    await userEvent.click(s.getByRole('button', { name: 'Guardar clave' }));
    expect(await s.findByText('La clave no puede llevar espacios')).toBeTruthy();
    await userEvent.clear(input);
    await userEvent.type(input, 'sk-ant-1');
    await userEvent.click(s.getByRole('button', { name: 'Guardar clave' }));
    expect(await s.findByText(/no ofrece almacenamiento cifrado/)).toBeTruthy();
  });

  it('[R23.6][R32.19] el límite de tokens por defecto rellena el presupuesto del diálogo Ejecutar', async () => {
    await mount();
    await userEvent.click(screen.getByRole('button', { name: 'Lanzar…' }));
    expect(((await screen.findByLabelText('Presupuesto (tokens)')) as HTMLInputElement).value).toBe('');
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    const s = await openSettings();
    await s.findByRole('heading', { name: 'Claude' });
    await settingsSection('Ejecución y presupuesto');
    await userEvent.type(await s.findByLabelText(/Límite de tokens por defecto/), '5000');
    await settingsSaved();
    await userEvent.click(within(screen.getByRole('navigation', { name: 'Secciones' })).getByRole('button', { name: 'Diseñador' }));
    await userEvent.click(screen.getByRole('button', { name: 'Lanzar…' }));
    expect(((await screen.findByLabelText('Presupuesto (tokens)')) as HTMLInputElement).value).toBe('5000');
  });

  it('[R23.5] el tema se cambia desde Apariencia', async () => {
    await mount();
    const s = await openSettings();
    await s.findByRole('heading', { name: 'Claude' });
    await settingsSection('Apariencia');
    await userEvent.click(await s.findByRole('radio', { name: 'Oscuro' }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });
});

const enc = new TextEncoder();
const tree = (o: Record<string, string>) => ({ files: Object.entries(o).map(([path, text]) => ({ path, data: enc.encode(text) })) });
const AG = '---\nname: revisor\ndescription: Revisa sprites\ntools: Read, Bash\nskills: pixel-art\n---\nRevisa.\n';
const SK = '---\nname: pixel-art\ndescription: Dibuja sprites\n---\n# Pasos\n';
const PKG = { 'agents/revisor.md': AG, 'skills/pixel-art/SKILL.md': SK, 'skills/pixel-art/run.sh': 'echo', '.mcp.json': '{"mcpServers":{"git":{"command":"npx"}}}', 'docs/x.png': 'x' };
const skill = (id: string, name: string) => ({ id, name, description: 'Cuándo usarla', body: 'Contenido' });
const openSkills = async () => {
  const s = await openAgents();
  await goLib('skills');
  return s;
};

describe('SPEC-024 · skills en la pantalla', () => {
  it('[R24.6] crea una skill: el id sale del nombre y queda guardada', async () => {
    const api = await mount();
    const s = await openSkills();
    await userEvent.click(s.getByRole('button', { name: 'Nueva skill' }));
    await userEvent.click(s.getByRole('button', { name: 'Escribir' }));
    await userEvent.type(s.getByLabelText('Nombre'), 'Pixel art');
    expect(s.getByText('pixel-art')).toBeTruthy();
    await userEvent.type(s.getByLabelText(/^Cuándo usarla/), 'Para dibujar sprites');
    await userEvent.type(s.getByLabelText(/^Pasos/), '# Pasos');
    await userEvent.click(s.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(api.skills.get('pixel-art')).toMatchObject({ name: 'Pixel art', description: 'Para dibujar sprites', body: '# Pasos' }));
    expect(await s.findByRole('status')).toHaveProperty('textContent', 'Guardado');
  });

  it('[R24.6] la descripción es obligatoria y el error sale junto al campo', async () => {
    const api = await mount();
    const s = await openSkills();
    await userEvent.click(s.getByRole('button', { name: 'Nueva skill' }));
    await userEvent.click(s.getByRole('button', { name: 'Escribir' }));
    await userEvent.type(s.getByLabelText('Nombre'), 'Sin descripción');
    await userEvent.click(s.getByRole('button', { name: 'Guardar' }));
    const field = s.getByLabelText(/^Cuándo usarla/).closest('.orq-field') as HTMLElement;
    expect(await within(field).findByRole('alert')).toHaveProperty('textContent', 'Describe cuándo debe usarse la skill');
    expect(api.skills.size).toBe(0);
  });

  it('[R24.6] edita una skill y muestra los archivos que incluye', async () => {
    const api = await mount({ skills: [skill('pixel', 'Pixel')], skillFiles: { pixel: { 'referencias/base.txt': 'base' } } });
    const s = await openSkills();
    await userEvent.click(await s.findByRole('button', { name: 'Pixel' }));
    expect(await s.findByText('referencias/base.txt')).toBeTruthy();
    await userEvent.clear(s.getByLabelText(/^Pasos/));
    await userEvent.type(s.getByLabelText(/^Pasos/), 'Nuevo');
    await userEvent.click(s.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(api.skills.get('pixel')).toMatchObject({ id: 'pixel', body: 'Nuevo' }));
  });

  const openSkill = async (options: MemoryApiOptions, name = 'Pixel') => {
    const api = await mount({ skills: [skill('pixel', 'Pixel')], ...options });
    const s = await openSkills();
    await userEvent.click(await s.findByRole('button', { name }));
    return { api, s };
  };

  it('[R24.9] una skill sin guardar explica que hay que guardarla antes de añadir archivos', async () => {
    const api = await mount();
    const s = await openSkills();
    await userEvent.click(s.getByRole('button', { name: 'Nueva skill' }));
    await userEvent.click(s.getByRole('button', { name: 'Escribir' }));
    expect(s.getByText('Guarda la skill para poder añadir archivos de referencia')).toBeTruthy();
    expect(s.queryByRole('button', { name: 'Añadir archivos' })).toBeNull();
    expect(api.skills.size).toBe(0);
  });

  it('[R24.9] añade archivos y una carpeta bajo referencias/ y los lista', async () => {
    const { s } = await openSkill({ pickedFiles: tree({ 'nota.txt': 'hola', 'guia/uno.md': '# uno' }) });
    expect(await s.findByText('Esta skill no tiene archivos de referencia')).toBeTruthy();
    await userEvent.click(s.getByRole('button', { name: 'Añadir carpeta' }));
    expect(await s.findByText('referencias/nota.txt')).toBeTruthy();
    expect(s.getByText('referencias/guia/uno.md')).toBeTruthy();
    expect(await s.findByText('Archivos añadidos: 2')).toBeTruthy();
  });

  it('[R24.9] un archivo repetido no sobrescribe: se añade con otro nombre y se avisa', async () => {
    const { s } = await openSkill({ skillFiles: { pixel: { 'referencias/a.txt': 'viejo' } }, pickedFiles: tree({ 'a.txt': 'nuevo' }) });
    expect(await s.findByText('referencias/a.txt')).toBeTruthy();
    await userEvent.click(s.getByRole('button', { name: 'Añadir archivos' }));
    expect(await s.findByText('referencias/a-2.txt')).toBeTruthy();
    expect(s.getByText('referencias/a.txt')).toBeTruthy();
    expect(s.getByText(/Cambiaron de nombre para no sobrescribir otros: 1/)).toBeTruthy();
  });

  it('[R24.9] cancelar el diálogo no cambia nada', async () => {
    const { s } = await openSkill({});
    await userEvent.click(await s.findByRole('button', { name: 'Añadir archivos' }));
    expect(await s.findByText('Esta skill no tiene archivos de referencia')).toBeTruthy();
    expect(s.queryByText(/Archivos añadidos/)).toBeNull();
  });

  it('[R24.10] si no caben, muestra el motivo junto a la lista y no copia nada', async () => {
    const big = { files: [{ path: 'enorme.bin', data: new Uint8Array(2 * 1024 * 1024 + 1) }] };
    const { s } = await openSkill({ pickedFiles: big });
    await userEvent.click(await s.findByRole('button', { name: 'Añadir archivos' }));
    expect((await s.findByRole('alert')).textContent).toMatch(/enorme\.bin|2 MB|grande/i);
    expect(s.getByText('Esta skill no tiene archivos de referencia')).toBeTruthy();
  });

  it('[R24.11] quitar pide confirmación y se puede cancelar', async () => {
    const { s } = await openSkill({ skillFiles: { pixel: { 'referencias/a.txt': 'x' } } });
    await userEvent.click(await s.findByRole('button', { name: 'Quitar referencias/a.txt' }));
    const ask = await s.findByRole('alertdialog', { name: '¿Quitar referencias/a.txt?' });
    await userEvent.click(within(ask).getByRole('button', { name: 'Cancelar' }));
    expect(s.getByText('referencias/a.txt')).toBeTruthy();
    await userEvent.click(s.getByRole('button', { name: 'Quitar referencias/a.txt' }));
    await userEvent.click(within(await s.findByRole('alertdialog')).getByRole('button', { name: 'Sí, quitar' }));
    await waitFor(() => expect(s.queryByText('referencias/a.txt')).toBeNull());
    expect(s.getByText('Esta skill no tiene archivos de referencia')).toBeTruthy();
  });

  it('[R24.11] copiar la ruta confirma con un aviso que la muestra', async () => {
    const { s } = await openSkill({ skillFiles: { pixel: { 'referencias/a.txt': 'x' } } });
    await userEvent.click(await s.findByRole('button', { name: 'Copiar la ruta de referencias/a.txt' }));
    expect(await s.findByText('Ruta copiada: referencias/a.txt')).toBeTruthy();
  });

  it('[R24.12] ve un archivo de texto, avisa si está recortado y explica que un binario no se puede mostrar', async () => {
    const { s } = await openSkill({
      skillFiles: { pixel: { 'referencias/a.txt': 'contenido útil', 'referencias/grande.txt': 'x'.repeat(200_001), 'referencias/b.bin': '\u0000\u0001' } },
    });
    await userEvent.click(await s.findByRole('button', { name: 'Ver referencias/a.txt' }));
    expect(await s.findByText('contenido útil')).toBeTruthy();
    expect(s.queryByText('Se muestra solo el principio del archivo')).toBeNull();
    await userEvent.click(s.getByRole('button', { name: 'Ver referencias/grande.txt' }));
    expect(await s.findByText('Se muestra solo el principio del archivo')).toBeTruthy();
    await userEvent.click(s.getByRole('button', { name: 'Ver referencias/b.bin' }));
    expect((await s.findByRole('alert')).textContent).toContain('no es de texto');
    await userEvent.click(s.getByRole('button', { name: 'Cerrar vista' }));
  });

  it('[R24.12] los scripts llevan un aviso visible', async () => {
    const { s } = await openSkill({ pickedFiles: tree({ 'run.sh': 'echo', 'nota.txt': 'x' }) });
    await userEvent.click(await s.findByRole('button', { name: 'Añadir archivos' }));
    const script = (await s.findByText('referencias/run.sh')).closest('li') as HTMLElement;
    expect(within(script).getByText('Script o ejecutable')).toBeTruthy();
    const note = s.getByText('referencias/nota.txt').closest('li') as HTMLElement;
    expect(within(note).queryByText('Script o ejecutable')).toBeNull();
  });

  it('[R24.6] borrar una skill pide confirmación, dice qué agentes la usan y la quita de ellos', async () => {
    const api = await mount({ skills: [skill('pixel', 'Pixel')], agents: [agent('a', 'Agente A', { skillIds: ['pixel'] })] });
    const s = await openSkills();
    await userEvent.click(await s.findByRole('button', { name: 'Pixel' }));
    await userEvent.click(s.getByRole('button', { name: 'Eliminar' }));
    const confirm = await s.findByRole('alertdialog');
    expect(confirm.textContent).toContain('La usan: Agente A');
    await userEvent.click(within(confirm).getByRole('button', { name: 'Cancelar' }));
    expect(api.skills.has('pixel')).toBe(true);
    await userEvent.click(s.getByRole('button', { name: 'Eliminar' }));
    await userEvent.click(within(await s.findByRole('alertdialog')).getByRole('button', { name: 'Eliminar' }));
    await waitFor(() => expect(api.skills.has('pixel')).toBe(false));
    expect(api.agents.get('a')?.skillIds).toEqual([]);
  });

  it('[R24.7] el formulario del agente asigna sus skills desde una pantalla aparte', async () => {
    const api = await mount({ skills: [skill('pixel', 'Pixel art')], agents: [agent('a', 'A')] });
    const s = await openAgents();
    await userEvent.click(await s.findByRole('button', { name: 'A' }));
    await userEvent.click(s.getByRole('button', { name: /^Qué sabe/ }));
    await userEvent.click(s.getByRole('button', { name: 'Añadir skills…' }));
    await userEvent.click(s.getByRole('button', { name: 'Añadir Pixel art' }));
    await userEvent.click(s.getByRole('button', { name: 'Listo' }));
    await userEvent.click(s.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(api.agents.get('a')?.skillIds).toEqual(['pixel']));
  });

  it('[R24.7] sin skills el agente explica dónde crearlas', async () => {
    await mount();
    const s = await openAgents();
    await userEvent.click(s.getByRole('button', { name: 'Nuevo agente' }));
    await userEvent.click(s.getByRole('button', { name: 'Escribir' }));
    await userEvent.type(s.getByLabelText('Nombre'), 'Nuevo');
    await userEvent.click(s.getByRole('button', { name: 'Siguiente' }));
    expect(s.getByText('Este agente no usa ninguna skill.')).toBeTruthy();
    await userEvent.click(s.getByRole('button', { name: 'Añadir skills…' }));
    expect(s.getByText(/Todavía no hay skills en el proyecto/)).toBeTruthy();
  });
});

describe('SPEC-025 · instalar agentes y skills', () => {
  const openInstall = async (options: MemoryApiOptions = { importTree: tree(PKG) }) => {
    const api = await mount(options);
    const s = await openAgents();
    await userEvent.click(s.getByRole('button', { name: 'Instalar' }));
    const d = within(await screen.findByRole('dialog', { name: 'Instalar agentes y skills' }));
    return { api, s, d };
  };

  it('[R25.9] elegir un paquete muestra la revisión con avisos y sin instalar nada', async () => {
    const { api, d } = await openInstall();
    await userEvent.click(d.getByRole('button', { name: 'Elegir carpeta' }));
    expect(await d.findByText('Revisa lo que se va a instalar')).toBeTruthy();
    expect(d.getByRole('checkbox', { name: /revisor/ })).toHaveProperty('checked', true);
    expect(d.getByText(/Incluye un script o ejecutable: run\.sh/)).toBeTruthy();
    expect(d.getByText(/Pide las herramientas: Read, Bash/)).toBeTruthy();
    expect(d.getByText('git')).toBeTruthy();
    expect(d.getByText(/No se instalan: quedan desactivados/)).toBeTruthy();
    expect(d.getByText(/Archivos sin reconocer, que se ignoran: 1/)).toBeTruthy();
    expect(api.agents.size + api.skills.size).toBe(0);
  });

  it('[R25.9] los avisos graves se distinguen de los informativos', async () => {
    const { d } = await openInstall();
    await userEvent.click(d.getByRole('button', { name: 'Elegir Zip' }));
    const script = (await d.findByText(/script o ejecutable/)).closest('p')!;
    const tools = d.getByText(/Pide las herramientas/).closest('p')!;
    expect(script.className).toContain('is-serious');
    expect(tools.className).not.toContain('is-serious');
  });

  it('[R25.6][R25.9] instala solo lo marcado y resume el resultado', async () => {
    const { api, s, d } = await openInstall();
    await userEvent.click(d.getByRole('button', { name: 'Elegir carpeta' }));
    await userEvent.click(await d.findByRole('checkbox', { name: /pixel-art/ }));
    await userEvent.click(d.getByRole('button', { name: 'Instalar seleccionados' }));
    expect(await d.findByText('Instalación terminada')).toBeTruthy();
    expect(d.getByText('Agentes instalados: 1')).toBeTruthy();
    expect(d.getByText('Skills instaladas: 0')).toBeTruthy();
    expect(d.getByText(/skills que no se instalaron/)).toBeTruthy();
    expect([...api.agents.keys()]).toEqual(['revisor']);
    await userEvent.click(d.getByRole('button', { name: 'Hecho' }));
    expect(await s.findByRole('button', { name: 'revisor' })).toBeTruthy();
  });

  it('[R25.9] instala agente y skill juntos y el agente queda con su skill', async () => {
    const { api, d } = await openInstall();
    await userEvent.click(d.getByRole('button', { name: 'Elegir carpeta' }));
    await userEvent.click(await d.findByRole('button', { name: 'Instalar seleccionados' }));
    expect(await d.findByText('Skills instaladas: 1')).toBeTruthy();
    expect(api.agents.get('revisor')?.skillIds).toEqual(['pixel-art']);
    expect(api.skills.has('pixel-art')).toBe(true);
  });

  it('[R25.7] cancelar no instala nada; con todo desmarcado no se puede confirmar', async () => {
    const { api, d } = await openInstall();
    await userEvent.click(d.getByRole('button', { name: 'Elegir carpeta' }));
    await userEvent.click(await d.findByRole('checkbox', { name: /revisor/ }));
    await userEvent.click(d.getByRole('checkbox', { name: /pixel-art/ }));
    expect((d.getByRole('button', { name: 'Instalar seleccionados' }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(d.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog', { name: 'Instalar agentes y skills' })).toBeNull();
    expect(api.agents.size + api.skills.size).toBe(0);
  });

  it('[R25.4] un id repetido se marca como conflicto y se instala con otro id', async () => {
    const { api, d } = await openInstall({ importTree: tree(PKG), agents: [agent('revisor', 'Mío')] });
    await userEvent.click(d.getByRole('button', { name: 'Elegir carpeta' }));
    expect(await d.findByText(/Ya existe «revisor»; se instalaría como «revisor-2»/)).toBeTruthy();
    await userEvent.click(d.getByRole('button', { name: 'Instalar seleccionados' }));
    await d.findByText('Instalación terminada');
    expect([...api.agents.keys()].sort()).toEqual(['revisor', 'revisor-2']);
  });

  it('[R25.4] lo que no se puede instalar sale bloqueado y desmarcado', async () => {
    const { d } = await openInstall({ importTree: tree({ 'skills/x/SKILL.md': '---\nname: x\n---\ncuerpo' }) });
    await userEvent.click(d.getByRole('button', { name: 'Elegir carpeta' }));
    expect(await d.findByText(/No se puede instalar: Describe cuándo/)).toBeTruthy();
    const box = d.getByRole('checkbox', { name: /x/ }) as HTMLInputElement;
    expect(box.disabled).toBe(true);
    expect(box.checked).toBe(false);
  });

  it('[R25.1] si se cancela el diálogo del sistema no cambia nada; un paquete vacío se explica', async () => {
    const a = await openInstall({});
    await userEvent.click(a.d.getByRole('button', { name: 'Elegir carpeta' }));
    expect(a.d.getByText(/Elige una carpeta o un Zip/)).toBeTruthy();
    expect(a.d.queryByText('Revisa lo que se va a instalar')).toBeNull();
  });

  it('[R25.1] un paquete sin agentes ni skills dice que no hay nada que instalar', async () => {
    const { d } = await openInstall({ importTree: tree({ 'README.md': '# nada' }) });
    await userEvent.click(d.getByRole('button', { name: 'Elegir carpeta' }));
    expect(await d.findByText(/No se ha encontrado ningún agente ni skill/)).toBeTruthy();
  });
});

describe('SPEC-027 · motor y conexión en Ajustes', () => {
  const openSettings = async () => {
    return openSettingsPage();
  };

  it('[R27.1] el motor se elige en Ajustes y se guarda', async () => {
    const api = await mount();
    const s = await openSettings();
    expect((s.getByRole('radio', { name: /Simulado/ }) as HTMLInputElement).checked).toBe(true);
    await userEvent.click(s.getByRole('radio', { name: /Claude \(real\)/ }));
    await settingsSaved();
    expect(await s.findByText('Ajustes guardados')).toBeTruthy();
    expect((await api.getSettings()) as { ok: boolean; value: { engine: string } }).toMatchObject({ value: { engine: 'claude' } });
  });

  it('[R27.12] Probar conexión muestra el modelo y el tiempo, y avisa de que usa lo guardado', async () => {
    await mount({ connection: { ok: true, message: 'Claude responde correctamente.', model: 'claude-sonnet-5-5', ms: 321 } });
    const s = await openSettings();
    expect(s.getByText(/Usa los valores de esta página/)).toBeTruthy();
    await userEvent.click(s.getByRole('button', { name: 'Probar conexión' }));
    expect((await s.findByRole('status')).textContent).toBe('Claude responde correctamente. Modelo claude-sonnet-5-5, 321 ms.');
  });

  it('[R27.12] si falla, el motivo sale como alerta junto al botón', async () => {
    await mount({ connection: { ok: false, message: 'Falta la clave API. Guárdala en Ajustes.', model: 'claude-sonnet-5-5', ms: 4 } });
    const s = await openSettings();
    await userEvent.click(s.getByRole('button', { name: 'Probar conexión' }));
    expect((await s.findByRole('alert')).textContent).toBe('No se pudo conectar: Falta la clave API. Guárdala en Ajustes.');
  });
});

describe('SPEC-023 · guardar ajustes respeta el contrato', () => {
  it('[R23.4] la interfaz solo envía campos de ajustes (no apiKeyStored) y guardar funciona', async () => {
    await mount();
    const s = await openSettingsPage();
    await userEvent.selectOptions(await s.findByLabelText('Modelo por defecto'), 'claude-haiku-5-5');
    await settingsSaved();
    expect(await s.findByText('Ajustes guardados')).toBeTruthy();
    expect(s.queryByRole('alert')).toBeNull();
  });
});
